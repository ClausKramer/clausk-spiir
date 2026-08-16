targetScope = 'resourceGroup'

param location string = resourceGroup().location
param tags object = {}
param resourceToken string

// ACR names must be alphanumeric only, 5-50 characters.
var acrName = replace('crspiir${resourceToken}', '-', '')

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

output name string = containerRegistry.name
output loginServer string = containerRegistry.properties.loginServer
