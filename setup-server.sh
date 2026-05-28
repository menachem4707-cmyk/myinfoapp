#!/bin/bash
set -e

echo "==> Updating system..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

echo "==> Installing Node.js and Nginx..."
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y nginx

echo "==> Setting up app..."
mkdir -p /var/www/myapp
cd /var/www/myapp

cat > package.json << 'EOF'
{
  "name": "my-first-app",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": { "express": "^4.21.0" }
}
EOF

cat > server.js << 'EOF'
const express = require("express");
const app = express();
const PORT = 3000;

app.get("/", (req, res) => {
  res.send(
    "<h1>Hello from my first app!</h1><p>Running on my DigitalOcean droplet.</p>"
  );
});

app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
});
EOF

npm install --omit=dev

echo "==> Creating systemd service..."
cat > /etc/systemd/system/myapp.service << 'EOF'
[Unit]
Description=My First App
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/myapp
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable myapp
systemctl restart myapp

echo "==> Configuring Nginx..."
cat > /etc/nginx/sites-available/myapp << 'EOF'
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

ln -sf /etc/nginx/sites-available/myapp /etc/nginx/sites-enabled/myapp
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> Done! App should be live on port 80."
