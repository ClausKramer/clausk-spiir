#!/bin/bash
# Runs after `azd provision`. The SQL server only allows Azure-service traffic by
# default (AllowAzureServices, see infra/modules/sql.bicep) — az sql db query below
# runs from this machine, so it needs its own IP allow-listed first.
set -e

while IFS= read -r line; do
  [ -n "$line" ] || continue
  key=${line%%=*}
  value=${line#*=}
  case "$value" in
    \"*\") value=${value#\"}; value=${value%\"} ;;
    \'*\') value=${value#\'}; value=${value%\'} ;;
  esac
  export "$key=$value"
done < <(azd env get-values)

MY_IP=$(curl -s https://api.ipify.org)
if ! [[ "$MY_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "ERROR: Could not determine this machine's public IP address (got: '$MY_IP')." >&2
  exit 1
fi

echo "Allow-listing $MY_IP on $SQL_SERVER so this machine can run the SQL grant script..."
az sql server firewall-rule create \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --server "$SQL_SERVER" \
  --name "AllowDeployerIP" \
  --start-ip-address "$MY_IP" \
  --end-ip-address "$MY_IP" \
  --output none

# grant-sql-access.sh prefers SERVICE_WEB_NAME over SERVICE_API_NAME. main.bicep deliberately
# does not emit SERVICE_WEB_NAME (see the comment there) so this always resolves to SERVICE_API_NAME.
"$(dirname "$0")/grant-sql-access.sh"

# Frontend build needs the API's public URL baked in at build time (see frontend/src/api/client.ts).
# Storing it in the azd environment means every future `azd deploy`/`azd up` picks it up
# automatically when building the 'web' service, with no manual step required after this.
echo "Setting VITE_API_BASE_URL=$API_URL for the frontend build..."
azd env set VITE_API_BASE_URL "$API_URL"
