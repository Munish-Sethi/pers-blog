# Retrieving Entra (Azure AD) User Device 

## Introduction

This guide demonstrates how to programmatically retrieve a list of all devices registered in Microsoft Entra (Azure AD), including key device attributes and registered user information, using Python and the Microsoft Graph API. The approach is modular, production-ready, and company-agnostic. All code is explained step by step, with constants and endpoints included for clarity.

---

## Prerequisites

- Python 3.8+
- The following Python packages:
  - `requests`
  - `msal` (for authentication, not shown here)
- An Azure AD application (service principal) with permissions to read device information
- Secure storage for credentials (e.g., Azure Key Vault)

---

## Constants and Endpoints

```python
AZURE_GRAPH_BETA = 'https://graph.microsoft.com/beta/'
LIST_OF_AAD_DEVICE_ATTRIBUTES = [
    'approximateLastSignInDateTime', 'deviceId', 'displayName', 'id',
    'isCompliant', 'isManaged', 'manufacturer', 'model', 'operatingSystem',
    'operatingSystemVersion', 'deviceOwnership', 'managementType'
]
```

---

## Step 1: Retrieve Device Inventory from Entra (Azure AD)

### Function: `get_list_of_devices`

This function retrieves a list of devices from Entra (Azure AD), including key device attributes and registered user information, using the Microsoft Graph API.

```python
def get_list_of_devices():
    devices_list = []  # Initialize list to store device data
    try:
        LIST_OF_AAD_DEVICE_ATTRIBUTES = [
            'approximateLastSignInDateTime', 'deviceId', 'displayName', 'id',
            'isCompliant', 'isManaged', 'manufacturer', 'model', 'operatingSystem',
            'operatingSystemVersion', 'deviceOwnership', 'managementType'
        ]
        selected_attributes = ",".join(LIST_OF_AAD_DEVICE_ATTRIBUTES)
        query_params = f"$select={selected_attributes}&$expand=registeredUsers"
        devices_list = execute_odata_query_get(f"{AZURE_GRAPH_BETA}devices?{query_params}")
        user_device = []
        for device in devices_list:
            registered_user = device.get('registeredUsers', [])
            user_id = registered_user[0].get('id') if registered_user else None
            user_ip = None  # Not assigned from the device dictionary, keeping as None
            user_upn = registered_user[0].get('userPrincipalName') if registered_user else None
            device_to_add = {
                'approximateLastSignInDateTime': parse_iso_date(device.get('approximateLastSignInDateTime')),
                'deviceId': device.get('deviceId'),
                'displayName': device.get('displayName'),
                'id': device.get('id'),
                'isCompliant': device.get('isCompliant'),
                'isManaged': device.get('isManaged'),
                'manufacturer': device.get('manufacturer'),
                'model': device.get('model'),
                'operatingSystem': device.get('operatingSystem'),
                'operatingSystemVersion': device.get('operatingSystemVersion'),
                'deviceOwnership': device.get('deviceOwnership'),
                'user_id': user_id,
                'user_ip': user_ip,
                'user_upn': user_upn,
                'managementType': device.get('managementType'),
            }
            user_device.append(device_to_add)
    except Exception as error:
        handle_global_exception(sys._getframe().f_code.co_name, error)
    return user_device
```

**Explanation:**
- Builds a query to select device attributes and expand registered user information (`registeredUsers`).
- Calls `execute_odata_query_get` to make the API request and handle pagination.
- For each device, extracts key attributes and the first registered user's ID and UPN (if available).
- Returns a list of device dictionaries, each including device and user information.

---

## Supporting Function: `execute_odata_query_get`

This function is used to make authenticated, paginated requests to the Microsoft Graph API.

```python
def execute_odata_query_get(urltoInvoke, token=''):
    try:
        localUserList = []
        if not token:
            acesstokenforClientapp = get_access_token_API_Access_AAD()
        else:
            acesstokenforClientapp = token
        continueLooping = True
        while continueLooping:
            response = requests.get(
                url=urltoInvoke,
                headers={'Authorization': f'Bearer {acesstokenforClientapp}'}
            )
            if response.status_code == 429:  # Throttling response
                retry_after = int(response.headers.get("Retry-After", 5))
                print(f"Throttled! Retrying after {retry_after} seconds...")
                time.sleep(retry_after)
                continue
            if response.status_code == 401:  # Token expired or invalid
                print("Token expired or invalid. Fetching a new one...")
                acesstokenforClientapp = get_access_token_API_Access_AAD()
                response = requests.get(
                    url=urltoInvoke,
                    headers={'Authorization': f'Bearer {acesstokenforClientapp}'}
                )
                if response.status_code != 200:
                    response.raise_for_status()
            if response.status_code == 403:
                raise Exception(f"403 Forbidden: Access denied for URL {urltoInvoke}")
            if response.status_code != 200:
                response.raise_for_status()
            graph_data = response.json()
            localUserList.extend(graph_data.get('value', []))
            if "@odata.nextLink" in graph_data:
                urltoInvoke = graph_data["@odata.nextLink"]
            else:
                continueLooping = False
        return localUserList
    except Exception as e:
        if hasattr(e, 'args') and e.args and '403 Forbidden' in str(e.args[0]):
            raise
        handle_global_exception(sys._getframe().f_code.co_name, e)
```

**Explanation:**
- Handles authentication, pagination, throttling, and error handling for Microsoft Graph API requests.
- Used by all higher-level functions to retrieve data from Entra (Azure AD).  For a deep dive into certificate-based authentication setup, see the dedicated article: [Certificate Based Authorization for Azure AD](azure-ad-certificate.md).

---

## Conclusion

By following this approach, you can programmatically retrieve a complete inventory of devices from Entra (Azure AD), including device details and registered user information, using Python and the Microsoft Graph API. This enables automated device inventory, compliance, and reporting workflows in your organization.

For more details, see the [Microsoft Graph API documentation](https://learn.microsoft.com/en-us/graph/api/resources/device?view=graph-rest-beta).
