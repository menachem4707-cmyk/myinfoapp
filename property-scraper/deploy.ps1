$ErrorActionPreference = "Stop"

# Deploy the property-scraper service to the existing droplet.
$Key = "$env:USERPROFILE\.ssh\id_deploy"
$Host_ = "root@137.184.132.232"
$RemoteDir = "/var/www/property-scraper"
$LocalDir = $PSScriptRoot
$SshOpts = @("-o", "IdentitiesOnly=yes", "-i", $Key)

Write-Host "Deploying property-scraper to 137.184.132.232 ..."

# Ensure remote dirs exist
ssh @SshOpts $Host_ "mkdir -p $RemoteDir/src $RemoteDir/sql"

# Copy source, sql, and package.json (NOT .env — that lives only on the server)
scp @SshOpts "$LocalDir\package.json" "${Host_}:${RemoteDir}/"
scp @SshOpts "$LocalDir\src\*" "${Host_}:${RemoteDir}/src/"
scp @SshOpts "$LocalDir\sql\*" "${Host_}:${RemoteDir}/sql/"

# Install deps, apply migrations, restart the service
ssh @SshOpts $Host_ "cd $RemoteDir && npm install --omit=dev --silent 2>/dev/null; node src/cli.js migrate; systemctl restart property-scraper; systemctl --no-pager status property-scraper | head -n 5"

Write-Host ""
Write-Host "Done. Service is on http://127.0.0.1:3001 (localhost-only)."
