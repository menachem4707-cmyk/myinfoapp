#!/bin/bash
set -e
cd /var/www/myapp

if ! grep -q SESSION_SECRET .env 2>/dev/null; then
  echo "SESSION_SECRET=$(openssl rand -base64 32)" >> .env
fi

sudo -u postgres psql -d myinfoapp -f /tmp/migrate-users.sql
node seed-user.js menachem4707@gmail.com 'Welcome123!'

echo "AUTH_SETUP_OK"
