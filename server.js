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

app.use(express.urlencoded({ extended: false }));
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

async function householdsPage(email) {
  const result = await pool.query(
    'SELECT id, "Name" FROM "Household" ORDER BY id'
  );

  const rows = result.rows
    .map(
      (row) =>
        `<tr><td>${row.id}</td><td>${escapeHtml(row.Name)}</td></tr>`
    )
    .join("");

  return page(
    "MyInfoApp — Households",
    `<div class="header">
      <h1>Households</h1>
      <form method="post" action="/logout"><button type="submit">Sign out</button></form>
    </div>
    <p>Signed in as ${escapeHtml(email)}</p>
    <table>
      <thead><tr><th>ID</th><th>Name</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="2">No households yet.</td></tr>'}</tbody>
    </table>`
  );
}

app.get("/", async (req, res) => {
  if (!req.session.userId) {
    return res.send(loginPage(false));
  }

  try {
    res.send(await householdsPage(req.session.email));
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .send(
        page("Error", `<h1>Database error</h1><pre>${escapeHtml(err.message)}</pre>`)
      );
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
