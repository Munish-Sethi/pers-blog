# Querying Azure Recovery Services Vault (RSV)

## Introduction

Azure Recovery Services Vault (RSV) is a core component for managing and monitoring backups of virtual machines and other resources in Azure. Automating the retrieval and analysis of backup data can help with compliance, reporting, and operational efficiency. This article demonstrates how to:

- Connect to Azure using the Python SDK and a service principal
- Query a Recovery Services Vault for backup details
- Process and store backup information for further analysis

All code is provided in Python, and the approach is company-agnostic and suitable for any enterprise environment.

---

## Prerequisites

- Azure subscription with Recovery Services Vault(s) and VM backups
- Service principal with appropriate permissions (Backup Reader, etc.)
- Python 3.8+ and the following packages (install with `pip install ...`):
  - `azure-identity` (for authentication)
  - `azure-mgmt-recoveryservicesbackup` (for querying backup data)
  - `azure-mgmt-resource` (for resource management, optional)
  - `requests` (for any direct REST API calls, optional)
  - `python-dateutil` (for date parsing, optional)
  - `csv` (standard library, for CSV export)
- Secure storage for credentials (e.g., Azure Key Vault)

---

## Step 1: Authenticate to Azure with a Service Principal

Use the Azure Identity library to authenticate securely:


```python
from azure.identity import ClientSecretCredential

def get_client_secret_credential(tenant_id, client_id, client_secret):
    """Obtain a ClientSecretCredential for Azure authentication."""
    return ClientSecretCredential(
        tenant_id=tenant_id,
        client_id=client_id,
        client_secret=client_secret
    )

**Explanation:**
- Use a service principal for secure, automated access.
- Store secrets securely (e.g., Azure Key Vault).

---

## Step 2: Connect to the Recovery Services Backup Client


```python
from azure.mgmt.recoveryservicesbackup import RecoveryServicesBackupClient

def get_backup_client(credential, subscription_id):
    """Create a RecoveryServicesBackupClient for backup operations."""
    return RecoveryServicesBackupClient(credential, subscription_id)
# Example usage:
# backup_client = get_backup_client(credential, '<your-subscription-id>')
```

**Explanation:**
- The `RecoveryServicesBackupClient` allows you to query backup items, jobs, and policies.

---

## Step 3: Query Backup Items in a Recovery Services Vault


```python
def list_vm_backups(backup_client, resource_group, vault_name):
    """List all backup items (e.g., Azure VMs) in the specified vault."""
    items = backup_client.backup_protected_items.list(
        vault_name=vault_name,
        resource_group_name=resource_group,
        filter="backupManagementType eq 'AzureIaasVM'"
    )
    backup_info = []
    for item in items:
        backup_info.append({
            'vm_name': item.properties.friendly_name,
            'protection_status': item.properties.protection_status,
            'last_backup_time': item.properties.last_backup_time,
            'health_status': item.properties.health_status,
            'resource_id': item.id
        })
    return backup_info
```

**Explanation:**
- Lists all VM backup items in the specified Recovery Services Vault.
- Extracts key properties for reporting or further processing.

---

## Step 4: Store or Report on Backup Data

You can save the backup information to a CSV file or database for further analysis:



```python
def save_backup_info_to_csv(backup_info, filename):
    """Save backup information to a CSV file."""
    with open(filename, 'w', newline='') as csvfile:
        fieldnames = ['vm_name', 'protection_status', 'last_backup_time', 'health_status', 'resource_id']
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        for row in backup_info:
            writer.writerow(row)
```

---

## Full Example: Orchestrating the Process

```python
def main():
    # Retrieve credentials securely
    tenant_id = '<your-tenant-id>'
    client_id = '<your-client-id>'
    client_secret = '<your-client-secret>'
    subscription_id = '<your-subscription-id>'
    resource_group = '<your-resource-group>'
    vault_name = '<your-vault-name>'

    credential = get_client_secret_credential(tenant_id, client_id, client_secret)
    backup_client = get_backup_client(credential, subscription_id)
    backup_info = list_vm_backups(backup_client, resource_group, vault_name)
    save_backup_info_to_csv(backup_info, 'azure_vm_backups.csv')

if __name__ == "__main__":
    main()
```

---


---

## Advanced: Updating Backup Resource Details Programmatically

In some enterprise scenarios, you may want to enrich or update your backup resource inventory with additional details from Azure Recovery Services Vault (RSV). The following function demonstrates how to programmatically update a list of backup resources with the latest backup status and metadata for each VM.

```python
from azure.mgmt.recoveryservicesbackup import RecoveryServicesBackupClient
from azure.mgmt.recoveryservicesbackup.activestamp.models import AzureIaaSComputeVMProtectedItem
import datetime

def update_backup_resources(resource_group, vault_name, backup_resources):
    """
    Update backup resource details by fetching relevant VM backup information from Recovery Services Vault (RSV).
    
    :param resource_group: Name of the Azure resource group
    :param vault_name: Name of the Recovery Services Vault
    :param backup_resources: List of backup resource dictionaries to update
    """
    try:
        # Obtain Azure credentials (replace with your secure credential retrieval)
        credential = get_client_secret_credential(tenant_id, client_id, client_secret)
        backup_client = RecoveryServicesBackupClient(credential, subscription_id)
        
        # Dictionary to store VM backups from the vault
        azure_vm_backups = {}
        
        # Fetch backup-protected items from the Recovery Services Vault
        rsv_backup_items = backup_client.backup_protected_items.list(vault_name, resource_group)
        azure_vm_backups.update({
            item.properties.virtual_machine_id.lower(): item
            for item in rsv_backup_items
            if isinstance(item.properties, AzureIaaSComputeVMProtectedItem)
        })
        
        # Get today's date in YYYY-MM-DD format
        today_date = datetime.datetime.today().strftime("%Y-%m-%d")

        def format_date(value):
            return value.strftime("%Y-%m-%d") if isinstance(value, datetime.datetime) else today_date

        # Iterate through the list of backup resources and update details
        for resource in backup_resources:
            normalized_vm_id = resource['resource_id'].lower()
            vm_backup = azure_vm_backups.get(normalized_vm_id)
            resource.update({
                "friendly_name": getattr(vm_backup.properties, 'friendly_name', '') if vm_backup else '',
                "policy_name": getattr(vm_backup.properties, 'policy_name', '') if vm_backup else '',
                "last_backup_status": getattr(vm_backup.properties, 'last_backup_status', '') if vm_backup else '',
                "last_backup_time": format_date(getattr(vm_backup.properties, 'last_backup_time', None)) if vm_backup else today_date,
                "last_recovery_point": format_date(getattr(vm_backup.properties, 'last_recovery_point', None)) if vm_backup else today_date,
                "protection_state": getattr(vm_backup.properties, 'protection_state', '') if vm_backup else '',
                "protection_status": getattr(vm_backup.properties, 'protection_status', '') if vm_backup else '',
                "container_name": getattr(vm_backup.properties, 'container_name', '') if vm_backup else '',
            })
    except Exception as e:
        print(f"Error updating backup resources: {e}")
```

**Explanation:**
- This function takes a list of backup resources (e.g., VMs) and updates each with the latest backup metadata from Azure RSV.
- It normalizes VM IDs for matching, fetches backup items from the vault, and updates each resource dictionary in-place.
- Error handling is included for robustness; in production, use secure credential management and structured logging.




---

## Conclusion

By following this guide, you can automate the retrieval and reporting of VM backup data from Azure Recovery Services Vaults. This enables better compliance, reporting, and operational insight into your backup posture.
