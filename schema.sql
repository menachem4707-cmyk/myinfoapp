-- MyInfoApp database schema (PostgreSQL)
-- Database name: myinfoapp

CREATE TABLE IF NOT EXISTS "Household" (
  id SERIAL PRIMARY KEY,
  "Name" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "Users" (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);
