import { Scrape, type ScrapeOptions, type ScrapeProgress } from './scrape.ts';

function parseArguments(args: string[]): ScrapeOptions {
	const limitIndex = args.findIndex((argument) => argument === '--limit' || argument.startsWith('--limit='));
	if (limitIndex === -1) {
		if (args.length > 0) {
			throw new Error(`Unknown argument: ${args[0]}`);
		}
		return {};
	}

	const limitArgument = args[limitIndex];
	const value = limitArgument === '--limit' ? args[limitIndex + 1] : limitArgument.slice('--limit='.length);
	if (args.length > (limitArgument === '--limit' ? 2 : 1)) {
		throw new Error('Usage: npm run scrape [-- --limit <positive integer>]');
	}

	const productLimit = Number(value);
	if (!Number.isInteger(productLimit) || productLimit < 1) {
		throw new Error('--limit must be a positive integer.');
	}
	return { productLimit };
}

function reportProgress({ phase, done, total, failed }: ScrapeProgress): void {
	const count = total === undefined ? `${done}` : `${done}/${total}`;
	const message = phase === 'category'
		? `Collecting product links: ${count}`
		: `Scraping products: ${count}${failed > 0 ? ` (${failed} failed)` : ''}`;
	if (process.stdout.isTTY) {
		process.stdout.write(`\r${message}`);
	} else if (phase === 'category' || done === total || done % 25 === 0) {
		console.log(message);
	}
}

try {
	const scraper = new Scrape(undefined, { ...parseArguments(process.argv.slice(2)), onProgress: reportProgress });
	const result = await scraper.scan();
	if (process.stdout.isTTY) {
		process.stdout.write('\n');
	}
	console.log(`Scraped ${result.productCount} products and downloaded ${result.imageCount} images.`);
	console.log(`CSV: ${result.csvPath}`);
	if (result.failedCsvPath) {
		console.warn(`${result.failedCount} products failed after retries; see ${result.failedCsvPath}`);
	}
	console.log(`Output folder: ${result.outputDirectory}`);
} catch (error) {
	console.error('Scrape failed:', error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
