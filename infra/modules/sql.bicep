targetScope = 'resourceGroup'

param location string = resourceGroup().location
param tags object = {}
param resourceToken string
param principalId string
param principalName string
@allowed(['User', 'Group', 'Application'])
param principalType string = 'User'

var sqlServerName = 'sql-spiir-${resourceToken}'
var sqlDatabaseName = 'sqldb-spiir'

// Entra-only authentication. No administratorLogin / administratorLoginPassword —
// the deploying principal becomes the Entra admin, and the app connects via its
// system-assigned managed identity (see modules/container-app-api.bicep).
resource sqlServer 'Microsoft.Sql/servers@2023-08-01' = {
  name: sqlServerName
  location: location
  tags: tags
  properties: {
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: principalType
      login: principalName
      sid: principalId
      tenantId: subscription().tenantId
      azureADOnlyAuthentication: true
    }
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  tags: tags
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 1
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: 34359738368 // 32 GB
    autoPauseDelay: 60 // minutes
    minCapacity: json('0.5')
  }
}

resource sqlFirewallAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01' = {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

output serverName string = sqlServer.name
output databaseName string = sqlDatabase.name
output fullyQualifiedDomainName string = sqlServer.properties.fullyQualifiedDomainName
// Entra-only, system-assigned managed identity — no credentials in this string.
// Connect Timeout=60: the database is serverless and auto-pauses when idle, and its resume from
// pause routinely takes longer than the client default of ~15s — every "Connection Timeout
// Expired" in the logs during a cold start was this, not a real outage. 60s comfortably covers
// Azure SQL's documented worst case without masking a genuinely unreachable server for a full
// minute (it still fails fast once actually connected — this only widens the initial handshake).
output connectionString string = 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Database=${sqlDatabase.name};Authentication=Active Directory Managed Identity;Encrypt=True;TrustServerCertificate=False;Connect Timeout=60;'
