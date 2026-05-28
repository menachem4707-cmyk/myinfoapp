# My First App (DigitalOcean)

Starter Node.js app deployed on a DigitalOcean droplet. Use this as a reference for future projects.

## Live site

http://137.184.132.232

## Project location (this PC)

`C:\Users\MendyPosner\my-first-app`

## Deploy

```powershell
cd C:\Users\MendyPosner\my-first-app
.\deploy.ps1
```

Deploy uses `C:\Users\MendyPosner\.ssh\id_deploy` (no passphrase). Do not commit private keys.

## Server details

| Item | Value |
|------|--------|
| IP | `137.184.132.232` |
| SSH (you) | `ssh root@137.184.132.232` (personal key + passphrase) |
| App path | `/var/www/myapp` |
| Service | `systemctl status myapp` |
| Web proxy | Nginx on port 80 → app on port 3000 |

## Files

- `server.js` — Express app
- `package.json` — dependencies
- `deploy.ps1` — copy files to server and restart
- `setup-server.sh` — one-time server setup (already run)

## New project tip

Copy this folder or create a new repo and reuse `deploy.ps1` + `id_deploy` key on the same (or a new) droplet.
