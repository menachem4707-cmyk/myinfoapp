require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const app = express();
const PORT = 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-me-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

// --- Properties data table: helpers + whitelists ---

// Small port of property-scraper's Url__c formula so the table can show/link
// each property's scrape URL (myapp is deployed separately from the scraper).
function lpad(s, n, pad = "0") {
  s = String(s);
  return s.length >= n ? s : pad.repeat(n - s.length) + s;
}
function buildScrapeUrl(block, lot, districtCode) {
  const district = String(districtCode == null ? "" : districtCode);
  const b = String(block == null ? "" : block);
  const l = String(lot == null ? "" : lot);
  if (!district || (!b && !l)) return null;
  const blockPeriod = b.includes(".");
  const lotPeriod = l.includes(".");
  const base =
    "https://taxrecords-nj.com/pub/cgi/m4.cgi?district=" +
    district +
    "&l02=" +
    district;
  const blockSeg = !blockPeriod
    ? lpad(b, 5) + "____"
    : lpad(b.slice(0, b.length - 3), 5) + "__" + b.slice(-2);
  const lotSeg = !lotPeriod
    ? lpad(l, 5)
    : lpad(l.slice(0, l.length - 3), 5) + "__" + l.slice(-2) + "_____M";
  const tailSeg = !lotPeriod ? "_________M" : "";
  return base + blockSeg + lotSeg + tailSeg + "&hist=0";
}

// Columns that can be filtered/sorted, and how each maps to SQL on the view.
const TEXT_FILTER_COLS = new Set([
  "id",
  "name",
  "block",
  "lot",
  "owner_name",
  "owner_street",
  "city_state",
  "sale_date",
  "sale_price",
  "notes",
]);
const BOOL_COLS = new Set(["reviewed", "yiddish", "bobov"]);
const SORT_MAP = {
  id: "v.id",
  name: "v.name",
  city_id: "v.city_id",
  city_name: "c.name",
  block: "v.block",
  lot: "v.lot",
  owner_name: "v.owner_name",
  owner_street: "v.owner_street",
  city_state: "v.city_state",
  sale_date: "v.sale_date",
  sale_price: "v.sale_price",
  price: "v.price",
  date_of_sale: "v.date_of_sale",
  reviewed: "v.reviewed",
  yiddish: "v.yiddish",
  bobov: "v.bobov",
  notes: "v.notes",
  last_run_date_time: "v.last_run_date_time",
};
// Columns the UI may write (everything except the PK and derived fields).
const EDITABLE_COLS = new Set([
  "name",
  "city_id",
  "block",
  "lot",
  "owner_name",
  "owner_street",
  "city_state",
  "sale_date",
  "sale_price",
  "reviewed",
  "yiddish",
  "bobov",
  "notes",
  "last_run_date_time",
]);
// Global search spans these columns.
const SEARCH_COLS = [
  "name",
  "owner_name",
  "owner_street",
  "city_state",
  "block",
  "lot",
  "id",
];

function coerceBool(value) {
  if (typeof value === "boolean") return value;
  if (value == null || value === "") return null;
  const v = String(value).trim().toLowerCase();
  if (["true", "t", "1", "yes", "y"].includes(v)) return true;
  if (["false", "f", "0", "no", "n"].includes(v)) return false;
  return null;
}

// Build a parameterized WHERE from a global query `q` and an array of
// Tabulator filters [{field,type,value}]. `params` is mutated; returns the
// SQL clause (without the leading WHERE) or "" when there are no conditions.
function buildWhere(q, filters, params) {
  const clauses = [];

  if (q != null && String(q).trim() !== "") {
    params.push(`%${String(q).trim()}%`);
    const idx = params.length;
    clauses.push(
      "(" + SEARCH_COLS.map((c) => `v.${c} ILIKE $${idx}`).join(" OR ") + ")"
    );
  }

  const list = Array.isArray(filters) ? filters : [];
  for (const f of list) {
    if (!f || typeof f !== "object") continue;
    const field = String(f.field || "");
    const value = f.value;
    if (value == null || value === "") continue;

    if (BOOL_COLS.has(field)) {
      const b = coerceBool(value);
      if (b === null) continue;
      params.push(b);
      clauses.push(`v.${field} = $${params.length}`);
    } else if (field === "city_id") {
      params.push(String(value));
      clauses.push(`v.city_id = $${params.length}`);
    } else if (TEXT_FILTER_COLS.has(field)) {
      params.push(`%${String(value)}%`);
      clauses.push(`v.${field} ILIKE $${params.length}`);
    }
  }

  return clauses.length ? clauses.join(" AND ") : "";
}

function buildOrderBy(sort) {
  const first = Array.isArray(sort) ? sort[0] : null;
  if (first && SORT_MAP[first.field]) {
    const dir = String(first.dir).toLowerCase() === "desc" ? "DESC" : "ASC";
    return `ORDER BY ${SORT_MAP[first.field]} ${dir} NULLS LAST, v.id ASC`;
  }
  return "ORDER BY v.name ASC, v.id ASC";
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title, body) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 2rem auto; padding: 0 1rem; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { border: 1px solid #ccc; padding: 0.5rem 1rem; text-align: left; }
    th { background: #f5f5f5; }
    label { display: block; margin-top: 1rem; font-weight: 600; }
    input { width: 100%; padding: 0.5rem; margin-top: 0.25rem; box-sizing: border-box; }
    button, .btn {
      margin-top: 1rem; padding: 0.5rem 1rem; cursor: pointer;
      background: #2563eb; color: #fff; border: none; border-radius: 4px;
    }
    .error { color: #b91c1c; margin-top: 1rem; }
    .header { display: flex; justify-content: space-between; align-items: center; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

function loginPage(showError) {
  const errorHtml = showError
    ? '<p class="error">Invalid email or password.</p>'
    : "";

  return page(
    "MyInfoApp — Sign in",
    `<h1>Sign in</h1>
<form method="post" action="/login">
  <label>Email
    <input type="email" name="email" required autocomplete="username">
  </label>
  <label>Password
    <input type="password" name="password" required autocomplete="current-password">
  </label>
  ${errorHtml}
  <button type="submit">Sign in</button>
</form>`
  );
}

// HTML shell for the properties data table. The grid and all data are loaded
// client-side from /app.js via the authed /api endpoints.
function propertiesShell(email) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MyInfoApp — Properties</title>
  <link href="/vendor/tabulator.min.css" rel="stylesheet">
  <link href="/app.css" rel="stylesheet">
</head>
<body>
  <div id="signed-in" data-email="${escapeHtml(email)}"></div>
  <script src="/vendor/tabulator.min.js"></script>
  <script src="/app.js"></script>
</body>
</html>`;
}

app.get("/", (req, res) => {
  if (!req.session.userId) {
    return res.send(loginPage(false));
  }
  res.send(propertiesShell(req.session.email));
});

// --- Properties JSON API (all routes require an authenticated session) ---

// List with server-side pagination, sorting, filtering and global search.
app.get("/api/properties", requireAuth, async (req, res) => {
  try {
    const size = Math.min(Math.max(parseInt(req.query.size, 10) || 100, 1), 500);
    const pageNum = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const offset = (pageNum - 1) * size;

    const params = [];
    const where = buildWhere(req.query.q, req.query.filter, params);
    const whereSql = where ? `WHERE ${where}` : "";
    const orderSql = buildOrderBy(req.query.sort);

    const countResult = await pool.query(
      `SELECT count(*)::int AS total
         FROM v_properties v
         LEFT JOIN cities c ON c.id = v.city_id
        ${whereSql}`,
      params
    );
    const total = countResult.rows[0].total;

    const dataParams = params.slice();
    dataParams.push(size, offset);
    const dataResult = await pool.query(
      `SELECT v.*, c.name AS city_name, c.district_code
         FROM v_properties v
         LEFT JOIN cities c ON c.id = v.city_id
        ${whereSql}
        ${orderSql}
        LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams
    );

    const data = dataResult.rows.map((row) => ({
      ...row,
      url: buildScrapeUrl(row.block, row.lot, row.district_code),
    }));

    res.json({
      data,
      total,
      last_page: Math.max(Math.ceil(total / size), 1),
    });
  } catch (err) {
    console.error("[api/properties]", err);
    res.status(500).json({ error: err.message });
  }
});

// Fetch a single property (joined + derived + url) by id.
async function fetchProperty(id) {
  const result = await pool.query(
    `SELECT v.*, c.name AS city_name, c.district_code
       FROM v_properties v
       LEFT JOIN cities c ON c.id = v.city_id
      WHERE v.id = $1`,
    [id]
  );
  const row = result.rows[0];
  if (!row) return null;
  return { ...row, url: buildScrapeUrl(row.block, row.lot, row.district_code) };
}

// Turn a {field: value} change set into validated SET columns/values.
function buildChangeSet(changes) {
  const cols = [];
  const values = [];
  for (const [key, raw] of Object.entries(changes || {})) {
    if (!EDITABLE_COLS.has(key)) continue;
    let v = raw;
    if (BOOL_COLS.has(key)) v = coerceBool(v);
    else if (v === "") v = null;
    cols.push(key);
    values.push(v);
  }
  return { cols, values };
}

// Cities for filter / edit dropdowns.
app.get("/api/cities", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, district_code FROM cities ORDER BY name NULLS LAST, id"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[api/cities]", err);
    res.status(500).json({ error: err.message });
  }
});

// Single property detail.
app.get("/api/properties/:id", requireAuth, async (req, res) => {
  try {
    const row = await fetchProperty(req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  } catch (err) {
    console.error("[api/properties/:id]", err);
    res.status(500).json({ error: err.message });
  }
});

// Update one property (whitelisted editable fields only).
app.patch("/api/properties/:id", requireAuth, async (req, res) => {
  try {
    const { cols, values } = buildChangeSet(req.body);
    if (!cols.length) {
      return res.status(400).json({ error: "no editable fields provided" });
    }
    const sets = cols.map((c, i) => `${c} = $${i + 2}`);
    const result = await pool.query(
      `UPDATE properties SET ${sets.join(", ")} WHERE id = $1`,
      [req.params.id, ...values]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "not found" });
    }
    res.json(await fetchProperty(req.params.id));
  } catch (err) {
    console.error("[api/properties/:id PATCH]", err);
    res.status(500).json({ error: err.message });
  }
});

// Bulk update: by explicit ids, or all rows matching a filter (all:true).
app.post("/api/properties/bulk", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const { cols, values } = buildChangeSet(body.changes);
    if (!cols.length) {
      return res.status(400).json({ error: "no editable fields provided" });
    }

    const params = [...values];
    const sets = cols.map((c, i) => `${c} = $${i + 1}`);
    let whereSql;

    if (Array.isArray(body.ids) && body.ids.length) {
      params.push(body.ids.map(String));
      whereSql = `id = ANY($${params.length})`;
    } else if (body.all) {
      const where = buildWhere(body.q, body.filter, params);
      whereSql = where ? where.replace(/\bv\./g, "") : "true";
    } else {
      return res
        .status(400)
        .json({ error: "provide ids[] or all:true with filters" });
    }

    const result = await pool.query(
      `UPDATE properties SET ${sets.join(", ")} WHERE ${whereSql}`,
      params
    );
    res.json({ updated: result.rowCount });
  } catch (err) {
    console.error("[api/properties/bulk]", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/login", (req, res) => {
  if (req.session.userId) {
    return res.redirect("/");
  }
  res.send(loginPage(false));
});

app.post("/login", async (req, res) => {
  const email = String(req.body.email || "")
    .trim()
    .toLowerCase();
  const password = String(req.body.password || "");

  try {
    const result = await pool.query(
      'SELECT id, email, password_hash FROM "Users" WHERE LOWER(email) = $1',
      [email]
    );

    const user = result.rows[0];
    const valid =
      user && (await bcrypt.compare(password, user.password_hash));

    if (!valid) {
      return res.status(401).send(loginPage(true));
    }

    req.session.userId = user.id;
    req.session.email = user.email;
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(401).send(loginPage(true));
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
