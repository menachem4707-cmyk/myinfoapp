# NJ Property Tax Scraper

A standalone Node.js service that mirrors a Salesforce-based property-data system:

- Stores `properties` and `cities` (mirroring `Property__c` and `City__c`).
- Computes each property's scrape URL (an exact port of the Salesforce `Url__c` formula).
- Runs a periodic **resync** batch that walks every property, HTTP-GETs its URL, parses the
  returned HTML from `taxrecords-nj.com`, and updates the property record.

You provide all property/city records via the bulk import path; this service does not migrate
from Salesforce or scrape a master list.

---

## Architecture

```
cities  ── id (SF Id), name, district_code
properties ── stored cols (name, block, lot, owner_name, ... reviewed, last_run_date_time, ...)
            └── derived (computed, NOT stored): block_period, lot_period, url, date_of_sale, price
tax_years  ── created but not populated in v1 (tax parsing is disabled in production)
resync_runs── one row per resync pass (counts + status)
```

- `src/urlBuilder.js` — exact `Url__c` port (byte-for-byte). Built in code because it drives the scraper.
- `src/derived.js` — `block_period`, `lot_period`, `date_of_sale`, `price`.
- `src/extractor.js` — `extractValue` / `extractDetails` HTML marker parser.
- `src/scraper.js` — fetch + parse one property.
- `src/resync.js` — the batch (select all properties, fetch, accept/skip, write a `resync_runs` summary).
- `src/importer.js` — bulk upsert of cities/properties (JSON or CSV) by `id`.
- `src/server.js` — Express on `127.0.0.1:3001` (`/health`, `/import`, `/resync`).
- `src/cli.js` — `migrate` / `import` / `resync` for SSH + cron.
- `sql/schema.sql` — tables + `v_properties` read view (exposes `block_period`, `lot_period`,
  `date_of_sale`, `price` in SQL).

The derived fields are never stored. Read them through the `v_properties` view; `url` is computed
in code via `buildUrl(block, lot, district_code)`.

---

## Requirements

- Node.js 18+ (uses the built-in global `fetch`, which transparently decompresses gzip/deflate/br).
- PostgreSQL 15+.

---

## Setup (local)

```bash
cd property-scraper
npm install
cp .env.example .env        # then edit DATABASE_URL
npm run migrate             # apply sql/schema.sql
npm test                    # run unit tests (no DB needed)
```

`.env` values:

| Var | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | — |
| `PORT` | HTTP port (localhost only) | `3001` |
| `RESYNC_LIMIT` | Max properties per run; `0`/empty = ALL | `0` |
| `RESYNC_DELAY_MS` | Delay between fetches | `1000` |
| `RESYNC_CONCURRENCY` | Parallel fetches (keep 1–4) | `1` |

---

## Droplet setup (existing server, shared `myinfoapp` DB)

This service runs on the same droplet as `myapp` but on port **3001** and adds its tables to the
existing `myinfoapp` database. It does not touch the existing `server.js` app.

1. **Create the `.env` on the server** (never commit it):

```bash
ssh root@137.184.132.232
mkdir -p /var/www/property-scraper
cat > /var/www/property-scraper/.env <<'EOF'
DATABASE_URL=postgres://postgres@localhost:5432/myinfoapp
PORT=3001
RESYNC_LIMIT=0
RESYNC_DELAY_MS=1000
RESYNC_CONCURRENCY=1
EOF
```

(Adjust `DATABASE_URL` to match how the existing app authenticates to Postgres.)

2. **Deploy the code** (from your PC):

```powershell
cd C:\Users\MendyPosner\my-first-app\property-scraper
.\deploy.ps1
```

`deploy.ps1` copies `src/`, `sql/`, and `package.json`, runs `npm install`, applies migrations
(`node src/cli.js migrate`), and restarts the `property-scraper` service.

3. **Install the systemd service** (one time, on the server):

```bash
cp /var/www/property-scraper/deploy/property-scraper.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now property-scraper
systemctl status property-scraper
```

> Note: `deploy/` is not copied by `deploy.ps1`. Copy the unit/cron files manually the first time,
> e.g. `scp -i ~/.ssh/id_deploy deploy/property-scraper.service root@137.184.132.232:/etc/systemd/system/`.

---

## Importing records

Upsert is by `id`; existing rows are updated, new rows inserted. Cities are imported before
properties so the `city_id` FK lines up. Original Salesforce Ids are preserved as primary keys.

**CLI:**

```bash
node src/cli.js import examples/sample-import.json          # JSON object {cities, properties}
node src/cli.js import examples/cities.csv cities           # CSV needs a type
node src/cli.js import examples/properties.csv properties
```

**HTTP:**

```bash
curl -X POST http://127.0.0.1:3001/import \
  -H 'Content-Type: application/json' \
  -d @examples/sample-import.json
```

JSON shape:

```json
{
  "cities":     [{ "id": "...", "name": "...", "district_code": "2009" }],
  "properties": [{ "id": "...", "name": "...", "city_id": "...", "block": "388", "lot": "12" }]
}
```

---

## Running a resync

A resync = one pass over the selected properties. For each: build the URL, GET it, parse the HTML,
and update the row.

- Applies an update **only if** the scraped `owner_name` and address (`name`) are both non-blank.
- On accept: persists `owner_name`, `name`, `owner_street`, `city_state`, `sale_price`, `sale_date`
  and sets `last_run_date_time = now()`.
- Sets `reviewed = false` **only when** any of those scraped fields differs from the stored value
  (otherwise `reviewed` is left untouched).
- Blank owner/address, non-200, or empty body → the record is left untouched.

**Manual trigger:**

```bash
node src/cli.js resync           # all properties (or RESYNC_LIMIT)
node src/cli.js resync 10        # just the first 10 (testing)
curl -X POST http://127.0.0.1:3001/resync
curl -X POST http://127.0.0.1:3001/resync -H 'Content-Type: application/json' -d '{"limit":10}'
```

**Scheduling (cron):** see `deploy/property-scraper.cron`. Example daily at 03:00 via the HTTP
endpoint (reuses the warm service process):

```cron
0 3 * * * root curl -s -X POST http://127.0.0.1:3001/resync >> /var/log/property-scraper-resync.log 2>&1
```

Each run records start/finish + counts in `resync_runs`:

```sql
SELECT * FROM resync_runs ORDER BY id DESC LIMIT 5;
```

---

## Reading computed fields

```sql
SELECT id, block, lot, block_period, lot_period, date_of_sale, price
FROM v_properties
ORDER BY id;
```

`url` is computed in code:

```js
const { buildUrl } = require("./src/urlBuilder");
buildUrl("388", "12", "2009");
// https://taxrecords-nj.com/pub/cgi/m4.cgi?district=2009&l02=200900388____00012_________M&hist=0
```

---

## Tests

```bash
npm test
```

Covers period vs non-period block/lot URL construction (incl. the spec example), the `extractValue`
marker parser against `test/fixtures/sample.html`, and `date_of_sale` / `price` parsing.

---

## Coexistence with `myapp`

| | myapp | property-scraper |
|---|---|---|
| Port | 3000 (public via Nginx) | 3001 (localhost only) |
| systemd | `myapp` | `property-scraper` |
| DB | `myinfoapp` (Household, Users) | `myinfoapp` (cities, properties, tax_years, resync_runs) |

Both share the same Postgres database; the table names do not overlap.
