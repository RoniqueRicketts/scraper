import axios from 'axios';
import * as cheerio from 'cheerio';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CATEGORY_URL = 'https://virtualmartja.com/shop?category=ps-groceries-g10d03';

type JsonObject = Record<string, unknown>;

interface ProductRecord {
	name: string;
	url: string;
	sku: string;
	description: string;
	brand: string;
	price: string;
	currency: string;
	availability: string;
	categories: string;
	images: string[];
}

interface SavedProduct extends ProductRecord {
	imageFiles: string[];
}

export interface ScrapeOptions {
	productLimit?: number;
	concurrency?: number;
}

export interface ScrapeResult {
	productCount: number;
	imageCount: number;
	csvPath: string;
	outputDirectory: string;
}

function isObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getText(value: unknown): string {
	return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function getTypeNames(value: unknown): string[] {
	if (typeof value === 'string') {
		return [value];
	}
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function findStructuredObject(value: unknown, type: string): JsonObject | undefined {
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findStructuredObject(item, type);
			if (found) {
				return found;
			}
		}
		return undefined;
	}

	if (!isObject(value)) {
		return undefined;
	}

	if (getTypeNames(value['@type']).includes(type)) {
		return value;
	}

	for (const item of Object.values(value)) {
		const found = findStructuredObject(item, type);
		if (found) {
			return found;
		}
	}
	return undefined;
}

function getStructuredData($: cheerio.CheerioAPI): unknown[] {
	const values: unknown[] = [];
	$('script[type="application/ld+json"]').each((_, element) => {
		try {
			values.push(JSON.parse($(element).text()) as unknown);
		} catch (error) {
			throw new Error('The page contains invalid JSON-LD structured data.', { cause: error });
		}
	});
	return values;
}

function getProductUrls(html: string, pageUrl: string): { urls: string[]; expectedCount?: number } {
	const $ = cheerio.load(html);
	const structuredData = getStructuredData($);
	const itemList = structuredData
		.map((value) => findStructuredObject(value, 'ItemList'))
		.find((value) => value !== undefined);
	const expectedCount = itemList && typeof itemList.numberOfItems === 'number' ? itemList.numberOfItems : undefined;
	const urls = new Set<string>();

	$('a[href*="/product/"]').each((_, element) => {
		const href = $(element).attr('href');
		if (href) {
			urls.add(new URL(href, pageUrl).toString());
		}
	});

	return { urls: [...urls], expectedCount };
}

function getProduct(html: string, pageUrl: string): ProductRecord {
	const $ = cheerio.load(html);
	const structuredData = getStructuredData($);
	const product = structuredData
		.map((value) => findStructuredObject(value, 'Product'))
		.find((value) => value !== undefined);

	if (!product) {
		throw new Error(`No Product structured data found at ${pageUrl}`);
	}

	const offerValue = product.offers;
	const offer = Array.isArray(offerValue) ? offerValue[0] : offerValue;
	const offerObject = isObject(offer) ? offer : {};
	const brandValue = product.brand;
	const brand = isObject(brandValue) ? getText(brandValue.name) : getText(brandValue);
	const imageValue = product.image;
	const images = (Array.isArray(imageValue) ? imageValue : [imageValue])
		.map(getText)
		.filter((image) => image.length > 0)
		.map((image) => new URL(image, pageUrl).toString());
	const breadcrumb = structuredData
		.map((value) => findStructuredObject(value, 'BreadcrumbList'))
		.find((value) => value !== undefined);
	const breadcrumbItems = breadcrumb && Array.isArray(breadcrumb.itemListElement) ? breadcrumb.itemListElement : [];
	const categories = breadcrumbItems
		.filter(isObject)
		.map((item) => getText(item.name))
		.filter((name) => name && name !== 'Home' && name !== 'Shop' && name !== getText(product.name))
		.join(' > ');

	if (!getText(product.name) || !getText(product.url) || images.length === 0) {
		throw new Error(`Product data is missing its name, URL, or images at ${pageUrl}`);
	}

	return {
		name: getText(product.name),
		url: new URL(getText(product.url), pageUrl).toString(),
		sku: getText(product.sku),
		description: getText(product.description),
		brand,
		price: getText(offerObject.price),
		currency: getText(offerObject.priceCurrency),
		availability: getText(offerObject.availability).replace(/^https?:\/\/schema\.org\//, ''),
		categories,
		images,
	};
}

function slugify(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 90) || 'product';
}

function imageExtension(url: string, contentType: string): string {
	const contentTypeExtension: Record<string, string> = {
		'image/avif': '.avif',
		'image/gif': '.gif',
		'image/jpeg': '.jpg',
		'image/png': '.png',
		'image/webp': '.webp',
	};
	const knownExtension = contentTypeExtension[contentType.split(';')[0].trim().toLowerCase()];
	if (knownExtension) {
		return knownExtension;
	}

	const urlExtension = extname(new URL(url).pathname).toLowerCase();
	if (/^\.(avif|gif|jpe?g|png|webp)$/.test(urlExtension)) {
		return urlExtension === '.jpeg' ? '.jpg' : urlExtension;
	}
	throw new Error(`Unsupported image content type "${contentType || 'unknown'}" for ${url}`);
}

function csvCell(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

function createCsv(products: SavedProduct[]): string {
	const columns = [
		'product_name',
		'product_url',
		'sku',
		'description',
		'brand',
		'price',
		'currency',
		'availability',
		'categories',
		'image_files',
	];
	const rows = products.map((product) => [
		product.name,
		product.url,
		product.sku,
		product.description,
		product.brand,
		product.price,
		product.currency,
		product.availability,
		product.categories,
		product.imageFiles.join(';'),
	]);
	return [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	const workerCount = Math.min(items.length, concurrency);
	const workers = Array.from({ length: workerCount }, async () => {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			results[index] = await mapper(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
}

export class Scrape {
	private readonly categoryUrl: string;
	private readonly options: ScrapeOptions;

	constructor(
		categoryUrl: string = DEFAULT_CATEGORY_URL,
		options: ScrapeOptions = {},
	) {
		this.categoryUrl = categoryUrl;
		this.options = options;
	}

	private async fetchPage(url: string): Promise<string> {
		const response = await axios.get<string>(url, {
			headers: { 'User-Agent': USER_AGENT },
			timeout: 30_000,
			responseType: 'text',
		});
		return response.data;
	}

	private async collectProductUrls(): Promise<string[]> {
		const category = new URL(this.categoryUrl);
		const productUrls = new Set<string>();
		let expectedCount: number | undefined;
		let page = 1;

		while (true) {
			const pageUrl = new URL(category);
			if (page > 1) {
				pageUrl.searchParams.set('page', String(page));
			}

			const html = await this.fetchPage(pageUrl.toString());
			const result = getProductUrls(html, pageUrl.toString());
			expectedCount ??= result.expectedCount;
			const previousCount = productUrls.size;
			for (const url of result.urls) {
				productUrls.add(url);
			}

			if (productUrls.size >= (this.options.productLimit ?? Number.POSITIVE_INFINITY)) {
				break;
			}
			if (productUrls.size === previousCount) {
				if (expectedCount !== undefined && productUrls.size < expectedCount) {
					throw new Error(
						`Pagination stopped after ${productUrls.size} products, but the category reports ${expectedCount}.`,
					);
				}
				break;
			}
			if (expectedCount !== undefined && productUrls.size >= expectedCount) {
				break;
			}
			page += 1;
		}

		const urls = [...productUrls];
		const limitedUrls = this.options.productLimit ? urls.slice(0, this.options.productLimit) : urls;
		if (limitedUrls.length === 0) {
			throw new Error(`No product pages found at ${this.categoryUrl}`);
		}
		return limitedUrls;
	}

	private async downloadImages(product: ProductRecord, productIndex: number, outputDirectory: string): Promise<string[]> {
		const productId = product.url.match(/-(\d+)(?:[/?#]|$)/)?.[1] ?? slugify(product.sku || String(productIndex + 1));
		const productTag = `${slugify(product.name)}-${productId}`;
		const imageFiles: string[] = [];

		for (const [imageIndex, imageUrl] of product.images.entries()) {
			const response = await axios.get<ArrayBuffer>(imageUrl, {
				headers: { 'User-Agent': USER_AGENT },
				responseType: 'arraybuffer',
				timeout: 30_000,
			});
			const contentTypeHeader = response.headers['content-type'];
			if (typeof contentTypeHeader !== 'string') {
				throw new Error(`Image response from ${imageUrl} did not include a valid content type.`);
			}
			const contentType = contentTypeHeader;
			if (!contentType.toLowerCase().startsWith('image/')) {
				throw new Error(`Expected an image response but received "${contentType}" from ${imageUrl}`);
			}

			const fileName = `${productTag}-${String(imageIndex + 1).padStart(2, '0')}${imageExtension(imageUrl, contentType)}`;
			await writeFile(join(outputDirectory, fileName), Buffer.from(response.data));
			imageFiles.push(fileName);
		}
		return imageFiles;
	}

	public async scan(): Promise<ScrapeResult> {
		if (this.options.productLimit !== undefined &&
			(!Number.isInteger(this.options.productLimit) || this.options.productLimit < 1)) {
			throw new Error(`Product limit must be a positive integer; received ${this.options.productLimit}.`);
		}
		const concurrency = this.options.concurrency ?? 3;
		if (!Number.isInteger(concurrency) || concurrency < 1) {
			throw new Error(`Concurrency must be a positive integer; received ${concurrency}.`);
		}

		const productUrls = await this.collectProductUrls();
		const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\.(\d{3})Z$/, '-$1');
		const outputDirectory = join(PROJECT_ROOT, 'assets', `virtualmart-groceries-${timestamp}`);
		await mkdir(outputDirectory, { recursive: false });

		const products = await mapWithConcurrency(productUrls, concurrency, async (url, index) => {
			const html = await this.fetchPage(url);
			const product = getProduct(html, url);
			const imageFiles = await this.downloadImages(product, index, outputDirectory);
			return { ...product, imageFiles };
		});

		const csvPath = join(outputDirectory, 'products.csv');
		await writeFile(csvPath, createCsv(products), 'utf8');
		return {
			productCount: products.length,
			imageCount: products.reduce((count, product) => count + product.imageFiles.length, 0),
			csvPath,
			outputDirectory,
		};
	}
}
