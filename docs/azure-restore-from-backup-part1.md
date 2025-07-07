# Azure VM Restore from Backup – Part 1: Automated Restore with PowerShell

This article is Part 1 of a two-part series on automating Azure VM restore from Recovery Services Vault (RSV) backups, enabling Business Continuity/Disaster Recovery (BCP/DR) across regions. Here, we focus on the main restore process using the `restorevms.ps1` script. In [Part 2](./azure-restore-from-backup-part2.md), we cover NIC re-creation and IP assignment for a true like-for-like DR.

---

## Overview
- **Goal:** Restore VMs from backup in one Azure region (e.g., East US) to another (e.g., West US) for BCP/DR.
- **Approach:** Use PowerShell and Azure CLI to automate finding the latest restore point and restoring the VM, including all required network and resource group settings.
- **Why:** This approach ensures your DR VM is as close as possible to the original, with minimal manual effort.

---

## The Script: `restorevms.ps1`

Below is the full script used to automate the restore process:

```powershell
# Boolean variable to indicate whether to restore disks only
# If it is True then VM will also be created so be careful 
param (
    [string] $restorediskonly = "false",
    [int] $numberofhours2wait = 2,
    [string] $vmlist = './scripts/bcpdr/vm/vmlist.json'
)

########################################################
# Install Azure CLI manually if not installed already
# curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
########################################################
function Get-Latest-Recovery-Point {
    param (
        [string]$vmname,    
        [string]$vmcontainername,
        [string]$vaultname,
        [string]$vaultresourcegroupname
    )

    $latest_recovery_point = az backup recoverypoint list `
        --container-name $vmcontainername `
        --backup-management-type AzureIaasVM `
        --item-name $vmname `
        --resource-group $vaultresourcegroupname `
        --vault-name $vaultname `
        --query "[0]" `
        --use-secondary-region `
        --output json `
    | ConvertFrom-Json
    | Select-Object -ExpandProperty name

    return $latest_recovery_point
}
function Restore-Disks {
    param (
        [string]$vmname,    
        [string]$vmcontainername,
        [string]$vaultname,
        [string]$vaulresourcegrouptname,
        [string]$storageaccountname,
        [string]$recoverypointname,
        [string]$targetresourcegroupname,
        [string]$targetvmname = '',
        [string]$targetvnetname = '',
        [string]$targetvnetresourcegroup = '',
        [string]$targetsubnetname = '',
        [bool]$restoretodisk = $false
    )
    if ($restoretodisk) {
        $restore_operation = az backup restore restore-disks `
            --resource-group $vaulresourcegrouptname `
            --vault-name $vaultname `
            --restore-mode AlternateLocation `
            --container-name $vmcontainername `
            --item-name $vmname `
            --storage-account $storageaccountname `
            --rp-name $recoverypointname `
            --target-resource-group $targetresourcegroupname `
            --restore-to-staging-storage-account $true `
            --use-secondary-region
    }
    else {
        $restore_operation = az backup restore restore-disks `
            --resource-group $vaulresourcegrouptname `
            --vault-name $vaultname `
            --container-name $vmcontainername `
            --item-name $vmname `
            --storage-account $storageaccountname `
            --rp-name $recoverypointname `
            --target-resource-group $targetresourcegroupname `
            --target-vm-name $targetvmname `
            --target-vnet-name $targetvnetname `
            --target-vnet-resource-group $targetvnetresourcegroup `
            --target-subnet-name $targetsubnetname `
            --use-secondary-region 
    }    

    return $restore_operation
}
function Invoke-AzureCLICommand {
    param (
        [string]$command,
        [string]$message = ""
    )

    if (-not [string]::IsNullOrEmpty($message)) {
        Write-CustomLog ("About to run message {0}" -f $message)
        Write-CustomLog ("About to run command {0}" -f $command)
    }
    $executionResult = Invoke-Expression $command
    return $executionResult
}
# logging function which should work on both local dev container and Git Hub action
function Write-CustomLog {
    param (
        [string]$message
    )
    Write-Host "::notice::$message"
}

$booleanRestorediskonly = $false

switch ($restorediskonly.ToLower()) {
    "true" {
        $restorediskonly = [bool]$true
        $booleanRestorediskonly = $true
    }
    "false" {
        $restorediskonly = [bool]$false
        $booleanRestorediskonly = $false
    }
    default {
        throw "Invalid value for restorediskonly: $restorediskonly. Must be 'true' or 'false'."
    }
}

# Log values with type information
Write-CustomLog ("BooleanRestorediskonly variable value: $booleanRestorediskonly (Type: $($booleanRestorediskonly.GetType().Name))")
Write-CustomLog ("Numberofhours2wait variable value: $numberofhours2wait (Type: $($numberofhours2wait.GetType().Name))")

# Use the boolean variable in further logic
if ($booleanRestorediskonly) {
    Write-CustomLog "Restoring disk only."
} else {
    Write-CustomLog "Performing full restore."
}

############################################################
# Variables, note the staging SA we created in earler steps
############################################################
$gdep_rsv_vault_name = "rsv-prod-eus-01"
$gdep_rsv_vault_resource_group = "rg-gdep-peus-backup"

$gdep_staging_storage_account = az storage account show --name storegdeppwusstaging --query 'id' --output tsv
Write-CustomLog ("Staging storage account is {0}" -f $gdep_staging_storage_account)

<#
    gdep_virtual_machine                = Specifies the name of the backed-up VM item to restore.
    gdep_virtual_machine_containername  = Specifies the name of the container within the vault that holds the backed-up VM
    gdep_target_resource_group_name     = Specifies the resource group where the restored VM will be created.
    gdep_target_vm_name                 = Specifies the name to assign to the newly restored VM
    gdep_target_vnet_name               = Specifies the name of the virtual network (VNet) to which the restored VM will be connected
    gdep_target_vnet_resource_group     = Specifies the resource group name of the VNet where the restored VM will be connected
    gdep_target_subnet_name             = Specifies the name of the subnet within the target VNet where the restored VM will be placed

    vaultname = Specifies the name of the Recovery Services vault from which the backup will be restored
    vaulresourcegrouptname = Specifies the resource group name where the vault is located. 
    storageaccountname = Specifies the name of the storage account where the VM disks will be restored. 
    recoverypointname = Specifies the name of the recovery point to restore from.

    gdep_virtual_machine_nic_name = Name of the NIC resource
    gdep_virtual_machine_nic_ip = Final IP desired for this NIC
    gdep_virtual_machine_nic_subnet_resource_group = 
    gdep_virtual_machine_nic_vnet_name = 
    gdep_virtual_machine_nic_snet_name = 
#>

$vm_list = Get-Content -Path $vmlist | ConvertFrom-Json
# Start of script

# Lets add restore Job related properties to keep track of each job 
foreach ($gdepvm in $vm_list) {
    $gdepvm | Add-Member -MemberType NoteProperty -Name "gdep_restore_job_name" -Value ""
    $gdepvm | Add-Member -MemberType NoteProperty -Name "gdep_restore_job_status" -Value "Not Started"
    $gdepvm | Add-Member -MemberType NoteProperty -Name "gdep_nic_operation_completed" -Value $false
}

foreach ($gdepvm in $vm_list) {
    try {
        # Extract parameters from the hashtable
        $gdep_virtual_machine = $gdepvm.gdep_virtual_machine
        $gdep_virtual_machine_container_name = $gdepvm.gdep_virtual_machine_containername
        $gdep_target_resource_group_name = $gdepvm.gdep_target_resource_group_name
        $gdep_target_vm_name = $gdepvm.gdep_target_vm_name
        $gdep_target_vnet_name = $gdepvm.gdep_target_vnet_name
        $gdep_target_vnet_resource_group = $gdepvm.gdep_target_vnet_resource_group
        $gdep_target_subnet_name = $gdepvm.gdep_target_subnet_name
                
        Write-CustomLog ("About to obtain recovery point for VM {0}" -f $gdep_virtual_machine)

        $latest_recovery_point = Get-Latest-Recovery-Point `
            -vmname $gdep_virtual_machine `
            -vmcontainername $gdep_virtual_machine_container_name `
            -vaultname $gdep_rsv_vault_name `
            -vaultresourcegroupname $gdep_rsv_vault_resource_group

        if ($booleanRestorediskonly) {
            Write-CustomLog ("Sould not have come into this loop {0}" -f $gdep_virtual_machine)
            if (-not [string]::IsNullOrEmpty($latest_recovery_point)) {
                $restore_operation = Restore-Disks `
                    -vmname $gdep_virtual_machine `
                    -vmcontainername $gdep_virtual_machine_container_name `
                    -vaultname $gdep_rsv_vault_name `
                    -vaulresourcegrouptname $gdep_rsv_vault_resource_group `
                    -storageaccountname $gdep_staging_storage_account `
                    -recoverypointname $latest_recovery_point `
                    -targetresourcegroupname $gdep_target_resource_group_name `
                    -restoretodisk $true
                # ($restore_operation | ConvertFrom-Json).properties.activityId
                $gdepvm.gdep_restore_job_name = ($restore_operation | ConvertFrom-Json).name
                Write-CustomLog ("Working on Restoring Disk for job name {0}" -f $gdepvm.gdep_restore_job_name)
            }
            else {
                Write-CustomLog ("No disk(s) recovery point found for VM specfified {0}" -f $gdep_virtual_machine)
            }
        }
        else {
            if (-not [string]::IsNullOrEmpty($latest_recovery_point)) {
                Write-CustomLog ("This is the correct condition for VM {0}" -f $gdep_virtual_machine)
                $restore_operation = Restore-Disks `
                    -vmname $gdep_virtual_machine `
                    -vmcontainername $gdep_virtual_machine_container_name `
                    -vaultname $gdep_rsv_vault_name `
                    -vaulresourcegrouptname $gdep_rsv_vault_resource_group `
                    -storageaccountname $gdep_staging_storage_account `
                    -recoverypointname $latest_recovery_point `
                    -targetresourcegroupname $gdep_target_resource_group_name `
                    -targetvmname $gdep_target_vm_name `
                    -targetvnetname $gdep_target_vnet_name `
                    -targetvnetresourcegroup $gdep_target_vnet_resource_group `
                    -targetsubnetname $gdep_target_subnet_name `
                    -restoretodisk $false
                $gdepvm.gdep_restore_job_name = ($restore_operation | ConvertFrom-Json).name
                Write-CustomLog ("Working on Restoring Virtual Machine for job name {0}" -f $gdepvm.gdep_restore_job_name)
            }
            else {
                Write-CustomLog ("No virtual machine recovery point found for VM {0}" -f $gdep_virtual_machine)
            }
        }
    }
    catch {
        Write-Error "An error occurred: $_"
    }
}
```

---

## Step-by-Step Explanation

### 1. Parameters and Setup
- `restorediskonly`: If `true`, only disks are restored; if `false`, a full VM is created.
- `numberofhours2wait`: How long to wait for restore jobs (not used directly in this script, but can be used for polling/wait logic).
- `vmlist`: Path to the JSON file listing VMs to restore (see example below).

### 2. Helper Functions
- **Get-Latest-Recovery-Point**: Finds the most recent backup recovery point for a VM in the secondary region.
- **Restore-Disks**: Runs the Azure CLI command to restore either disks or a full VM, depending on parameters.
- **Invoke-AzureCLICommand**: Utility to run arbitrary Azure CLI commands and log them.
- **Write-CustomLog**: Standardized logging for both local and CI environments.

### 3. Main Logic
- Loads the VM list from the provided JSON file.
- For each VM, finds the latest recovery point and triggers a restore (either disk or full VM).
- Tracks job names and statuses for each VM.

### 4. VM List JSON Example
The script expects a JSON file like this:

```json
[
  {
    "gdep_virtual_machine": "MDCAVDPRDAE02",
    "gdep_virtual_machine_containername": "MDCAVDPRDAE02",
    "gdep_target_resource_group_name": "dr-rg-gdep-pwus-infrastructure",
    "gdep_target_vm_name": "DRMDCAVDPRDAE02",
    "gdep_target_vnet_name": "vnet-gdep-pwus-management",
    "gdep_target_vnet_resource_group": "dr-rg-gdep-pwus-vnets",
    "gdep_target_subnet_name": "snet-gdep-pwus-management-restore"
    // ...other NIC properties...
  }
]
```

---

## Summary
- This script automates the restore of VMs from Azure RSV backups to a new region.
- It ensures you always restore from the latest available backup.
- For full DR, combine with the NIC re-creation process in [Part 2](./azure-restore-from-backup-part2.md).

---

**Continue to [Part 2: NIC Re-Creation and IP Assignment](./azure-restore-from-backup-part2.md)**
