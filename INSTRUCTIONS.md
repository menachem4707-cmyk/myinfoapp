# MyInfoApp — Instructions & Reference

Use this file when you come back to the project or ask Cursor for help.

---

## How I like to work with Cursor

**Give me one step at a time.** Do not dump a long list of commands at once.

- Wait for me to reply `done` before the next step.
- If something fails, stop and fix that step before continuing.

---

## Important locations

| What | Where |
|------|--------|
| Project folder (this PC) | `C:\Users\MendyPosner\my-first-app` |
| GitHub repo | https://github.com/menachem4707-cmyk/myinfoapp |
| Live website | http://137.184.132.232 |
| Droplet IP | `137.184.132.232` |
| App on server | `/var/www/myapp` |

---

## SSH keys (two different keys)

| Key file | Used for | Passphrase |
|----------|----------|------------|
| `C:\Users\MendyPosner\.ssh\id_ed25519` | **You** logging in manually | Yes |
| `C:\Users\MendyPosner\.ssh\id_deploy` | **Deploy script** / Cursor automated deploy | No |

**Never commit private keys** (`id_ed25519`, `id_deploy`) to GitHub.

---

## Deploy to DigitalOcean (update the live site)

Do this after you change `server.js` or `package.json` on your PC.

### Step 1

Open PowerShell:

```powershell
cd C:\Users\MendyPosner\my-first-app
```

Reply `done` when you are in that folder.

### Step 2

Run the deploy script:

```powershell
.\deploy.ps1
```

### Step 3

Open in your browser:

http://137.184.132.232

Hard refresh if needed: **Ctrl+F5**.

### If deploy fails

Tell Cursor the exact error. Common fixes:

- Deploy key missing on server → re-add `id_deploy.pub` to `/root/.ssh/authorized_keys` (via Droplet Console).
- App not running → on server: `systemctl status myapp`

---

## Push to GitHub (save code online)

Repo: **menachem4707-cmyk/myinfoapp**  
Branch: **main**

### Step 1

```powershell
cd C:\Users\MendyPosner\my-first-app
```

### Step 2

Save your changes in Git:

```powershell
git add .
git commit -m "Describe what you changed"
```

(Skip `git commit` if Git says “nothing to commit”.)

### Step 3

Push:

```powershell
git push origin main
```

If GitHub asks you to sign in, use account **menachem4707-cmyk** (not MendyPosner).

### Two GitHub accounts on one PC

- **menachem4707-cmyk** → this repo (`myinfoapp`)
- **MendyPosner** → your other projects

Both can stay on this machine. This repo is configured to use **menachem4707-cmyk**.

Check logged-in accounts:

```powershell
git credential-manager github list
```

Add the second account if needed:

```powershell
git credential-manager github login
```

---

## SSH into the server (manual)

### Step 1

```powershell
ssh root@137.184.132.232
```

Enter your **passphrase** for `id_ed25519` when asked.

### Step 2 — useful server commands

```bash
systemctl status myapp
systemctl restart myapp
cat /var/www/myapp/server.js
exit
```

---

## Droplet Console (browser, no SSH from PC)

1. DigitalOcean → **Droplets** → your droplet  
2. **Access** → **Launch Droplet Console**  
3. Log in as **root**

Use this when SSH from your PC does not work.

---

## What’s on the server

| Piece | Role |
|-------|------|
| **Node + Express** | App on port 3000 |
| **systemd `myapp`** | Keeps app running |
| **Nginx** | Port 80 → app |
| **UFW firewall** | Allows SSH + web |

---

## Project files

| File | Purpose |
|------|---------|
| `server.js` | App code |
| `package.json` | npm dependencies |
| `deploy.ps1` | Deploy to DigitalOcean |
| `setup-server.sh` | One-time server setup (already done) |
| `README.md` | Short overview |
| `INSTRUCTIONS.md` | This file |

---

## Security reminders

- Droplet is OK for learning / a simple public page.
- Add **HTTPS** when you have a domain and real users.
- Do not share SSH passphrases or private keys in chat.
- `id_deploy` has no passphrase — keep your PC locked.

---

## Starting the real MyInfoApp

1. Decide what the app should do (one sentence).
2. Tell Cursor **one step at a time**.
3. Edit code locally → **deploy** (`.\deploy.ps1`) → **git push** when you want a backup on GitHub.

---

## Quick checklist

| Task | Command |
|------|---------|
| Deploy to droplet | `.\deploy.ps1` |
| Push to GitHub | `git add .` → `git commit -m "..."` → `git push origin main` |
| SSH to server | `ssh root@137.184.132.232` |
| View live site | http://137.184.132.232 |
