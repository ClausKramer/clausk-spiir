targetScope = 'resourceGroup'

param location string = resourceGroup().location
param tags object = {}
param resourceToken string
param logAnalyticsCustomerId string
@secure()
param logAnalyticsSharedKey string

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-spiir-${resourceToken}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: logAnalyticsSharedKey
      }
    }
  }
}

output id string = containerAppsEnvironment.id
