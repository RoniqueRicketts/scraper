import express, { type Express, type Request, type Response } from 'express';
import { Scrape } from './scrape.ts';

const app: Express = express();

app.get('/', async (req: Request, res: Response) => {
  try {
    const scraper = new Scrape();
    const result = await scraper.scan();
    res.json(result);
  } catch (error) {
    console.error('Scrape request failed:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'An unknown error occurred.',
    });
  }
});

app.listen(3000);