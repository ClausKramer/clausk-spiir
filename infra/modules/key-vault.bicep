targetScope = 'resourceGroup'

param location string = resourceGroup().location
param tags object = {}
param resourceToken string
param deployerPrincipalId string

@secure()
param jwtSigningKey string
@secure()
param enableBankingApplicationId string
@secure()
param enableBankingPrivateKey string
@secure()
param anthropicApiKey string
param sqlConnectionString string

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-spiir-${resourceToken}'
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
  }
}

resource jwtKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'jwt-key'
  properties: {
    value: jwtSigningKey
  }
}

resource enableBankingApplicationIdSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'enablebanking-application-id'
  properties: {
    value: enableBankingApplicationId
  }
}

resource enableBankingPrivateKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'enablebanking-private-key'
  properties: {
    value: enableBankingPrivateKey
  }
}

resource anthropicApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'anthropic-api-key'
  properties: {
    value: anthropicApiKey
  }
}

resource sqlConnectionStringSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'sql-connection-string'
  properties: {
    value: sqlConnectionString
  }
}

// Lets the deploying user manage secrets via `az keyvault secret set` after provisioning
// (e.g. to rotate Enable Banking/Anthropic credentials without a full redeploy).
resource deployerSecretsOfficerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, deployerPrincipalId, 'Key Vault Secrets Officer')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7')
    principalId: deployerPrincipalId
    principalType: 'User'
  }
}

output name string = keyVault.name
output uri string = keyVault.properties.vaultUri
