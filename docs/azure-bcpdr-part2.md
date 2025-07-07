# Azure BCP/DR with Backup & Restore: Part 2 – Compute, Firewall, VPN, and Restore

**[Back to Part 1: Resource Group, Storage, and Network Foundation](azure-bcpdr-part1.md)**

This part continues the step-by-step BCP/DR process, focusing on compute, firewall, VPN, and restoring VMs. All steps are automated using Bicep and PowerShell, but executed manually for full control and auditability.

---

## Step 7: Deploy Fortinet Firewall
Deploy the Fortinet firewall solution, including load balancers, NVAs, and all required public IPs and NICs.


**Command:**
```bash
az deployment group create --name gdepdr-nva --resource-group dr-rg-gdep-pwus-deployment --template-file ./compute/vm/nva/nva.bicep --parameters ./compute/vm/nva/nva.json
```

**Bicep Code: `nva.bicep`**
```bicep
param location string = resourceGroup().location
param resource_group string
param adminusername string
@secure()
param adminPassword string
param fortinetoffer string //Will need to check what is availabe at the time of DR (fortinet_fortigate-vm_v5)
param fortinetsku string //Will need to check what is availabe at the time of DR (fortinet_fg-vm_payg_2023)

// ...existing code for variables and modules (see repo for full details)...
// This Bicep deploys:
// - Public IPs for Fortinet
// - External and internal load balancers
// - 8 NICs for Fortinet VMs
// - 2 Fortinet NVA VMs with all required extensions
```

**Parameter File: `nva.json`**
```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "resource_group": {
      "value": "dr-rg-gdep-pwus-fortinet"
    },
    "adminusername": {
      "value": "nvafwadmin"
    },
    "fortinetoffer": {
      "value": "fortinet_fortigate-vm_v5"
    },
    "fortinetsku": {
      "value": "fortinet_fg-vm_payg_2023"
    },
    "adminPassword": {
      "reference": {
        "keyVault": {
          "id": "/subscriptions/df8d9f29-f5c5-4e48-a004-21ea3b8a4834/resourceGroups/rg-gdep-peus-applications/providers/Microsoft.KeyVault/vaults/kv-gdep-peus-iac"
        },
        "secretName": "new-vm-password"
      }
    }
  }
}
```

**Explanation:**
- The Bicep file provisions Fortinet NVAs, load balancers, public IPs, NICs, and all required networking for the DR firewall solution.
- The parameter file provides values for resource group, admin credentials, and Fortinet offer/SKU.

---

## Step 8: Fortinet Firewall Manual Steps
- Obtain or create a backup of the NVA configuration (from SFTP or by running `backup.py` in the scripts folder).
- Update alias/host names as needed for the DR region.
- Import configuration via the Fortinet web interface for each NVA in West US.
- Confirm settings via Serial Console.
- Ensure Point-to-Site VPN is up before proceeding.

---

## Step 9: Deploy Point-to-Site VPN
Deploy the P2S VPN gateway and configuration.


**Command:**
```bash
az deployment group create --name gdepdr-p2s --resource-group dr-rg-gdep-pwus-deployment --template-file ./networking/p2s/p2s.bicep --parameters ./networking/p2s/p2sp.json
```

**Bicep Code: `p2s.bicep`**
```bicep
/*
Lets create Point to Site VPN for users to connect into US West
Create PIP, VPN Gateway, for PIP we have no dependency but 
for VPN Gateway we do.  As such notice 
*/
param location string = resourceGroup().location
param resource_group string

var applicationtag = 'Infrastructure'
var environmetag = 'Disaster Recovery'
var AADTenant = '${environment().authentication.loginEndpoint}${subscription().tenantId}'

module pipgdepdrfw '../../networking/pip/pip.bicep' = {
  name: '${deployment().name}-pipp2svpn'
  scope: resourceGroup(resource_group)
  params: {
    name: 'pip-gdep-pwus-p2svpn'
    location: location
    tags: { Application: applicationtag, Environment: environmetag }
    properties: {
      publicIPAllocationMethod: 'Static'
      publicIPAddressVersion: 'IPv4'
    }
  }
}
//Create VPN Gateway
module vngwpoint2site './p2sngw.bicep' = {
  name: '${deployment().name}-vngwpoint2site'
  scope: resourceGroup('dr-rg-gdep-pwus-vnets')
  params: {
    name: 'vngw_gdep_pwus'
    location: location
    tags: { Application: applicationtag, Environment: environmetag }
    properties: {
      enablePrivateIpAddress: false
      ipConfigurations: [ ... ]
      sku: {
        name: 'VpnGw2'
        tier: 'VpnGw2'
      }
      gatewayType: 'Vpn'
      vpnType: 'RouteBased'
      enableBgp: false
      activeActive: false
      vpnClientConfiguration: {
        vpnClientAddressPool: {
          addressPrefixes: ['10.27.48.0/22']
        }
        vpnClientProtocols: ['OpenVPN']
        vpnAuthenticationTypes: ['AAD']
        aadTenant: AADTenant
        aadAudience: '41b23e61-6c1e-4545-b367-cd054e0ed4b4'
        aadIssuer: '${'https://sts.windows.net/'}${subscription().tenantId}${'/'}'
      }
      customRoutes: {
        addressPrefixes: [ ... ]
      }
      vpnGatewayGeneration: 'Generation2'
    }
  }
}
```

**Parameter File: `p2sp.json`**
```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "resource_group": {
      "value": "dr-rg-gdep-pwus-fortinet"
    }
  }
}
```

**Explanation:**
- The Bicep file provisions the VPN gateway, public IP, and all required settings for secure remote access to the DR environment.

---

## Step 10: Restore Virtual Machines or Disks
Restore VMs using PowerShell Core. All VMs to be restored should be listed in `vmlist.json`.


**Command:**
```powershell
pwsh ./scripts/bcpdr/vm/restorevms.ps1 -restorediskonly "false" -numberofhours2wait 5 -vmlist './scripts/bcpdr/vm/vmlist.json'
```

**PowerShell Script: `restorevms.ps1`**
```powershell
# Boolean variable to indicate whether to restore disks only
# If it is True then VM will also be created so be careful 
param (
    [string] $restorediskonly = "false",
    [int] $numberofhours2wait = 2,
    [string] $vmlist = './scripts/bcpdr/vm/vmlist.json'
)

# ...existing code for restore logic (see repo for full details)...
# This script restores VMs or disks from backup, as defined in the JSON file.
# Set -restorediskonly to false to create VMs directly.
# Adjust -numberofhours2wait as needed for your restore window.
```

**Explanation:**
- The script restores VMs or disks from backup, as defined in the JSON file.
- Set `-restorediskonly` to `false` to create VMs directly.
- Adjust `-numberofhours2wait` as needed for your restore window.

---

## Step 11: Attach NICs to Restored VMs
Attach NICs to the restored VMs using PowerShell Core. This can be run multiple times safely.


**Command:**
```powershell
pwsh ./scripts/bcpdr/vm/attachnics.ps1 -vaultname "<your-recovery-vault>" -vaultresourcegroupname "<your-backup-rg>" -vmlist './scripts/bcpdr/vm/vmlist.json'
```

**PowerShell Script: `attachnics.ps1`**
```powershell
param (
    [string] $vmlist = './scripts/bcpdr/vm/vmlist.json',
    [string] $vaultname = 'rsv-prod-eus-01',
    [string] $vaultresourcegroupname = 'rg-gdep-peus-backup'
)

# ...existing code for NIC attachment logic (see repo for full details)...
# This script attaches network interfaces to the restored VMs.
# Replace <your-recovery-vault> and <your-backup-rg> with your actual values.
```

**Explanation:**
- The script attaches network interfaces to the restored VMs.
- Replace `<your-recovery-vault>` and `<your-backup-rg>` with your actual values.

---

## Additional Tips
- If you need to re-run any step, you can safely delete previous deployments and start again.
- All steps are idempotent and can be repeated as needed.

---

## Summary: Why Backup & Restore?
- **Cost:** No ongoing replication costs as with Azure Site Recovery (ASR).
- **Control:** You decide what to restore and when.
- **RTO/RPO:** For many workloads, restore times and backup frequency are sufficient.
- **Flexibility:** Restore to any region (here, from East to West US).

**When to Use This Approach:**
- When RTO/RPO requirements are not sub-minute.
- When cost is a concern.
- When you want full control over the DR process.

**When to Use Azure Site Recovery:**
- When you need near-instant failover and minimal data loss.
- When you want fully automated DR with minimal manual steps.

---

**[Back to Part 1](azure-bcpdr-part1.md)**
