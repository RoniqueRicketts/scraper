import { Scrape, type ScrapeOptions } from './scrape.ts';

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

try {
	const scraper = new Scrape(undefined, parseArguments(process.argv.slice(2)));
	const result = await scraper.scan();
	console.log(`Scraped ${result.productCount} products and downloaded ${result.imageCount} images.`);
	console.log(`CSV: ${result.csvPath}`);
	console.log(`Output folder: ${result.outputDirectory}`);
} catch (error) {
	console.error('Scrape failed:', error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
