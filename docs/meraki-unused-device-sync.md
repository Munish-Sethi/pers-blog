# Identifying Unused Meraki Inventory Devices

## Introduction

In many enterprise environments, it's important to keep track of network hardware inventory and ensure that all devices are properly assigned and utilized. Unused devices can represent wasted resources or missed opportunities for redeployment. This article demonstrates how to use the Meraki Dashboard API and Python to programmatically identify all Meraki appliances in your organization's inventory that are not currently assigned to any network.

## Python Libraries and Imports

The following Python libraries are used in the solution:

- **meraki**: Official Cisco Meraki Dashboard API Python library for interacting with Meraki cloud resources.
- **sys**: Provides access to system-specific parameters and functions.
- **subprocess**: Used for running shell commands from Python (not directly used in the main function, but present for SNMP examples).
- **re**: Regular expressions for parsing SNMP output (not used in the main function).
- **gdepcommon.utils**: Custom utility module for error handling and secret management.

## Prerequisites

- A valid Meraki API key with read access to your organization's inventory.
- The `meraki` Python package installed (`pip install meraki`).
- The API key securely stored and retrieved (in this example, from Azure Key Vault via a utility function).

## The `get_unused_inventory` Function

Below is the complete function to retrieve all unused Meraki inventory devices:

```python
def get_unused_inventory():
    """
    Returns a list of unused inventory devices from the first Meraki organization.
    Unused inventory is defined as devices in inventory that are not assigned to any network.
    """
    dashboard = meraki.DashboardAPI(
        api_key=MERAKI_API_KEY,
        output_log=False,
        print_console=False,
        suppress_logging=True
    )
    organizations = dashboard.organizations.getOrganizations()
    if not organizations:
        return []
    organization_id = organizations[0]['id']
    # Get all inventory devices
    inventory = dashboard.organizations.getOrganizationInventoryDevices(organization_id)
    # Filter for unused devices (not assigned to any network)
    unused_devices = [
        device for device in inventory
        if not device.get('networkId')
    ]
    for device in unused_devices:
        product_type = device.get('productType')
        if product_type == 'camera':
            device['ciproductType'] = 'Camera (' + device['model'] + ')'
        elif product_type == 'switch':
            device['ciproductType']  = 'Switch (' + device['model'] + ')'
        elif product_type == 'appliance':
            device['ciproductType'] = 'Appliance (' + device['model'] + ')'
        elif product_type == 'wireless':
            device['ciproductType'] = 'Wireless (' + device['model'] + ')'
        else:
            device['ciproductType'] = 'Unknown' + device['model']

    return unused_devices
```

### Step-by-Step Explanation

1. **Dashboard API Initialization**
   ```python
   dashboard = meraki.DashboardAPI(
       api_key=MERAKI_API_KEY,
       output_log=False,
       print_console=False,
       suppress_logging=True
   )
   ```
   - Initializes the Meraki Dashboard API client using your API key. Logging and console output are suppressed for cleaner operation.

2. **Get Organizations**
   ```python
   organizations = dashboard.organizations.getOrganizations()
   if not organizations:
       return []
   organization_id = organizations[0]['id']
   ```
   - Retrieves all organizations accessible by the API key. The function uses the first organization found.

3. **Get Inventory Devices**
   ```python
   inventory = dashboard.organizations.getOrganizationInventoryDevices(organization_id)
   ```
   - Fetches all devices in the organization's inventory.

4. **Filter for Unused Devices**
   ```python
   unused_devices = [
       device for device in inventory
       if not device.get('networkId')
   ]
   ```
   - Filters the inventory for devices that do not have a `networkId` property, meaning they are not assigned to any network.

5. **Label Device Types**
   ```python
   for device in unused_devices:
       product_type = device.get('productType')
       if product_type == 'camera':
           device['ciproductType'] = 'Camera (' + device['model'] + ')'
       elif product_type == 'switch':
           device['ciproductType']  = 'Switch (' + device['model'] + ')'
       elif product_type == 'appliance':
           device['ciproductType'] = 'Appliance (' + device['model'] + ')'
       elif product_type == 'wireless':
           device['ciproductType'] = 'Wireless (' + device['model'] + ')'
       else:
           device['ciproductType'] = 'Unknown' + device['model']
   ```
   - Adds a human-readable label to each unused device based on its type and model.

6. **Return the List**
   ```python
   return unused_devices
   ```
   - Returns the list of unused devices, each with additional labeling for easier reporting or further processing.

## References

- [Cisco Meraki Dashboard API Documentation](https://developer.cisco.com/meraki/api-v1/)
- [Meraki Python Library on PyPI](https://pypi.org/project/meraki/)
- [Official Meraki Python SDK GitHub](https://github.com/meraki/dashboard-api-python/)

## Conclusion

By using the Meraki Dashboard API and Python, you can quickly identify unused inventory devices in your organization. This enables better asset management, cost savings, and improved operational efficiency. The approach can be extended to automate device assignment, generate reports, or integrate with other IT asset management systems.
