-- MyInfoApp database schema (PostgreSQL)
-- Database name: myinfoapp

CREATE TABLE IF NOT EXISTS "Household" (
  id SERIAL PRIMARY KEY,
  "Name" TEXT NOT NULL
);
