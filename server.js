require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

app.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, "Name" FROM "Household" ORDER BY id'
    );

    const rows = result.rows
      .map(
        (row) =>
          `<tr><td>${row.id}</td><td>${escapeHtml(row.Name)}</td></tr>`
      )
      .join("");

    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>MyInfoApp — Households</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 2rem auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 0.5rem 1rem; text-align: left; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>Households</h1>
  <table>
    <thead><tr><th>ID</th><th>Name</th></tr></thead>
    <tbody>${rows || "<tr><td colspan=\"2\">No households yet.</td></tr>"}</tbody>
  </table>
</body>
</html>`);
  } catch (err) {
    console.error(err);
    res.status(500).send(`<h1>Database error</h1><pre>${escapeHtml(err.message)}</pre>`);
  }
});

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
