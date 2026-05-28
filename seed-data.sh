#!/bin/bash
set -e
COUNT=$(sudo -u postgres psql -d myinfoapp -tAc 'SELECT COUNT(*) FROM "Household"')
if [ "$COUNT" = "0" ]; then
  sudo -u postgres psql -d myinfoapp -f /tmp/seed-data.sql
  echo "SEED_OK"
else
  echo "SEED_SKIP already has $COUNT rows"
fi
sudo -u postgres psql -d myinfoapp -c 'SELECT * FROM "Household";'
