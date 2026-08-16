targetScope = 'resourceGroup'

param location string = resourceGroup().location
param tags object = {}
param resourceToken string

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-spiir-${resourceToken}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-spiir-${resourceToken}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspace.id
    IngestionMode: 'LogAnalytics'
  }
}

output logAnalyticsWorkspaceId string = logAnalyticsWorkspace.id
output logAnalyticsCustomerId string = logAnalyticsWorkspace.properties.customerId
#disable-next-line outputs-should-not-contain-secrets
output logAnalyticsSharedKey string = logAnalyticsWorkspace.listKeys().primarySharedKey
output appInsightsConnectionString string = appInsights.properties.ConnectionString
