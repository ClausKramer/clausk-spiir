# Runs after `azd provision`. The SQL server only allows Azure-service traffic by
# default (AllowAzureServices, see infra/modules/sql.bicep) — az sql db query below
# runs from this machine, so it needs its own IP allow-listed first.
$ErrorActionPreference = 'Stop'

azd env get-values | ForEach-Object {
    $name, $value = $_.Split('=', 2)
    Set-Item "env:$name" $value.Trim('"')
}

$MyIp = (Invoke-RestMethod -Uri 'https://api.ipify.org').Trim()
if (-not $MyIp -or $MyIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') {
    throw "ERROR: Could not determine this machine's public IP address (got: '$MyIp')."
}

Write-Host "Allow-listing $MyIp on $env:SQL_SERVER so this machine can run the SQL grant script..."
az sql server firewall-rule create `
  --resource-group $env:AZURE_RESOURCE_GROUP `
  --server $env:SQL_SERVER `
  --name "AllowDeployerIP" `
  --start-ip-address $MyIp `
  --end-ip-address $MyIp `
  --output none

# grant-sql-access.ps1 prefers SERVICE_WEB_NAME over SERVICE_API_NAME. main.bicep deliberately
# does not emit SERVICE_WEB_NAME (see the comment there) so this always resolves to SERVICE_API_NAME.
& "$PSScriptRoot/grant-sql-access.ps1"

# Frontend build needs the API's public URL baked in at build time (see frontend/src/api/client.ts).
# Storing it in the azd environment means every future `azd deploy`/`azd up` picks it up
# automatically when building the 'web' service, with no manual step required after this.
Write-Host "Setting VITE_API_BASE_URL=$env:API_URL for the frontend build..."
azd env set VITE_API_BASE_URL $env:API_URL
