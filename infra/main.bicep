targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the azd environment (used to derive resource names, e.g. "spiir-prod")')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
param location string

@description('Object ID of the principal (user or service principal) that will be the Microsoft Entra admin for the SQL server')
param principalId string

@description('Display name of the admin principal, used as the SQL Entra admin login name')
param principalName string

@allowed(['User', 'Group', 'Application'])
@description('Type of the admin principal — User for interactive azd provision, Application for CI/CD service principals')
param principalType string = 'User'

@secure()
@description('JWT signing key, stored in Key Vault. Generate with: openssl rand -base64 32')
param jwtSigningKey string

// Default to a non-empty placeholder, not ''. Azure Container Apps refuses to start a revision
// if ANY Key-Vault-sourced secret resolves to an empty string ("no secret value was returned"),
// which blocks the whole container — even for these still-optional/stubbed integrations.
@secure()
@description('GoCardless Bank Account Data API secret ID, stored in Key Vault')
param goCardlessSecretId string = 'not-configured'

@secure()
@description('GoCardless Bank Account Data API secret key, stored in Key Vault')
param goCardlessSecretKey string = 'not-configured'

@secure()
@description('Anthropic API key for the categorization fallback, stored in Key Vault')
param anthropicApiKey string = 'not-configured'

var resourceToken = take(uniqueString(subscription().id, environmentName, location), 6)
var tags = {
  'azd-env-name': environmentName
}

resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module monitoring './modules/monitoring.bicep' = {
  name: 'monitoring'
  scope: rg
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
  }
}

module containerRegistry './modules/container-registry.bicep' = {
  name: 'containerRegistry'
  scope: rg
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
  }
}

module containerAppsEnvironment './modules/container-apps-environment.bicep' = {
  name: 'containerAppsEnvironment'
  scope: rg
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
    logAnalyticsCustomerId: monitoring.outputs.logAnalyticsCustomerId
    logAnalyticsSharedKey: monitoring.outputs.logAnalyticsSharedKey
  }
}

module sql './modules/sql.bicep' = {
  name: 'sql'
  scope: rg
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
    principalId: principalId
    principalName: principalName
    principalType: principalType
  }
}

module keyVault './modules/key-vault.bicep' = {
  name: 'keyVault'
  scope: rg
  params: {
    location: location
    tags: tags
    resourceToken: resourceToken
    deployerPrincipalId: principalId
    jwtSigningKey: jwtSigningKey
    goCardlessSecretId: goCardlessSecretId
    goCardlessSecretKey: goCardlessSecretKey
    anthropicApiKey: anthropicApiKey
    sqlConnectionString: sql.outputs.connectionString
  }
}

// Phase 1: Container App with a placeholder image and no registry/KV role assignments yet.
module containerAppApi './modules/container-app-api.bicep' = {
  name: 'containerAppApi'
  scope: rg
  params: {
    location: location
    tags: tags
    containerAppsEnvironmentId: containerAppsEnvironment.outputs.id
    keyVaultUri: keyVault.outputs.uri
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    sqlServerName: sql.outputs.serverName
    sqlDatabaseName: sql.outputs.databaseName
    corsOrigin: staticWebApp.outputs.uri
  }
}

// Phase 2: Role assignments that depend on the Container App's system-assigned identity.
// Kept as separate modules so neither ACR nor Key Vault depend on the Container App directly,
// avoiding a circular dependency.
module acrPullRole './modules/acr-pull-role.bicep' = {
  name: 'acrPullRole'
  scope: rg
  params: {
    acrName: containerRegistry.outputs.name
    principalId: containerAppApi.outputs.principalId
  }
}

module kvSecretsRole './modules/kv-secrets-role.bicep' = {
  name: 'kvSecretsRole'
  scope: rg
  params: {
    keyVaultName: keyVault.outputs.name
    principalId: containerAppApi.outputs.principalId
  }
}

module staticWebApp './modules/static-web-app.bicep' = {
  name: 'staticWebApp'
  scope: rg
  params: {
    // Static Web Apps isn't available in swedencentral — westeurope is the closest
    // supported region. Everything else in this deployment stays in `location`.
    location: 'westeurope'
    tags: tags
    resourceToken: resourceToken
  }
}

output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.outputs.loginServer
output AZURE_KEY_VAULT_NAME string = keyVault.outputs.name
output AZURE_LOG_ANALYTICS_WORKSPACE_ID string = monitoring.outputs.logAnalyticsWorkspaceId
output SQL_SERVER string = sql.outputs.serverName
output SQL_DATABASE string = sql.outputs.databaseName
output SERVICE_API_NAME string = containerAppApi.outputs.name
output API_URL string = containerAppApi.outputs.fqdn
output WEB_URL string = staticWebApp.outputs.uri
// Deliberately NOT emitting SERVICE_WEB_NAME: grant-sql-access.ps1/.sh prefers SERVICE_WEB_NAME
// over SERVICE_API_NAME when granting SQL data-plane access (an App Service-style convention
// where "web" is the API). Here "web" is the Static Web App frontend, which has no identity and
// needs no DB access — emitting SERVICE_WEB_NAME would make the grant script target the wrong
// resource. STATIC_WEB_APP_NAME below carries the same value under a name the script won't key off.
output STATIC_WEB_APP_NAME string = staticWebApp.outputs.name
