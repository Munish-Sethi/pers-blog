# Part 2: Deploying Azure Virtual Desktop (AVD) Desktops

This article provides a detailed, step-by-step guide to deploying AVD VMs from a custom image in the Azure Compute Gallery, joining them to a domain, and ensuring a successful deployment. For the image creation process, see [Part 1: Building and Publishing an AVD Image](avd-custon-image-compute-gallery-part1.md).

---

## Overview

The process involves:
- Reviewing and updating parameter files for deployment
- Deploying AVD VMs using Bicep and Azure CLI
- Joining VMs to the domain using a privileged service account
- Post-deployment validation and best practices

---

## Step 1: Review and Update Parameter File

Before deploying, ensure your parameter file (e.g., `avdp.json`) is up to date with the correct image reference, VM size, network settings, and domain join information.

### Example Parameter File (`avdp.json`)

```json
{
  "resource_group": { "value": "rg-gdep-peus-avd-pools" },
  "nic_subnet_resourcegroup": { "value": "rg-gdep-peus-vnets" },
  "nic_vnet_name": { "value": "GDEP_VNET_PROD" },
  "nic_subnet_name": { "value": "Prod_AVD_FS_Subnet" },
  "vm_name": { "value": "AZGDEPENG" },
  "adminusername": { "value": "avdadmin" },
  "hostpoolname": { "value": "GDEP_Engineering" },
  "adminPassword": {
    "reference": {
      "keyVault": {
        "id": "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.KeyVault/vaults/<vault-name>"
      },
      "secretName": "new-vm-password"
    }
  },
  "adadminusername": { "value": "service-account@yourdomain.com" },
  "adadminPassword": {
    "reference": {
      "keyVault": {
        "id": "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.KeyVault/vaults/<vault-name>"
      },
      "secretName": "ad-join-password"
    }
  },
  "hostpoolregistrationkey": {
    "reference": {
      "keyVault": {
        "id": "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.KeyVault/vaults/<vault-name>"
      },
      "secretName": "avd-host-pool-reg-key"
    }
  },
  "vmCount": { "value": 1 }
}
```

**Parameter Explanations:**
- `resource_group`, `nic_subnet_resourcegroup`, `nic_vnet_name`, `nic_subnet_name`: Networking and resource group settings.
- `vm_name`: Prefix for VM names.
- `adminusername`/`adminPassword`: Local admin credentials for the VM (use Key Vault for secrets).
- `adadminusername`/`adadminPassword`: **Service account** with delegated rights to join computers to the domain. Do not use personal admin accounts; use a dedicated service account.
- `hostpoolname`, `hostpoolregistrationkey`: AVD host pool registration details.
- `vmCount`: Number of VMs to deploy.

---

## Step 2: Full Bicep Code for AVD Deployment

Below is the full Bicep code for deploying AVD VMs, joining them to the domain, and registering them with the AVD host pool.

```bicep
param location string = resourceGroup().location
param resource_group string
param nic_subnet_resourcegroup string
param nic_vnet_name string
param nic_subnet_name string
param vm_name string
param adminusername string
param adadminusername string
param hostpoolregistrationkey string
param hostpoolname string  
param vmCount int

@secure()
param adminPassword string
@secure()
param adadminPassword string

var applicationtag = 'Virtual Desktop'
var environmetag = 'Production'
var domain = 'yourdomain.com'
var ou2add2 = 'OU=Computers,OU=Standard,OU=Virtual Desktops,OU=Azure,OU=GD,DC=yourdomain,DC=com'

@description('Create NICs for each VM')
module nicgdepavd '../../../networking/nic/nic.bicep' = [for i in range(0, vmCount):{
  name: '${deployment().name}-nic${i}'
  scope: resourceGroup(resource_group)
  params: {
    name: 'nicgdepp${location}${vm_name}${i}'
    location: location
    tags: { Application: applicationtag, Environment: environmetag }
    properties: {
      ipConfigurations: [
        {
          name: 'ipconfig'
          properties: {
            privateIPAllocationMethod: 'Dynamic'
            subnet: {
              id: resourceId(
                '${nic_subnet_resourcegroup}',
                'Microsoft.Network/virtualNetworks/subnets',
                '${nic_vnet_name}',
                '${nic_subnet_name}'
              )
            }
          }
        }
      ]
    }
  }
}]

@description('Create the AVD VM(s)')
module vmgdepavd '../vm.bicep' = [for i in range(0, vmCount): {
  name: '${deployment().name}-${i}'
  scope: resourceGroup(resource_group)
  params: {
    name: '${vm_name}-${i}'
    location: location
    tags: { Application: applicationtag, Environment: environmetag }
    properties: {
      hardwareProfile: { vmSize: 'Standard_NV16as_v4' }
      storageProfile: {
        imageReference: {
          id: resourceId('Microsoft.Compute/galleries/images', 'GDEP_Azure_Compute_Gallery', 'Win11AVD')
        }
        osDisk: {
          createOption: 'FromImage'
          diskSizeGB: 512
          managedDisk: { storageAccountType: 'Premium_LRS' }
        }
      }
      osProfile: {
        computerName: '${vm_name}-${i}'
        adminUsername: adminusername
        adminPassword: adminPassword
        windowsConfiguration: {
          provisionVMAgent: true
          enableAutomaticUpdates: true
        }
      }
      networkProfile: {
        networkInterfaces: [
          {
            id: nicgdepavd[i].outputs.id
            properties: { deleteOption: 'Delete' }
          }
        ]
      }
      diagnosticsProfile: { bootDiagnostics: { enabled: true } }
      licenseType: 'Windows_Client'
    }
  }
}]

@description('Add Custom Script Extension for Kofax')
resource extkofaxcustomscript 'Microsoft.Compute/virtualMachines/extensions@2024-03-01' = [for i in range(0, vmCount): {
  name: '${vm_name}-${i}/CustomScriptExtension'
  location: location
  tags: {
    Environment: environmetag
    Application: applicationtag
  }
  properties: {
    publisher: 'Microsoft.Compute'
    type: 'CustomScriptExtension'
    typeHandlerVersion: '1.9'
    autoUpgradeMinorVersion: true
    settings: {
      commandToExecute: 'powershell.exe -ExecutionPolicy Unrestricted -Command "Invoke-WebRequest -Uri \'https://storeusgdepsoftware.blob.core.windows.net/software4avd/avdkofax.ps1\' -OutFile \'C:\\software\\avdkofax.ps1\'; Set-Location -Path \'C:\\software\'; .\\avdkofax.ps1"'
    }
  }
  dependsOn: [
    vmgdepavd[i]
  ]
}]

@description('Join VM(s) to the domain')
resource extadd2adcustomscript 'Microsoft.Compute/virtualMachines/extensions@2024-03-01' = [for i in range(0, vmCount): {
  name: '${vm_name}-${i}/joindomain'
  location: location
  tags: {
    Environment: environmetag
    Application: applicationtag
  }
  properties: {
    autoUpgradeMinorVersion: true
    publisher: 'Microsoft.Compute'
    type: 'JsonADDomainExtension'
    typeHandlerVersion: '1.3'
    settings: {
      name: domain
      ouPath: ou2add2
      user: adadminusername
      restart: true
      options: '3'
    }
    protectedSettings: {
      password: adadminPassword
    }
  }
  dependsOn: [
    vmgdepavd[i]
    extkofaxcustomscript[i]
  ]
}]

@description('Register VM(s) with AVD Host Pool')
resource vmExtension 'Microsoft.Compute/virtualMachines/extensions@2024-03-01' = [for i in range(0, vmCount): {
  name: '${vm_name}-${i}/Microsoft.PowerShell.DSC'
  location: location
  tags: {
    Environment: environmetag
    Application: applicationtag
  }
  properties: {
    autoUpgradeMinorVersion: true
    publisher: 'Microsoft.Powershell'
    type: 'DSC'
    typeHandlerVersion: '2.73'
    settings: {
      modulesUrl: 'https://wvdportalstorageblob.blob.core.windows.net/galleryartifacts/Configuration_1.0.02714.342.zip'
      configurationFunction: 'Configuration.ps1\\AddSessionHost'
      properties: {
        hostPoolName: hostpoolname
        registrationInfoToken: hostpoolregistrationkey
        aadJoin: false
        UseAgentDownloadEndpoint: true
      }
    }
  }
  dependsOn: [
    vmgdepavd[i]
    extkofaxcustomscript[i]
    extadd2adcustomscript[i]
  ]
}]
```

---

## Step 3: Deploy the AVD VM(s) Using Azure CLI

Use the following command to deploy the VM(s):

```bash
az deployment group create --name gdepiacavd --resource-group rg-gdep-peus-avd-pools --template-file ./compute/vm/avd/avd.bicep --parameters @./compute/vm/avd/avdp.json
```

- This command deploys the VM(s) using the custom image and parameters.

---

## Step 4: Domain Join and Permissions

- The `adadminusername` must be a **service account** with delegated permissions to join computers to the specified OU in Active Directory.
- Do **not** use personal admin accounts; use a dedicated, least-privilege service account.
- The deployment will use the provided credentials to join the VM to the domain and place it in the correct OU.

---

## Step 5: Post-Deployment Validation

- Log in to the new VM(s) as the local admin account.
- Verify log files (e.g., in `C:\Software`) to ensure a clean build.
- Expand the disk to 512 GB if required.
- (Optional) Install additional software as needed.
- For validation desktops, use the correct host pool name and ensure only authorized users have access.

---

## Security and Best Practices

- Always use secure methods (Key Vault references) for passwords and sensitive data.
- Review all scripts and templates for security and compliance.
- Mask all sensitive information in documentation.
- Use service accounts for domain join, not personal accounts.

## Related Articles
- [Part 1: Building and Publishing an Custom Image](avd-custon-image-compute-gallery-part1.md)
