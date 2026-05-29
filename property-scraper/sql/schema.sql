-- NJ Property Tax Scraper schema (PostgreSQL)
-- Lives in the existing `myinfoapp` database alongside Household/Users.
-- Mirrors the Salesforce City__c / Property__c / Tax_Year__c objects.

-- cities (mirrors City__c)
CREATE TABLE IF NOT EXISTS cities (
  id            TEXT PRIMARY KEY,            -- original Salesforce Id
  name          VARCHAR(80),                 -- City__c.Name
  district_code VARCHAR(255)                 -- District_Code__c, used to build the scrape URL
);

-- properties (mirrors Property__c) -- stored/writable columns only
CREATE TABLE IF NOT EXISTS properties (
  id                 TEXT PRIMARY KEY,        -- original Salesforce 18-char Id
  name               VARCHAR(80),             -- Name; overwritten by scraper with parsed "Prop Loc"
  city_id            TEXT REFERENCES cities(id),
  block              VARCHAR(255),            -- Block__c
  lot                VARCHAR(255),            -- Lot__c
  owner_name         VARCHAR(255),            -- Owner_Name__c (scraper)
  owner_street       VARCHAR(255),            -- Owner_Street__c (scraper)
  city_state         VARCHAR(255),            -- City_State__c (scraper)
  sale_date          VARCHAR(255),            -- Sale_Date__c raw text MM/DD/YY (scraper)
  sale_price         VARCHAR(255),            -- Sale_Price__c raw text (scraper)
  reviewed           BOOLEAN DEFAULT false,   -- Reviewed__c
  last_run_date_time TIMESTAMP,               -- Last_Run_Date_Time__c
  notes              VARCHAR(255),            -- Notes__c (manual)
  yiddish            BOOLEAN,                 -- Yiddish__c (manual)
  bobov              BOOLEAN                  -- Bobov__c (manual)
);

CREATE INDEX IF NOT EXISTS idx_properties_city_id ON properties(city_id);
-- Supporting indexes for the data table (sort/filter columns).
CREATE INDEX IF NOT EXISTS idx_properties_name ON properties(name);
CREATE INDEX IF NOT EXISTS idx_properties_owner_name ON properties(owner_name);
CREATE INDEX IF NOT EXISTS idx_properties_reviewed ON properties(reviewed);
CREATE INDEX IF NOT EXISTS idx_properties_sale_date ON properties(sale_date);

-- tax_years (mirrors Tax_Year__c) -- created but not populated in v1
CREATE TABLE IF NOT EXISTS tax_years (
  id             TEXT PRIMARY KEY,            -- Id
  name           VARCHAR(80),                 -- Name (= property_name + ' - ' + year)
  property_id    TEXT REFERENCES properties(id),
  external_id    VARCHAR(255) UNIQUE,         -- External_Id__c (= year + ' - ' + propertyId)
  year           VARCHAR(255),                -- Year__c
  land           NUMERIC(18,2),               -- Land__c
  improvement    NUMERIC(18,2),               -- Improvement__c
  exemption      NUMERIC(18,2),               -- Exemption__c
  total          NUMERIC(18,2),               -- Total__c
  property_class VARCHAR(255)                 -- Property_Class__c
);

-- resync_runs -- one row per resync batch for run summaries
CREATE TABLE IF NOT EXISTS resync_runs (
  id          SERIAL PRIMARY KEY,
  started_at  TIMESTAMP NOT NULL DEFAULT now(),
  finished_at TIMESTAMP,
  total       INTEGER DEFAULT 0,
  updated     INTEGER DEFAULT 0,
  skipped     INTEGER DEFAULT 0,
  errored     INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'running'           -- running | completed | failed
);

-- Read view exposing the Salesforce formula fields that can be computed in SQL.
-- NOTE: Url__c is intentionally NOT computed here; it is built in code
-- (src/urlBuilder.js) where it must match the Salesforce formula byte-for-byte.
CREATE OR REPLACE VIEW v_properties AS
SELECT
  p.*,
  (p.block LIKE '%.%') AS block_period,
  (p.lot   LIKE '%.%') AS lot_period,
  CASE
    WHEN p.sale_date ~ '^[0-9]{2}/[0-9]{2}/[0-9]{2}' THEN
      make_date(
        CASE
          WHEN substring(p.sale_date from 7 for 2)::int > 35
            THEN 1900 + substring(p.sale_date from 7 for 2)::int
          ELSE 2000 + substring(p.sale_date from 7 for 2)::int
        END,
        substring(p.sale_date from 1 for 2)::int,
        substring(p.sale_date from 4 for 2)::int
      )
    ELSE NULL
  END AS date_of_sale,
  CASE
    WHEN p.sale_price IS NOT NULL
         AND regexp_replace(p.sale_price, '[^0-9.]', '', 'g') <> ''
    THEN regexp_replace(p.sale_price, '[^0-9.]', '', 'g')::numeric
    ELSE NULL
  END AS price
FROM properties p;
