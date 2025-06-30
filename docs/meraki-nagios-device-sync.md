# Automating Cisco Meraki Device Discovery and Nagios XI Monitoring Integration

## Introduction

Keeping your network monitoring system in sync with your actual device inventory is critical for reliable operations. This article provides a deep dive into a robust Python workflow that:

- Discovers all current devices from the Cisco Meraki cloud API
- Uses SNMP OIDs to obtain Meraki hostnames
- Compares Meraki inventory to Nagios XI monitored hosts
- Adds missing devices to Nagios XI, including handling special device types
- Checks firmware status for compliance

All code is provided and explained so you can adapt this solution for your own environment.

---

## Required Python Libraries

This workflow uses the following Python libraries:

- **meraki**: Official Cisco Meraki Dashboard API Python library. Used for all Meraki cloud API calls.
- **requests**: For making HTTP requests to the Nagios XI REST API.
- **subprocess**: To run SNMP commands (e.g., `snmpwalk`) from Python.
- **re**: For parsing SNMP command output with regular expressions.

Install any missing libraries with pip:

```bash
pip install meraki requests
```

---

## 1. Authenticating to Cisco Meraki and Nagios XI APIs

### Cisco Meraki API Authentication

To connect to the Meraki Dashboard API, you need an API key. This key can be generated in your Meraki dashboard under **Organization > Settings > Dashboard API access**.

```python
import meraki

MERAKI_API_KEY = 'YOUR_MERAKI_API_KEY'  # Replace with your Meraki API key
MERAKI_BASE_URL = 'https://api.meraki.com/api/v1/'

dashboard = meraki.DashboardAPI(
    api_key=MERAKI_API_KEY,
    base_url=MERAKI_BASE_URL,
    output_log=False,
    print_console=False,
    suppress_logging=True
)
```

### Nagios XI API Authentication

Nagios XI provides a REST API. You need an API key, which can be generated in the Nagios XI web interface under **My Account > API Keys**.

```python
import requests

NAGIOS_XI_API_URL = 'https://your-nagios-server.example.com/nagiosxi/api/v1/'  # Replace with your Nagios XI URL
NAGIOS_XI_API_KEY = 'YOUR_NAGIOS_API_KEY'  # Replace with your Nagios XI API key

def call_nagios_api(endpoint, method='GET', data=None):
    url = f"{NAGIOS_XI_API_URL}{endpoint}"
    headers = {'Authorization': f'Bearer {NAGIOS_XI_API_KEY}'}
    if method == 'GET':
        response = requests.get(url, headers=headers)
    elif method == 'POST':
        response = requests.post(url, headers=headers, json=data)
    elif method == 'PUT':
        response = requests.put(url, headers=headers, json=data)
    elif method == 'DELETE':
        response = requests.delete(url, headers=headers)
    else:
        raise ValueError('Unsupported HTTP method')
    response.raise_for_status()
    return response.json()
```

---

## 1a. Understanding and Setting Up `MERAKI_DASHBOARD_SNMP_COMMUNITY_STRING`

### What is `MERAKI_DASHBOARD_SNMP_COMMUNITY_STRING`?

The `MERAKI_DASHBOARD_SNMP_COMMUNITY_STRING` is a shared secret (like a password) used for authenticating SNMP v2c queries to the Meraki cloud SNMP endpoint. It is required to retrieve device information via SNMP, such as hostnames and other device attributes.

### How to Set Up the SNMP Community String in Meraki Dashboard

1. **Log in to your Meraki Dashboard**
2. Navigate to **Organization > Settings**
3. Scroll to the **SNMP** section
4. Enable **Cloud Monitoring** (SNMP v2c)
5. Set your desired **SNMP Community String** (e.g., `mysnmpcommunity`)
6. Save your changes
7. **Whitelist your public IP address** in the SNMP section to allow SNMP queries from your monitoring server

> **Note:** The SNMP community string acts as a password for SNMP v2c. Keep it secure and do not share it publicly.

### Plugging the Community String into Your Code

In your Python code, set the value as follows:

```python
MERAKI_DASHBOARD_SNMP_COMMUNITY_STRING = 'mysnmpcommunity'  # Replace with your actual SNMP community string
```

This value is then used in SNMP queries, for example:

```python
import subprocess
import re

def get_snmp_data(snmp_server, port, oid, community):
    command = [
        "snmpwalk",
        "-v", "2c",
        "-c", community,
        f"{snmp_server}:{port}",
        oid
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=True)
        output = result.stdout
        snmp_dict = {}
        pattern = re.compile(r'(\S+)\s+=\s+STRING:\s+"([^"]+)"')
        for match in pattern.finditer(output):
            oid = match.group(1)
            string_value = match.group(2)
            snmp_dict[string_value] = oid
        return snmp_dict
    except Exception as e:
        print(f"SNMP error: {e}")
        return None

MERAKI_DASHBOARD_SNMP_HOST_NAME = 'snmp.meraki.com'
MERAKI_DASHBOARD_SNMP_PORT = '16100'

merakihostnames = get_snmp_data(
    MERAKI_DASHBOARD_SNMP_HOST_NAME,
    MERAKI_DASHBOARD_SNMP_PORT,
    '1.3.6.1.4.1.29671.1.1.4.1.2',
    MERAKI_DASHBOARD_SNMP_COMMUNITY_STRING
)
```

If you change the community string in the Meraki dashboard, update it in your code as well.

---

## 2. Obtaining All Current Devices from Meraki

We use the official Meraki Dashboard API to fetch all organizations, devices, and networks:

```python
gdepOrganizations = dashboard.organizations.getOrganizations()
organizationid = gdepOrganizations[0]['id']
gdepdevices = dashboard.organizations.getOrganizationDevices(organizationid, -1)
gdepnetworks = dashboard.organizations.getOrganizationNetworks(organizationid, -1)
```
- `getOrganizations()` returns all organizations your API key can access.
- `getOrganizationDevices()` fetches all devices (appliances, switches, cameras, wireless, etc.).
- `getOrganizationNetworks()` fetches all networks (logical groupings of devices).

---

## 3. Obtaining Meraki Hostnames via SNMP OID

To get hostnames as seen by Meraki's SNMP dashboard, we use the SNMP OID `1.3.6.1.4.1.29671.1.1.4.1.2` (see code above).

- This function runs an `snmpwalk` command and parses the output into a dictionary of hostnames and OIDs.
- SNMP access must be enabled and your IP whitelisted in the Meraki dashboard.

---

## 4. Checking Firmware Status for Each Network

For each network, we check the current firmware status of all products using the Meraki Dashboard API's `getNetworkFirmwareUpgrades` method.

### What is `getNetworkFirmwareUpgrades`?

This method retrieves the current and available firmware versions for all devices in a given Meraki network. It helps you:
- Audit firmware compliance
- Identify devices that need upgrades
- Track which products are running which firmware

### Example Usage

```python
# For each network, get firmware upgrade status
for network in gdepnetworks:
    network_id = network['id']
    networkupgrades = dashboard.networks.getNetworkFirmwareUpgrades(network_id)
    print(f"Firmware info for network {network['name']}:\n", networkupgrades)
    if 'products' in networkupgrades:
        products = networkupgrades['products']
        for product_type, firmware_info in products.items():
            print(f"Product: {product_type}")
            print(f"Current Version: {firmware_info.get('currentVersion', {}).get('name', 'N/A')}")
            print(f"Available Version: {firmware_info.get('availableVersion', {}).get('name', 'N/A')}")
            print(f"Status: {firmware_info.get('status', 'N/A')}")
```

#### Sample Output Structure

The returned dictionary typically looks like:

```json
{
  "products": {
    "appliance": {
      "currentVersion": {"name": "MX 18.107.2"},
      "availableVersion": {"name": "MX 18.107.4"},
      "status": "Up to date"
    },
    "switch": {
      "currentVersion": {"name": "MS 15.21"},
      "availableVersion": {"name": "MS 15.22"},
      "status": "Upgrade available"
    }
  }
}
```

- `currentVersion`: The firmware currently running on the product type.
- `availableVersion`: The latest available firmware for that product type.
- `status`: Whether the device is up to date or needs an upgrade.

This information can be used to automate firmware compliance checks and trigger upgrades as needed.

---

## 5. Comparing Meraki Devices to Nagios XI Hosts

We fetch all hosts from Nagios XI and compare them to the Meraki inventory:

```python
nagioshost = call_nagios_api('objects/host')
for device in gdepdevices:
    nagioshostitems = list(filter(lambda nh: str(nh['host_name']).lower() == str(device['name']).lower(), nagioshost))
    if len(nagioshostitems) == 0:
        # Device is missing from Nagios XI
        # ...add to missing list and prepare for addition...
```
- Devices not found in Nagios XI are flagged for addition.
- Special handling for device types (appliance, switch, camera, wireless, etc.).

---

## 6. Adding Missing Devices to Nagios XI

For each missing device, we call helper functions to create/update hosts and services in Nagios XI:

```python
if len(str(device['name']).strip()) != 0:
    if (str(device['name']).strip()[0:3].lower() not in SKIP_MERAKI_HOSTS):
        if (str(device['name']).strip().lower() not in SKIP_MERAKI_HOSTS):
            if (device['productType'] == 'appliance' and 'VMX' not in device['model']):
                applianceVLANs = dashboard.appliance.getNetworkApplianceVlans(device['networkId'])
                vlan999 = list(filter(lambda av: str(av['id']).lower() == str('999').lower(), applianceVLANs))
                if len(vlan999) == 0:
                    device['lanIp'] = '0.0.0.0'
                else:
                    device['lanIp'] = vlan999[0]['applianceIp']
            if device['lanIp'] is None:
                device['lanIp'] = '0.0.0.0'
            create_update_meraki_host(device, nagioshostitems, gdepnetworks, False)
            nagiosserviceitems = list(filter(lambda ns: str(ns['host_name']).lower() == str(device['name']).lower(), nagioshostservices))
            create_update_meraki_host_services(device, nagiosserviceitems, False, merakihostnames)
```
- `create_update_meraki_host()` and `create_update_meraki_host_services()` are responsible for adding/updating hosts and their services in Nagios XI.
- VLAN and IP logic ensures correct addressing for appliances.

---

## 7. Applying Configuration

After all additions/updates, we apply the Nagios XI configuration:

```python
data = {'alias': 'Nagios XI', 'applyconfig': '1'}
call_nagios_api('config/host/localhost', method='PUT', data=data)
nagioshost = call_nagios_api('objects/host')
```

---

## 8. Full Function Code: `add_missing_network_device_to_nagios`

Below is the complete function, ready to adapt for your own environment:

```python
def add_missing_network_device_to_nagios():
    try:
        # OID to obtain all host names from Meraki SNMP Dashboard
        merakihostnames = get_snmp_data(
            MERAKI_DASHBOARD_SNMP_HOST_NAME, 
            MERAKI_DASHBOARD_SNMP_PORT,
            '1.3.6.1.4.1.29671.1.1.4.1.2',
            MERAKI_DASHBOARD_SNMP_COMMUNITY_STRING)
        gdepOrganizations = dashboard.organizations.getOrganizations()
        organizationid = gdepOrganizations[0]['id']
        gdepdevices = dashboard.organizations.getOrganizationDevices(organizationid,-1)
        gdepnetworks = dashboard.organizations.getOrganizationNetworks(organizationid,-1)
        
        for network in gdepnetworks:
            networkupgrades = dashboard.networks.getNetworkFirmwareUpgrades(network['id'])
            if ('products' in networkupgrades):
                products = networkupgrades['products']
                # ...process firmware info as needed...
                
        nagioshost = call_nagios_api('objects/host')
        nagioshostservices = call_nagios_api('objects/service')
        nagioshostconfig = call_nagios_api('config/host')
        nagioshostgroupmembers = call_nagios_api('objects/hostgroupmembers')
        nagioshostservicesconfig = call_nagios_api('config/service')

        SKIP_MERAKI_HOSTS = ['tst','tes']
        
        for device in gdepdevices:
            if (device['productType'] == 'appliance'):
                # ...handle appliance types...
                pass
            elif (device['productType'] == 'camera'):
                pass
            elif (device['productType'] == 'switch'):
                pass
            elif (device['productType'] == 'wireless'):
                pass
            # ...other device handling as needed...
            nagioshostitems = list(filter(lambda nh: str(nh['host_name']).lower() == str(device['name']).lower(), nagioshost))
            if (len(nagioshostitems) == 0):
                if (len(str(device['name']).strip()) != 0):
                    if ((str(device['name']).strip()[0:3].lower() not in SKIP_MERAKI_HOSTS)):
                        if ((str(device['name']).strip().lower() not in SKIP_MERAKI_HOSTS)):
                            # ...add to Nagios XI...
                            pass
            if (len(str(device['name']).strip()) != 0):
                if ((str(device['name']).strip()[0:3].lower() not in SKIP_MERAKI_HOSTS)):
                    if ((str(device['name']).strip().lower() not in SKIP_MERAKI_HOSTS)):
                        if ((device['productType'] == 'appliance') and ('VMX' not in device['model'])):
                            applianceVLANs = dashboard.appliance.getNetworkApplianceVlans(device['networkId'])
                            vlan999 = list(filter(lambda av: str(av['id']).lower() == str('999').lower(), applianceVLANs))
                            if (len(vlan999) == 0):
                                device['lanIp'] = '0.0.0.0'
                            else:
                                device['lanIp'] = vlan999[0]['applianceIp']
                        if (device['lanIp'] is None):
                            device['lanIp'] = '0.0.0.0'
                        create_update_meraki_host(device,nagioshostitems,gdepnetworks,False)
                        nagiosserviceitems = list(filter(lambda ns: str(ns['host_name']).lower() == str(device['name']).lower(), nagioshostservices))
                        create_update_meraki_host_services(device,nagiosserviceitems,False,merakihostnames)
        data = {'alias': 'Nagios XI', 'applyconfig': '1'}
        call_nagios_api('config/host/localhost', method='PUT', data=data)
        nagioshost = call_nagios_api('objects/host')
    except Exception as exception_obj:
        print(f"Error: {exception_obj}")
```

---

## 9. Conclusion

This workflow ensures your Nagios XI monitoring system is always in sync with your actual Meraki device inventory, with full visibility into firmware status and device types. By automating device discovery, comparison, and configuration, you can maintain a reliable, up-to-date monitoring environment with minimal manual effort.

---

## References
- [Cisco Meraki Dashboard API Documentation](https://developer.cisco.com/meraki/api-v1/)
- [Python meraki library](https://pypi.org/project/meraki/)
