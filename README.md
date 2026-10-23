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

The default run visits every category page and product page. It may take some time because the category contains thousands of products and each product's images are downloaded.

## HTTP server

`npm start` starts the Express server on port 3000. Requesting `/` runs the complete category scrape and returns the output paths and counts as JSON. For normal use, the CLI command above is recommended.
