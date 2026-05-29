$ErrorActionPreference = "Stop"

$Key = "$env:USERPROFILE\.ssh\id_deploy"
$Host_ = "root@137.184.132.232"
$RemoteDir = "/var/www/myapp"
$LocalDir = $PSScriptRoot
$SshOpts = @("-o", "IdentitiesOnly=yes", "-i", $Key)

Write-Host "Deploying to 137.184.132.232 ..."

scp @SshOpts "$LocalDir\server.js" "$LocalDir\package.json" "$LocalDir\seed-user.js" "${Host_}:${RemoteDir}/"
ssh @SshOpts $Host_ "mkdir -p $RemoteDir/public"
scp @SshOpts -r "$LocalDir\public\*" "${Host_}:${RemoteDir}/public/"
ssh @SshOpts $Host_ "cd $RemoteDir && npm install --omit=dev --silent 2>/dev/null; systemctl restart myapp; curl -s -o /dev/null -w 'myapp HTTP %{http_code}\n' http://127.0.0.1:3000"

Write-Host ""
Write-Host "Done. Open http://137.184.132.232"
