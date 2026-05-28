#!/bin/bash
set -e

DB_PASS=$(openssl rand -base64 18 | tr -d '/+=' | head -c 24)

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='myinfoapp'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER myinfoapp WITH PASSWORD '${DB_PASS}';"
else
  sudo -u postgres psql -c "ALTER USER myinfoapp WITH PASSWORD '${DB_PASS}';"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='myinfoapp'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE myinfoapp OWNER myinfoapp;"
fi

sudo -u postgres psql -d myinfoapp -f - <<'EOSQL'
GRANT ALL ON SCHEMA public TO myinfoapp;

CREATE TABLE IF NOT EXISTS "Household" (
  id SERIAL PRIMARY KEY,
  "Name" TEXT NOT NULL
);

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO myinfoapp;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO myinfoapp;
EOSQL

mkdir -p /var/www/myapp
echo "DATABASE_URL=postgresql://myinfoapp:${DB_PASS}@localhost:5432/myinfoapp" > /var/www/myapp/.env
chmod 600 /var/www/myapp/.env

echo "DB_SETUP_OK"
sudo -u postgres psql -d myinfoapp -c '\d "Household"'
