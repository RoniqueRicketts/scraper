import express, { type Express, type Request, type Response } from 'express';
import { Scrape, type ScrapeProgress, type ScrapeResult } from './scrape.ts';

interface ScrapeJob {
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  progress?: ScrapeProgress;
  result?: ScrapeResult;
  error?: string;
}

const app: Express = express();
let job: ScrapeJob | undefined;

// A full scrape takes far longer than any HTTP client will wait, so it runs in the
// background and callers poll /status instead of holding the request open.
app.get('/', (req: Request, res: Response) => {
  if (job?.status === 'running') {
    res.status(409).json({ message: 'A scrape is already running.', statusUrl: '/status', job });
    return;
  }

  const currentJob: ScrapeJob = { status: 'running', startedAt: new Date().toISOString() };
  job = currentJob;
  new Scrape(undefined, { onProgress: (progress) => { currentJob.progress = progress; } })
    .scan()
    .then((result) => {
      currentJob.status = 'done';
      currentJob.result = result;
    })
    .catch((error: unknown) => {
      console.error('Scrape failed:', error);
      currentJob.status = 'failed';
      currentJob.error = error instanceof Error ? error.message : 'An unknown error occurred.';
    })
    .finally(() => {
      currentJob.finishedAt = new Date().toISOString();
    });

  res.status(202).json({ message: 'Scrape started.', statusUrl: '/status', job: currentJob });
});

app.get('/status', (req: Request, res: Response) => {
  if (!job) {
    res.status(404).json({ message: 'No scrape has been started. Request / to start one.' });
    return;
  }
  res.json(job);
});

app.listen(3000);
