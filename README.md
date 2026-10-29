# Virtual Mart product scraper

Scrape the Virtual Mart Groceries category, visit each product page, and save its product details and images together in a timestamped folder under `assets`.

## Run a complete scrape

```sh
npm run scrape
```

To run a small smoke test, limit the number of products:

```sh
npm run scrape -- --limit 2
```

Each run creates a folder named `assets/virtualmart-groceries-<timestamp>/` containing:

- `products.csv` with the product name, URL, SKU, description, brand, price, currency, availability, categories, and local image filenames.
- One or more image files per product. Each filename includes the product name and product ID; the CSV `image_files` column lists those files separated by semicolons.

The default run visits category pages one at a time until it reaches the end, then visits every product page and downloads its images. Within one Node.js process, HTTP requests are serialized with at least three seconds between request starts, and each request is capped at two minutes in total.

Transient failures (timeouts, dropped connections, and HTTP 408/425/429/500/502/503/504) are retried up to five times with exponential backoff and jitter, starting around 5 seconds and capped at 5 minutes. A `Retry-After` header from the site takes precedence. If a product still fails after retries, it is skipped, the run continues, and the product URL and error are written to `failed.csv` in the output folder. Progress is printed as the run goes. The full run may take several hours because the category contains thousands of products and each product's images are downloaded.

## HTTP server

`npm start` starts the Express server on port 3000. Requesting `/` starts a complete category scrape in the background and immediately returns `202 Accepted`, so the request cannot time out. Poll `/status` for progress and, when it finishes, the output paths and counts. Only one scrape runs at a time; requesting `/` while one is running returns `409`. For normal use, the CLI command above is recommended.
