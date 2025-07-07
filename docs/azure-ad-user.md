# Retrieving Entra (Azure AD) Users, Group Membership, and License Assignments 

## Introduction

This guide demonstrates how to programmatically retrieve a list of all users from Microsoft Entra (Azure AD), including their group memberships and license assignments, using Python and the Microsoft Graph API. The approach is modular, production-ready, and company-agnostic. All code is explained step by step, with constants and endpoints included for clarity.

---

## Prerequisites

- Python 3.8+
- The following Python packages:
  - `requests`
  - `msal` (for authentication, not shown here)
- An Azure AD application (service principal) with permissions to read users, groups, and licenses
- Secure storage for credentials (e.g., Azure Key Vault)

---

## Constants and Endpoints

```python
AZURE_GRAPH_BETA = 'https://graph.microsoft.com/beta/'
LIST_OF_AAD_USER_ATTRIBUTES = [
    'displayName', 'accountEnabled', 'userPrincipalName', 'licenseAssignmentStates',
]
```

---

## Step 1: Retrieve Users with License Assignments and Group Memberships

### Function: `get_users_licenseassignments_and_groups`

This function retrieves a list of users from Entra (Azure AD), including their license assignment states and group memberships, using the Microsoft Graph API.

```python
def get_users_licenseassignments_and_groups():
    user_list = []  # Initialize list to store user data
    try:
        LIST_OF_AAD_USER_ATTRIBUTES = [
            'displayName', 'accountEnabled', 'userPrincipalName', 'licenseAssignmentStates',
        ]
        selected_attributes = ",".join(LIST_OF_AAD_USER_ATTRIBUTES)
        query_params = f"$select={selected_attributes}"
        query_params += "&$expand=memberOf"
        user_list = execute_odata_query_get(f"{AZURE_GRAPH_BETA}users?{query_params}")
    except Exception as error:
        handle_global_exception(sys._getframe().f_code.co_name, error)
    return user_list
```

**Explanation:**
- Builds a query to select user attributes and expand group memberships (`memberOf`).
- Calls `execute_odata_query_get` to make the API request and handle pagination.
- Returns a list of user dictionaries with license and group data.

---

## Step 2: Retrieve All Groups

### Function: `get_list_of_groups`

This function retrieves all groups from Entra (Azure AD).

```python
def get_list_of_groups():
    group_list = []  # Initialize list to store group data
    try:
        group_list = execute_odata_query_get(f"{AZURE_GRAPH_BETA}groups?")
    except Exception as error:
        handle_global_exception(sys._getframe().f_code.co_name, error)
    return group_list
```

**Explanation:**
- Calls the Microsoft Graph `/groups` endpoint to retrieve all groups.
- Uses `execute_odata_query_get` for API calls and pagination.
- Returns a list of group dictionaries.

---

## Step 3: Combine User, License, and Group Data

### Function: `get_users_with_license_and_groups`

This function combines user, license, and group data into a unified list.

```python
def get_users_with_license_and_groups():
    final_list = []  # Final list of dictionaries
    SKU_MAPPING = {
        "ee02fd1b-340e-4a4b-b355-4a514e4c8943": "Exchange Online Archiving",
        "05e9a617-0261-4cee-bb44-138d3ef5d965": "365 E3",
        # ... (other SKU mappings) ...
    }
    try:
        users = get_users_licenseassignments_and_groups()
        groups = get_list_of_groups()
        for user in users:
            # Extract license assignments and group memberships
            license_assignments = []
            group_memberships = []
            # Parse license assignments
            for license in user.get('licenseAssignmentStates', []):
                sku_id = license.get('skuId')
                sku_name = SKU_MAPPING.get(sku_id, sku_id)
                license_assignments.append({
                    'sku_id': sku_id,
                    'sku_name': sku_name,
                    'assigned_by_group': license.get('assignedByGroup', None),
                })
            # Parse group memberships
            for group in user.get('memberOf', []):
                group_memberships.append({
                    'group_id': group.get('id'),
                    'display_name': group.get('displayName'),
                })
            final_list.append({
                'user_principal_name': user.get('userPrincipalName'),
                'display_name': user.get('displayName'),
                'account_enabled': user.get('accountEnabled'),
                'license_assignments': license_assignments,
                'group_memberships': group_memberships,
            })
    except Exception as error:
        handle_global_exception(sys._getframe().f_code.co_name, error)
    return final_list
```

**Explanation:**
- Calls the previous two functions to get users and groups.
- Maps license SKUs to human-readable names.
- Extracts and structures license and group membership data for each user.
- Returns a list of user dictionaries with all relevant information.

---

## Step 4: High-Level Orchestration

### Function: `get_list_of_users_with_license_and_groups`

This function orchestrates the retrieval and structuring of user, license, and group data.

```python
def get_list_of_users_with_license_and_groups():
    user_groups = []
    user_license = []
    user_lic_and_groups = get_users_with_license_and_groups()
    for user in user_lic_and_groups:
        for membership in user['group_memberships']:
            user_groups.append({
                'user_principal_name': user['user_principal_name'],
                'group_id': membership['group_id'],
                'group_display_name': membership['display_name'],
            })
        for licassignment in user['license_assignments']:
            user_license.append({
                'user_principal_name': user['user_principal_name'],
                'sku_id': licassignment['sku_id'],
                'sku_name': licassignment['sku_name'],
                'assigned_by_group': licassignment['assigned_by_group'],
            })
    return user_groups, user_license
```

**Explanation:**
- Calls `get_users_with_license_and_groups` to get the unified user data.
- Flattens group memberships and license assignments into separate lists for easy processing or storage.
- Returns two lists: one for user-group relationships, one for user-license assignments.

---

## Supporting Function: `execute_odata_query_get`

This function is used throughout to make authenticated, paginated requests to the Microsoft Graph API.

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

By following this step-by-step approach, you can programmatically retrieve all users from Entra (Azure AD), along with their group memberships and license assignments, using Python and the Microsoft Graph API. The modular design allows for easy extension and integration into enterprise automation workflows.

For more details, see the [Microsoft Graph API documentation](https://learn.microsoft.com/en-us/graph/api/resources/users?view=graph-rest-beta).
