# Azure BCP/DR with Backup & Restore: Part 1 – Resource Group, Storage, and Network Foundation

This multi-part technical blog series walks you through a practical, cost-effective approach to Business Continuity and Disaster Recovery (BCP/DR) in Azure using backup and restore, rather than Azure Site Recovery. The scenario targets restoring all critical infrastructure from Azure East (primary) to Azure West (DR region). Each step is explained with code and rationale, so you can duplicate this in your own environment.

**[Part 2: Compute, Firewall, and Final Steps](azure-bcpdr-part2.md)**

---

## Why This Approach?
- **Cost-Effective:** Backup and restore avoids the ongoing costs of Azure Site Recovery (ASR) replication.
- **Simplicity:** You control what is restored and when, with clear, auditable steps.
- **RTO/RPO:** Recovery Time Objective (RTO) and Recovery Point Objective (RPO) are acceptable for many workloads, as restore times are predictable and backups are recent.
- **Flexibility:** You can restore to any region, in this case from East to West US.

---

## Step 1: Create the Target Resource Group (Manual)
This is the only step that must be done manually in the Azure Portal or CLI. It creates the DR resource group in the target region (West US).

- **Resource Group Name:** `dr-rg-gdep-pwus-deployment`
- **Region:** West US
- **Tags:** Infrastructure, Disaster Recovery

**Command:**
```bash
az group create --name dr-rg-gdep-pwus-deployment --location westus --tags "Purpose=Infrastructure" "Type=DisasterRecovery"
```

---

## Step 2: Deploy Resource Groups via Bicep
This step uses a Bicep template to deploy any additional resource groups needed for the DR environment.


**Command:**
```bash
az deployment group create --name gdepdr-rg --template-file ./rg/rg_main.bicep --resource-group dr-rg-gdep-pwus-deployment
```

**Bicep Code: `rg_main.bicep`**
```bicep
param location string = 'westus'
var environmetag = 'Disaster Recovery'

param resourcegroups2create array = [
  'dr-rg-gdep-pwus-infrastructure'
  'dr-rg-gdep-pwus-vnets'
  'dr-rg-gdep-pwus-fortinet'
  'dr-rg-gdep-pwus-meraki-sdwan'
]

module rggdepwus './rg.bicep' = [for rggroupname in resourcegroups2create: {
  name: '${deployment().name}-${rggroupname}'
  scope:subscription()
  params: {
    name: rggroupname
    location: location
    tags: {Application:'Infrastructure',Environment: environmetag}
    }
}]
```

**Supporting Bicep: `rg.bicep`**
```bicep
targetScope='subscription'

param name string 
param location string
param tags object

resource rggdepdrwus 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: name
  location: location
  tags: tags
}
output resourceGroupName string = rggdepdrwus.name
```

**Explanation:**
- `rg_main.bicep` loops through a list of DR resource group names and deploys each using the `rg.bicep` module.
- `rg.bicep` creates a resource group at the subscription level with the specified name, location, and tags.
- This ensures all required DR resource groups are created consistently and tagged for easy management.

---

## Step 3: Create Staging Storage Account
Deploy a storage account for staging backups and other DR artifacts.


**Command:**
```bash
az deployment group create --name gdepdr-sa-staging --resource-group dr-rg-gdep-pwus-deployment --template-file ./storage/sa/sa_staging.bicep
```

**Bicep Code: `sa_staging.bicep`**
```bicep
param location string = resourceGroup().location
var applicationtag = 'Infrastructure'
var environmetag = 'Disaster Recovery'
var infrastructure_rg_name = 'dr-rg-gdep-pwus-infrastructure'

@description('This Storage Account is used as a Staging account to restore VM(s)')
module sagdepdrwusstaging './sa.bicep' = {
  name: '${deployment().name}-sa-gdep-pwus-staging'
  scope: resourceGroup(infrastructure_rg_name)
  params: {
    name: 'storegdeppwusstaging'
    location: location
    tags: { Application: applicationtag, Environment: environmetag }
    properties: {
      accessTier: 'Hot'
      allowBlobPublicAccess: false
      allowCrossTenantReplication: false
      allowSharedKeyAccess: true
      defaultToOAuthAuthentication: false
      dnsEndpointType: 'Standard'
      encryption: {
        keySource: 'Microsoft.Storage'
        requireInfrastructureEncryption: false
        services: {
          blob: {
            enabled: true
            keyType: 'Account'
          }
          file: {
            enabled: true
            keyType: 'Account'
          }
        }
      }
      largeFileSharesState: 'Enabled'
      minimumTlsVersion: 'TLS1_2'
      networkAcls: {
        bypass: 'AzureServices'
        defaultAction: 'Allow'
        ipRules: []
        virtualNetworkRules: []
      }
      publicNetworkAccess: 'Enabled'
      supportsHttpsTrafficOnly: true
    }
  }
}
```

**Supporting Bicep: `sa.bicep`**
```bicep
param location string
param name string
param tags object
param properties object

resource sagdepdrwus 'Microsoft.Storage/storageAccounts@2023-04-01' = {
  name: name
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: properties
}

resource sagdepdrwusblobservices 'Microsoft.Storage/storageAccounts/blobServices@2023-04-01' = {
  parent: sagdepdrwus
  name: 'default'
  properties: {
    cors: {
      corsRules: []
    }
    deleteRetentionPolicy: {
      allowPermanentDelete: false
      enabled: false
    }
  }
}

resource sagdepdrwusfileservices 'Microsoft.Storage/storageAccounts/fileServices@2023-04-01' = {
  parent: sagdepdrwus
  name: 'default'
  properties: {
    cors: {
      corsRules: []
    }
    protocolSettings: {
      smb: {}
    }
  }
}

resource sagdepdrwusqueueservices 'Microsoft.Storage/storageAccounts/queueServices@2023-04-01' = {
  parent: sagdepdrwus
  name: 'default'
  properties: {
    cors: {
      corsRules: []
    }
  }
}

resource sagdepdrwustableservices 'Microsoft.Storage/storageAccounts/tableServices@2023-04-01' = {
  parent: sagdepdrwus
  name: 'default'
  properties: {
    cors: {
      corsRules: []
    }
  }
}
```

**Explanation:**
- `sa_staging.bicep` deploys a storage account for DR staging in the infrastructure resource group, with secure settings and encryption.
- The `sa.bicep` module provisions the storage account and all required services (blob, file, queue, table).
- This storage account is used for storing backup files, scripts, and logs during the DR restore process.

---

## Step 4: Create Network Security Groups (NSGs)
Deploy NSGs to secure your DR environment.


**Command:**
```bash
az deployment group create --name gdepdr-nsg --resource-group dr-rg-gdep-pwus-deployment --template-file ./networking/nsg/nsg_main.bicep
```

**Bicep Code: `nsg_main.bicep`**
```bicep
param location string = resourceGroup().location
var applicationtag = 'Infrastructure'
var environmetag = 'Disaster Recovery'
var infrastructure_rg_name = 'dr-rg-gdep-pwus-infrastructure'
var fortinet_rg_name = 'dr-rg-gdep-pwus-fortinet'

@description('Used By Most of our Subnets')
module nsggdepdrwusdefault './nsg.bicep' = {
  name: '${deployment().name}-nsg-gdep-pwus-default'
  scope: resourceGroup(infrastructure_rg_name)
  params: {
    name: 'nsg-gdep-pwus-default'
    location: location
    tags: { Application: applicationtag, Environment: environmetag }
    properties: {}
  }
}
@description('Used By Meraki Public Subnet')
module nsggdepdrwusmeraki './nsg.bicep' = {
  name: '${deployment().name}-nsg-gdep-pwus-meraki'
  scope: resourceGroup(infrastructure_rg_name)
  params: {
    name: 'nsg-gdep-pwus-meraki'
    location: location
    tags: { Application: applicationtag, Environment: environmetag }
    properties: {
      securityRules: [
        {
          name: 'AllowAnyCustom443Inbound'
          type: 'Microsoft.Network/networkSecurityGroups/securityRules'
          properties: {
            description: 'Per Abhishek this may be required when (if) we enable Cisco Anyconnect'
            protocol: '*'
            sourcePortRange: '*'
            destinationPortRange: '*'
            sourceAddressPrefix: '*'
            destinationAddressPrefix: '*'
            access: 'Allow'
            priority: 100
            direction: 'Inbound'
            sourcePortRanges: []
            destinationPortRanges: []
            sourceAddressPrefixes: []
            destinationAddressPrefixes: []
          }
        }
        {
          name: 'AllowAnyCustom443InboundUDP'
          type: 'Microsoft.Network/networkSecurityGroups/securityRules'
          properties: {
            protocol: 'UDP'
            sourcePortRange: '443'
            destinationPortRange: '443'
            sourceAddressPrefix: '*'
            destinationAddressPrefix: '*'
            access: 'Allow'
            priority: 110
            direction: 'Inbound'
            sourcePortRanges: []
            destinationPortRanges: []
            sourceAddressPrefixes: []
            destinationAddressPrefixes: []
          }
        }
        {
          name: 'AllowAny'
          type: 'Microsoft.Network/networkSecurityGroups/securityRules'
          properties: {
            protocol: '*'
            sourcePortRange: '*'
            destinationPortRange: '*'
            sourceAddressPrefix: '*'
            destinationAddressPrefix: '*'
            access: 'Allow'
            priority: 120
            direction: 'Outbound'
            sourcePortRanges: []
            destinationPortRanges: []
            sourceAddressPrefixes: []
            destinationAddressPrefixes: []
          }
        }
      ]
    }
  }
}
@description('Used By Fortinet Firewall')
module nsggdepdrwusfortinet './nsg.bicep' = {
  name: '${deployment().name}-nsg-gdep-pwus-fortinet'
  scope: resourceGroup(fortinet_rg_name)
  params: {
    name: 'nsg-gdep-pwus-fortinet'
    location: location
    tags: { Application: applicationtag, Environment: environmetag }
    properties: {
      securityRules: [
        {
          name: 'AllowAllOutbound'
          properties: {
            access: 'Allow'
            description: 'Allow all out'
            destinationAddressPrefix: '*'
            destinationAddressPrefixes: []
            destinationPortRange: '*'
            destinationPortRanges: []
            direction: 'Outbound'
            priority: 105
            protocol: '*'
            sourceAddressPrefix: '*'
            sourceAddressPrefixes: []
            sourcePortRange: '*'
            sourcePortRanges: []
          }
          type: 'Microsoft.Network/networkSecurityGroups/securityRules'
        }
        {
          name: 'AllowAllInbound'
          properties: {
            access: 'Allow'
            destinationAddressPrefix: '*'
            destinationAddressPrefixes: []
            destinationPortRange: '*'
            destinationPortRanges: []
            direction: 'Inbound'
            priority: 110
            protocol: '*'
            sourceAddressPrefix: '*'
            sourceAddressPrefixes: []
            sourcePortRange: '*'
            sourcePortRanges: []
          }
          type: 'Microsoft.Network/networkSecurityGroups/securityRules'
        }
      ]
    }
  }
}
```

**Supporting Bicep: `nsg.bicep`**
```bicep
param location string 
param name string 
param tags object
param properties object

resource nsggdepdrwus 'Microsoft.Network/networkSecurityGroups@2023-09-01'={
  name:name
  location:location
  tags:tags
  properties:properties
}
```

**Explanation:**
- `nsg_main.bicep` deploys three NSGs: default, Meraki, and Fortinet, each with appropriate rules for their subnet roles.
- The `nsg.bicep` module provisions the NSG with the specified rules and tags.
- NSGs are critical for controlling traffic flow and securing your DR network.

---

## Step 5: Create Route Tables
Deploy User Defined Route (UDR) tables for custom routing.


**Command:**
```bash
az deployment group create --name gdepdr-rt --resource-group dr-rg-gdep-pwus-deployment --template-file ./networking/udr/udr_main.bicep
```

**Bicep Code: `udr_main.bicep`**
```bicep
param location string = resourceGroup().location
var applicationtag = 'Infrastructure'
var environmetag = 'Disaster Recovery'

//var infrastructure_rg_name = 'dr-rg-gdep-pwus-infrastructure'
var fortinet_rg_name = 'dr-rg-gdep-pwus-fortinet'
var meraki_sdwan_rg_name = 'dr-rg-gdep-pwus-meraki-sdwan'

@description('Used to route traffic intended to go to On Premise network from Azure Hub')
module udrgdepdrwushub2onprem './udr.bicep' = {
  name: '${deployment().name}-route-gdep-pwus-azurehub-onprem'
  scope: resourceGroup(fortinet_rg_name)
  params: {
    name: 'route-gdep-pwus-azurehub-onprem'
    location: location
    tags: { Application: applicationtag, Environment: environmetag }
    properties: {
      disableBgpRoutePropagation: false
      routes: [ ... ]
    }
  }
}
// ...additional modules for all required UDRs (see full code in repo)...
```

**Supporting Bicep: `udr.bicep`**
```bicep
param location string 
param name string 
param tags object
param properties object

resource rtgdepdrwus 'Microsoft.Network/routeTables@2023-09-01'={
  name:name
  location:location
  tags:tags
  properties:properties
}
```

**Explanation:**
- `udr_main.bicep` deploys all required route tables for the DR environment, including routes for on-premises, spokes, and SDWAN.
- The `udr.bicep` module provisions each route table with the specified routes and settings.
- UDRs are essential for custom traffic flow and integration with firewalls and VPNs.

---

## Step 6: Create Virtual Networks and Subnets
Deploy VNETs, subnets, and associate them with NSGs and UDRs.


**Command:**
```bash
az deployment group create --name gdepdr-vnet --resource-group dr-rg-gdep-pwus-deployment --template-file ./networking/vnet/vnet_main.bicep
```

**Bicep Code: `vnet_main.bicep`**
```bicep
param location string = resourceGroup().location
var applicationtag = 'Infrastructure'
var environmetag = 'Disaster Recovery'

/*
var infrastructure_rg_name = 'dr-rg-gdep-pwus-infrastructure'
var fortinet_rg_name = 'dr-rg-gdep-pwus-fortinet'
var meraki_sdwan_rg_name = 'dr-rg-gdep-pwus-meraki-sdwan'
*/
var vnet_rg_name = 'dr-rg-gdep-pwus-vnets'

@description('Hub Virtual Network with NVA namely Fortinet Firewall')
module vnetgdepdrwusfortinet './vnet.bicep' = {
  name: '${deployment().name}-vnet-gdep-pwus-fortinet'
  scope: resourceGroup(vnet_rg_name)
  params: {
    name: 'vnet-gdep-pwus-fortinet'
    location: location
    tags: { Application: applicationtag, Environment: environmetag }
    properties: {
      addressSpace: {
        addressPrefixes: [ ... ]
      }
      dhcpOptions: {
        dnsServers: [ ... ]
      }
      enableDdosProtection: false
      subnets: [ ... ]
    }
  }
}
// ...additional modules for management and production spokes, and VNET peering (see full code in repo)...
```

**Supporting Bicep: `vnet.bicep`**
```bicep
param location string 
param name string 
param tags object
param properties object

resource vnetgdepdrwus 'Microsoft.Network/virtualNetworks@2023-09-01'={
  name:name
  location:location
  tags:tags
  properties:properties
}
output virtualnetworkname string = vnetgdepdrwus.name
```

**Explanation:**
- `vnet_main.bicep` provisions all required virtual networks and subnets for the DR environment, including hub, management, and production spokes.
- Subnets are associated with NSGs and UDRs as needed, and VNET peering is configured for connectivity.
- The `vnet.bicep` module provisions each VNET with the specified address spaces, subnets, and settings.

---

**[Continue to Part 2: Compute, Firewall, and Final Steps](azure-bcpdr-part2.md)**
