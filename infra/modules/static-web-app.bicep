targetScope = 'resourceGroup'

// Static Web Apps is not available in every region (notably not swedencentral).
// This module intentionally does not inherit the resource group's location —
// see the 'location' param passed from main.bicep.
param location string
param tags object = {}
param resourceToken string

resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: 'swa-spiir-${resourceToken}'
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    buildProperties: {
      appLocation: '/'
      outputLocation: 'dist'
    }
  }
}

output name string = staticWebApp.name
output uri string = 'https://${staticWebApp.properties.defaultHostname}'
