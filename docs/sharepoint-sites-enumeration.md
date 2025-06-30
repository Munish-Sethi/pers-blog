# How to Retrieve All SharePoint Sites in Your Microsoft 365 Tenant

## Introduction

Retrieving a complete list of SharePoint sites in your Microsoft 365 (M365) tenant is essential for IT automation, reporting, and governance. This article provides a detailed, company-agnostic, step-by-step guide to programmatically enumerate all SharePoint sites using Python and the Microsoft Graph API. All code samples are generic and ready to use in any tenant.

---

## Prerequisites

### 1. Azure Entra Application Registration
- Register an application in Azure Entra (Azure AD).
- Assign the following Microsoft Graph API permissions:
  - `Sites.Read.All` (Application permission)
  - `Sites.ReadWrite.All` (if you need to write/update)
- Grant admin consent for these permissions.

### 2. Certificate-Based Authentication
- Upload a certificate to your Azure Entra application.
- Use the certificate thumbprint and private key for authentication.
- For a detailed guide and code on certificate-based authentication, see: [Certificate Auth for Microsoft Graph API](azure-ad-certificate.md)

### 3. Python Environment
- Install the required packages:
  ```bash
  pip install requests msal
  ```

---

## Step 1: Authenticate and Get an Access Token

You need to authenticate as your Azure Entra application and obtain an access token for Microsoft Graph. This is best done using certificate-based authentication for security.

Below is a full, reusable function for certificate-based authentication. (Replace the placeholders with your actual values.)

```python
import msal
import json
import os

def get_access_token_API_Access_AAD(resource_list=None):
    # Replace these with your app's values
    TENANT_ID = "<YOUR_TENANT_ID>"
    CLIENT_ID = "<YOUR_CLIENT_ID>"
    AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
    CERT_THUMBPRINT = "<YOUR_CERT_THUMBPRINT>"
    CERT_PRIVATE_KEY_PATH = "<PATH_TO_YOUR_PRIVATE_KEY>.pem"
    if resource_list is None:
        resource_list = ["https://graph.microsoft.com/.default"]
    with open(CERT_PRIVATE_KEY_PATH, "r") as f:
        private_key = f.read()
    app = msal.ConfidentialClientApplication(
        client_id=CLIENT_ID,
        authority=AUTHORITY,
        client_credential={
            "thumbprint": CERT_THUMBPRINT,
            "private_key": private_key
        }
    )
    result = app.acquire_token_for_client(scopes=resource_list)
    if "access_token" in result:
        return result["access_token"]
    else:
        raise Exception(f"Could not obtain access token: {result}")
```

> See [this blog post](azure-ad-certificate.md) for a full explanation and troubleshooting tips for certificate-based authentication.

---

## Step 2: Query the Microsoft Graph API for SharePoint Sites

The Microsoft Graph API endpoint to list all sites is:

```
GET https://graph.microsoft.com/v1.0/sites?search=*
```

This returns a paginated list of root SharePoint sites in your tenant.

### Helper Function: Execute OData Query

```python
import requests

def execute_odata_query_get(url, token):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.json()
```

### Retrieve All Sites (with Pagination)

```python
def get_all_sp_sites():
    url = "https://graph.microsoft.com/v1.0/sites?search=*"
    token = get_access_token_API_Access_AAD(["https://graph.microsoft.com/.default"])
    sites = []
    next_url = url
    while next_url:
        data = execute_odata_query_get(next_url, token)
        sites.extend(data.get("value", []))
        next_url = data.get("@odata.nextLink")
    return sites
```

#### Explanation:
- `get_all_sp_sites` starts with the root search URL.
- It uses the access token for authentication.
- It loops through all pages using the `@odata.nextLink` property for pagination.
- All sites are collected in the `sites` list.

---

## Step 3: Retrieve Subsites for Each Site

To enumerate subsites for a given site, use:

```
GET https://graph.microsoft.com/v1.0/sites/{site-id}/sites
```

### Function to Get Subsites

```python
def get_sp_subsites(site_id):
    url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/sites"
    token = get_access_token_API_Access_AAD(["https://graph.microsoft.com/.default"])
    data = execute_odata_query_get(url, token)
    return data.get("value", [])
```

#### Explanation:
- For each site, call `get_sp_subsites(site_id)` to get its direct subsites.
- You can recursively call this function to build a full site tree.

---

## Step 4: Full Example - Enumerate All Sites and Subsites

Here is a complete script you can copy, edit, and run in your own environment:

```python
import msal
import requests
import json
import os

def get_access_token_API_Access_AAD(resource_list=None):
    TENANT_ID = "<YOUR_TENANT_ID>"
    CLIENT_ID = "<YOUR_CLIENT_ID>"
    AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
    CERT_THUMBPRINT = "<YOUR_CERT_THUMBPRINT>"
    CERT_PRIVATE_KEY_PATH = "<PATH_TO_YOUR_PRIVATE_KEY>.pem"
    if resource_list is None:
        resource_list = ["https://graph.microsoft.com/.default"]
    with open(CERT_PRIVATE_KEY_PATH, "r") as f:
        private_key = f.read()
    app = msal.ConfidentialClientApplication(
        client_id=CLIENT_ID,
        authority=AUTHORITY,
        client_credential={
            "thumbprint": CERT_THUMBPRINT,
            "private_key": private_key
        }
    )
    result = app.acquire_token_for_client(scopes=resource_list)
    if "access_token" in result:
        return result["access_token"]
    else:
        raise Exception(f"Could not obtain access token: {result}")

def execute_odata_query_get(url, token):
    headers = {"Authorization": f"Bearer {token}"}
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    return response.json()

def get_all_sp_sites():
    url = "https://graph.microsoft.com/v1.0/sites?search=*"
    token = get_access_token_API_Access_AAD(["https://graph.microsoft.com/.default"])
    sites = []
    next_url = url
    while next_url:
        data = execute_odata_query_get(next_url, token)
        sites.extend(data.get("value", []))
        next_url = data.get("@odata.nextLink")
    return sites

def get_sp_subsites(site_id):
    url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/sites"
    token = get_access_token_API_Access_AAD(["https://graph.microsoft.com/.default"])
    data = execute_odata_query_get(url, token)
    return data.get("value", [])

def enumerate_all_sites_and_subsites():
    all_sites = get_all_sp_sites()
    all_sites_with_subsites = []
    for site in all_sites:
        site_id = site['id']
        subsites = get_sp_subsites(site_id)
        site['subsites'] = subsites
        all_sites_with_subsites.append(site)
    return all_sites_with_subsites

if __name__ == "__main__":
    all_sites = enumerate_all_sites_and_subsites()
    print(json.dumps(all_sites, indent=2))
```

---

## Step-by-Step Code Walkthrough

1. **get_access_token_API_Access_AAD**: Authenticates using your Azure Entra app and certificate, returning a valid access token for Microsoft Graph.
2. **execute_odata_query_get**: Sends a GET request to the specified Microsoft Graph endpoint using the access token, returning the parsed JSON response.
3. **get_all_sp_sites**: Uses the `/sites?search=*` endpoint to retrieve all root SharePoint sites, handling pagination.
4. **get_sp_subsites**: For each site, retrieves its direct subsites.
5. **enumerate_all_sites_and_subsites**: Combines the above to build a list of all sites and their subsites.
6. **Main block**: Runs the enumeration and prints the result as formatted JSON.

---

## Required Permissions Recap

- `Sites.Read.All` (Application permission, admin consent required)
- The Azure Entra app must be granted consent by a tenant admin
- The app must authenticate using a certificate or secret (certificate recommended)

---

## Troubleshooting and Tips

- If you get a 403 error, check that your app registration has admin consent for `Sites.Read.All`.
- If you get a 401 error, check your certificate and app credentials.
- The `search=*` parameter is required to enumerate all sites, not just the root site.
- For large tenants, always handle pagination using `@odata.nextLink`.
- You can extend the code to recursively enumerate subsites to any depth.

---

## References

- [Microsoft Graph API - List sites](https://learn.microsoft.com/en-us/graph/api/site-list?view=graph-rest-1.0&tabs=http)
- [Microsoft Graph API - List subsites](https://learn.microsoft.com/en-us/graph/api/site-list-subsites?view=graph-rest-1.0&tabs=http)
- [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)
- [Register an application with the Microsoft identity platform](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- [Certificate credentials for application authentication](https://learn.microsoft.com/en-us/azure/active-directory/develop/active-directory-certificate-credentials)
- [MSAL for Python documentation](https://msal-python.readthedocs.io/en/latest/)
- [Microsoft Graph Explorer](https://developer.microsoft.com/en-us/graph/graph-explorer)

---

## Summary

- Register an Azure Entra application and grant it `Sites.Read.All` permission
- Authenticate using a certificate (see [this blog post](azure-ad-certificate.md))
- Use the Microsoft Graph API `/sites?search=*` endpoint to enumerate all SharePoint sites
- Use `/sites/{site-id}/sites` to enumerate subsites
- Handle pagination using `@odata.nextLink`

This approach is secure, scalable, and works in any Microsoft 365 tenant. You can now automate SharePoint site inventory, reporting, or governance tasks in your own environment.
