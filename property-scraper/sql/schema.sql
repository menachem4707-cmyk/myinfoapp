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
-- Resync picks oldest-first by last run; NULLS FIRST so never-run rows lead.
CREATE INDEX IF NOT EXISTS idx_properties_last_run ON properties(last_run_date_time ASC NULLS FIRST);

-- property_history -- a snapshot of a property's prior values, written by the
-- resync each time scraped data differs from what is stored (the same event
-- that flips reviewed -> false). Lets users see what changed over time.
CREATE TABLE IF NOT EXISTS property_history (
  id                 BIGSERIAL PRIMARY KEY,
  property_id        TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  changed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  name               VARCHAR(80),
  owner_name         VARCHAR(255),
  owner_street       VARCHAR(255),
  city_state         VARCHAR(255),
  sale_date          VARCHAR(255),
  sale_price         VARCHAR(255),
  last_run_date_time TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_property_history_property
  ON property_history(property_id, changed_at DESC);

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

-- Error-safe parser for Sale_Date__c "MM/DD/YY" -> DATE. Returns NULL for any
-- blank / malformed / out-of-range value (e.g. 00/00/00, 02/30/21) instead of
-- raising, so reads over the whole table never fail.
CREATE OR REPLACE FUNCTION safe_sale_date(s text) RETURNS date AS $$
BEGIN
  IF s IS NULL OR s !~ '^[0-9]{2}/[0-9]{2}/[0-9]{2}' THEN
    RETURN NULL;
  END IF;
  RETURN make_date(
    CASE
      WHEN substring(s from 7 for 2)::int > 35
        THEN 1900 + substring(s from 7 for 2)::int
      ELSE 2000 + substring(s from 7 for 2)::int
    END,
    substring(s from 1 for 2)::int,
    substring(s from 4 for 2)::int
  );
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Error-safe numeric parse for Sale_Price__c. Returns NULL for blank / values
-- that cannot be cast (instead of raising).
CREATE OR REPLACE FUNCTION safe_price(s text) RETURNS numeric AS $$
DECLARE
  cleaned text;
BEGIN
  IF s IS NULL THEN RETURN NULL; END IF;
  cleaned := regexp_replace(s, '[^0-9.]', '', 'g');
  IF cleaned = '' OR cleaned = '.' THEN RETURN NULL; END IF;
  RETURN cleaned::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Read view exposing the Salesforce formula fields that can be computed in SQL.
-- NOTE: Url__c is intentionally NOT computed here; it is built in code
-- (src/urlBuilder.js) where it must match the Salesforce formula byte-for-byte.
CREATE OR REPLACE VIEW v_properties AS
SELECT
  p.*,
  (p.block LIKE '%.%') AS block_period,
  (p.lot   LIKE '%.%') AS lot_period,
  safe_sale_date(p.sale_date) AS date_of_sale,
  safe_price(p.sale_price) AS price
FROM properties p;
