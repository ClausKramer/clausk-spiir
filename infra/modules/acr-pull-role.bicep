targetScope = 'resourceGroup'

param acrName string
param principalId string

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

// AcrPull built-in role
resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(containerRegistry.id, principalId, 'AcrPull')
  scope: containerRegistry
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}
