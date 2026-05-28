require("dotenv").config();
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error("Usage: node seed-user.js <email> <password>");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO "Users" (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [email.toLowerCase(), hash]
  );
  console.log("USER_OK", email.toLowerCase());
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
