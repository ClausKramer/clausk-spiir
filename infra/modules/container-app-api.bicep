targetScope = 'resourceGroup'

param location string = resourceGroup().location
param tags object = {}
param containerAppsEnvironmentId string
param keyVaultUri string
param appInsightsConnectionString string
param sqlServerName string
param sqlDatabaseName string
param corsOrigin string
param resendFromAddress string

// Placeholder image for initial provisioning — azd deploy wires up the real ACR image
// and the registry/identity link (az containerapp registry set --identity system)
// after the AcrPull role assignment (modules/acr-pull-role.bicep) exists.
param containerImageName string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

var appName = 'ca-spiir-api'

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    environmentId: containerAppsEnvironmentId
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        corsPolicy: {
          allowedOrigins: [corsOrigin]
          allowedMethods: ['*']
          allowedHeaders: ['*']
          allowCredentials: true
        }
      }
      secrets: [
        { name: 'jwt-key', keyVaultUrl: '${keyVaultUri}secrets/jwt-key', identity: 'System' }
        { name: 'enablebanking-application-id', keyVaultUrl: '${keyVaultUri}secrets/enablebanking-application-id', identity: 'System' }
        { name: 'enablebanking-private-key', keyVaultUrl: '${keyVaultUri}secrets/enablebanking-private-key', identity: 'System' }
        { name: 'anthropic-api-key', keyVaultUrl: '${keyVaultUri}secrets/anthropic-api-key', identity: 'System' }
        { name: 'resend-api-key', keyVaultUrl: '${keyVaultUri}secrets/resend-api-key', identity: 'System' }
        { name: 'sql-connection-string', keyVaultUrl: '${keyVaultUri}secrets/sql-connection-string', identity: 'System' }
      ]
      // No registries block — azd deploy configures the ACR/identity link via the Azure API
      // after acr-pull-role.bicep grants this app's system-assigned identity AcrPull.
    }
    template: {
      containers: [
        {
          name: 'api'
          image: containerImageName
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'ASPNETCORE_ENVIRONMENT', value: 'Production' }
            { name: 'ASPNETCORE_URLS', value: 'http://+:8080' }
            { name: 'Jwt__Key', secretRef: 'jwt-key' }
            { name: 'EnableBanking__ApplicationId', secretRef: 'enablebanking-application-id' }
            { name: 'EnableBanking__PrivateKey', secretRef: 'enablebanking-private-key' }
            { name: 'Anthropic__ApiKey', secretRef: 'anthropic-api-key' }
            { name: 'Resend__ApiKey', secretRef: 'resend-api-key' }
            { name: 'Resend__FromAddress', value: resendFromAddress }
            { name: 'ConnectionStrings__DefaultConnection', secretRef: 'sql-connection-string' }
            { name: 'CorsOrigin', value: corsOrigin }
            { name: 'ApplicationInsights__ConnectionString', value: appInsightsConnectionString }
            { name: 'SQL_SERVER', value: sqlServerName }
            { name: 'SQL_DATABASE', value: sqlDatabaseName }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output id string = containerApp.id
output name string = containerApp.name
output principalId string = containerApp.identity.principalId
output fqdn string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
