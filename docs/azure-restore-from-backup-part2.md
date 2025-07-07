# Azure VM Restore from Backup – Part 2: NIC Re-Creation and IP Assignment

This article is Part 2 of the series on automating Azure VM restore from Recovery Services Vault (RSV) backups for BCP/DR. Here, we focus on the process of re-creating and attaching NICs to restored VMs, ensuring each VM receives the correct IP address and network configuration—just as it was in the source region.

If you haven't already, see [Part 1](./azure-restore-from-backup-part1.md) for the main restore process.

---

## Overview
- **Goal:** After restoring VMs from backup, ensure each VM has a NIC with the same IP and subnet as in the original region.
- **Approach:** Use PowerShell and Azure CLI to automate NIC creation, assignment, and validation.
- **Why:** Azure restores VMs with default NICs; for true DR, you must re-create and attach NICs with the desired configuration.

---

## The Script: `attachnics.ps1`

Below is the full script used to automate the NIC re-creation and assignment process:

```powershell
param (
    [string] $vmlist = './scripts/bcpdr/vm/vmlist.json',
    [string] $vaultname = 'rsv-prod-eus-01',
    [string] $vaultresourcegroupname = 'rg-gdep-peus-backup'
)

function Write-CustomLog {
    param (
        [string]$message
    )
    Write-Host "::notice::$message"
}

function Get-Last-Restore-JobID {
    param (
        [string]$vaultname,
        [string]$vaultresourcegroupname,
        [string]$vmname,
        [string]$timeRangeStart
    )

    $vmname = $vmname.ToLower()
    $jobid = ''
    
    $backupJobsJson = az backup job list `
        --resource-group $vaultresourcegroupname `
        --vault-name $vaultname `
        --query "[?properties.endTime >= '$timeRangeStart' `
                && properties.operation == 'CrossRegionRestore'  `
                && properties.jobType == 'AzureIaaSVMJob' `
                && properties.status == 'Completed' `
                ] | sort_by(@, &properties.endTime) | reverse(@)" `
        --output json
    $backupJobsJson = $backupJobsJson | ConvertFrom-Json
    
    foreach ($job in $backupJobsJson) {
        if ($job.properties.entityFriendlyName.ToLower() -like "*$vmName*") {
            $vmNameRestored = $job.properties.entityFriendlyName
            Write-CustomLog "Cross Region Restore for VM has completed : $vmNameRestored"
            $jobid = $job.id
            break
        }
    }
    return $jobid
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

$vm_list = Get-Content -Path $vmlist | ConvertFrom-Json
$deploymentresourceGroupName = "dr-rg-gdep-pwus-deployment"
$templateFilePath = "./networking/nic/nic4drvms.bicep"
$vaultname = 'rsv-prod-eus-01'
$vaultresourcegroupname = 'rg-gdep-peus-backup'
$data2gobacktoo = (Get-Date).AddDays(-2).ToString("yyyy-MM-ddTHH:mm:ssZ")

foreach ($gdepvm in $vm_list) {
    try {
        
        $nicName = $gdepvm.gdep_virtual_machine_nic_name
        $deploymentGroupName = "gdepdr-" + $nicName
        $nicResouceGroup = $gdepvm.gdep_target_resource_group_name
        $nicIpAddress = $gdepvm.gdep_virtual_machine_nic_ip
        $nicSubnetResourceGroup = $gdepvm.gdep_virtual_machine_nic_subnet_resource_group
        $nicVnetName = $gdepvm.gdep_virtual_machine_nic_vnet_name
        $nicSubnetName = $gdepvm.gdep_virtual_machine_nic_snet_name
        $vmName = $gdepvm.gdep_target_vm_name
        $vmresourceGroupName = $gdepvm.gdep_target_resource_group_name

        Write-CustomLog ("Retrieving last completed cross region restore status for VM {0} since {1}" -f $gdepvm.gdep_virtual_machine,$data2gobacktoo)
        $gdep_restore_job_id = Get-Last-Restore-JobID `
            -vaultname $vaultname `
            -vaultresourcegroupname $vaultresourcegroupname `
            -vmname $gdepvm.gdep_virtual_machine `
            -timeRangeStart $data2gobacktoo

        if (-not [string]::IsNullOrEmpty($gdep_restore_job_id)) {
            #This means that VM has been restored 
            Write-CustomLog ("Restore job {0} has finished for VM {1}" -f $gdep_restore_job_id, $gdepvm.gdep_virtual_machine)
            #Check if we have already created and attached the new NIC for this or not
            $nicExists = az network nic show --resource-group $nicResouceGroup --name $nicName --query id --output tsv
            if ($nicExists) {
                Write-CustomLog ("NIC {0} has already been created and attached to VM {1} nothing to do" -f $gdepvm.gdep_virtual_machine_nic_name, $gdepvm.gdep_target_vm_name)
            }
            else {
                Write-CustomLog ("About to create new NIC namely {0}" -f $gdepvm.gdep_virtual_machine_nic_name)
                $command = "az deployment group create --name $deploymentGroupName --resource-group $deploymentresourceGroupName --template-file $templateFilePath --parameters nic_name=$nicName nic_resource_group=$nicResouceGroup nic_ipaddress=$nicIpAddress nic_subnet_resourcegroup=$nicSubnetResourceGroup nic_vnet_name=$nicVnetName nic_subnet_name=$nicSubnetName"
                $executionResult = Invoke-AzureCLICommand -command $command -message "About to Create new NIC for VM : $vmName"
                Write-CustomLog "Provisioning State: $((($executionResult | ConvertFrom-Json).properties.provisioningState))"
                #Setup New NIC Variables we are going to need later
                $nicid2add = (az network nic show -g $nicResouceGroup -n $nicName | ConvertFrom-Json).id
                #Dealocate the VM first as it would be up and running 
                Write-CustomLog ("About to deallocate VM namely {0}" -f $vmName)
                $command = "az vm deallocate --name $vmName --resource-group $vmresourceGroupName --no-wait"
                $executionResult = Invoke-AzureCLICommand -command $command -message "About to deallocate restored VM: $vmName"

                # Verify that VM is deallocated
                $vmStatus = $null
                while ($vmStatus -ne "VM deallocated") {
                    $vmStatus = az vm get-instance-view --name $gdepvm.gdep_target_vm_name --resource-group $gdepvm.gdep_target_resource_group_name
                    $vmObject = $vmStatus | ConvertFrom-Json
                    $nicid2remove = $vmObject.networkProfile.networkInterfaces[0].id
                    $nicname2remove = az network nic show --ids $nicid2remove --query "name" -o tsv

                    $vmInstanceView = ($vmStatus | ConvertFrom-Json).instanceView  
                    $powerState = ($vmInstanceView.statuses | Where-Object { $_.code -eq "PowerState/deallocated" }).displayStatus
                    if ($powerState -eq "VM deallocated") {
                        Write-CustomLog ("VM namely {0} is deallocated " -f $vmName)
                        $vmStatus = "VM deallocated"
                    }
                    else {
                        Write-CustomLog ("VM namely {0} is still not deallocated sleeping for 15 seconds" -f $vmName)
                        Start-Sleep -Seconds 15
                    }      
                }

                # First we need to associate the new NIC to this VM and Make it primary
                $command = "az vm nic add -g $vmresourceGroupName --vm-name $vmName --nics $nicid2add --primary-nic $nicid2add"
                $executionResult = Invoke-AzureCLICommand -command $command -message "Adding NIC $nicid2add to $vmName"
                # Now lets remove and delete NIC
                $command = "az vm nic remove -g $vmresourceGroupName --vm-name $vmName --nics $nicid2remove"
                $executionResult = Invoke-AzureCLICommand -command $command -message "Removing NIC $nicid2remove from $vmName"
                $command = "az network nic delete -g $nicResouceGroup -n $nicname2remove"
                $executionResult = Invoke-AzureCLICommand -command $command -message "Deleting NIC $nicname2remove"

                # Check if the NIC name is 'nic-dr-azgdepprt01' so we can add to backend pool of printer lb created earlier
                if ($nicIpAddress -eq "10.27.17.39") {
                    $backendAddressPoolName = "bep-lbi-gdep-pwus-print"
                    $printerilbname = "lbi-gdep-pwus-print-001"
                    Write-CustomLog ("Adding NIC $nicid2add to backend address pool $backendAddressPoolName")
                    $command = "az network nic ip-config address-pool add --address-pool $backendAddressPoolName --ip-config-name ipconfig --nic-name $nicName --resource-group $nicResouceGroup --lb-name $printerilbname"
                    $executionResult = Invoke-AzureCLICommand -command $command -message "Adding NIC $nicid2add to backend address pool $backendAddressPoolName"
                }
            }
        }
        else {
            Write-CustomLog ("No completed restore job found for VM {0}" -f $gdepvm.gdep_virtual_machine)
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
- `vmlist`: Path to the JSON file listing VMs and their desired NIC/network configuration.
- `vaultname`, `vaultresourcegroupname`: Used for querying restore jobs.

### 2. Helper Functions
- **Write-CustomLog**: Standardized logging for local and CI environments.
- **Get-Last-Restore-JobID**: Finds the most recent completed cross-region restore job for a VM.
- **Invoke-AzureCLICommand**: Utility to run and log Azure CLI commands.

### 3. Main Logic
- Loads the VM list from the provided JSON file.
- For each VM:
  - Checks if a NIC with the desired name already exists and is attached. If so, skips.
  - If not, creates a new NIC with the correct IP, subnet, and VNet.
  - Deallocates the VM, attaches the new NIC as primary, removes and deletes the old NIC.
  - Special handling for printer NICs to add to the correct backend pool.

### 4. VM List JSON Example
The script expects a JSON file like this:

```json
[
  {
    "gdep_virtual_machine": "MDCAVDPRDAE02",
    "gdep_virtual_machine_nic_name": "nic-dr-mdcavdprdae02",
    "gdep_virtual_machine_nic_ip": "10.27.11.5",
    "gdep_virtual_machine_nic_subnet_resource_group": "dr-rg-gdep-pwus-vnets",
    "gdep_virtual_machine_nic_vnet_name": "vnet-gdep-pwus-management",
    "gdep_virtual_machine_nic_snet_name": "snet-gdep-pwus-management"
    // ...other properties...
  }
]
```

---

## Summary
- This script automates the process of re-creating and attaching NICs to restored VMs in a DR region.
- Ensures each VM receives the correct IP address and network configuration for a true like-for-like DR.
- Use in conjunction with [Part 1](./azure-restore-from-backup-part1.md) for a complete BCP/DR restore workflow.

---

**You now have a fully automated, script-driven process for restoring Azure VMs and their network configuration across regions!**
