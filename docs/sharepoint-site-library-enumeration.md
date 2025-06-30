# SharePoint Files and Folders Inventory with Python and Microsoft Graph API

## Introduction

This article provides a detailed, company-agnostic guide to inventorying all files and folders across all SharePoint sites and document libraries in a Microsoft 365 tenant using Python and the Microsoft Graph API. It focuses on the `get_all_files_from_sp` function and its supporting functions, with best practices for handling large environments, including recommendations for running the code in an Azure container.

---

## Microsoft Graph API Endpoint Constant

The code uses the following constant for all Microsoft Graph API v1.0 calls:

```python
AZURE_GRAPH_V1 = 'https://graph.microsoft.com/v1.0/'
```
This ensures all API requests are made to the correct Microsoft Graph endpoint.

---

## Key Functions and Code Walkthrough

### 1. `get_all_files_from_sp`
This is the main orchestration function for SharePoint inventory. It:
- Retrieves all root SharePoint sites using `get_all_sp_sites`.
- Expands the list to include all subsites with `fetch_all_sites_including_subsites`.
- Iterates through every site and its document libraries, calling `process_document_library` for each.
- Sends notification emails on progress and completion.

**Full Function Code:**
```python
def get_all_files_from_sp():
    try:
        gdep_sharepoint_root_sites = get_all_sp_sites()
        gdep_all_sites = fetch_all_sites_including_subsites(gdep_sharepoint_root_sites)

        for site in gdep_all_sites:
            site_id = site["id"]
            site_url = f"{AZURE_GRAPH_V1}sites/{site_id}/drives"

            document_libraries = execute_odata_query_get(site_url)
            for library in document_libraries:
                process_document_library(site_id, library["id"], library["name"], gdep_all_sites)
                send_email(recipients=EMAIL_TO_SEND_EXCEPTIONS,
                    subject=f'Completed Doc Lib -->{library["name"]} - on site {site["webUrl"]}',
                    plain_message=f'Update on SP Library{library["name"]} - for site {site_url}')

        send_email(recipients=EMAIL_TO_SEND_EXCEPTIONS,
            subject=f'Finished all Sites',
            plain_message=f'Finished all Sites')

    except Exception as e:
        handle_global_exception(inspect.currentframe().f_code.co_name, e)
    finally:
        pass
```

#### Explanation
- **Site Discovery:** Uses `get_all_sp_sites()` to get all root sites, then `fetch_all_sites_including_subsites()` to get all subsites.
- **Document Library Enumeration:** For each site, queries all document libraries (drives) and processes them.
- **Progress Notification:** Sends emails after each library and when all sites are complete.
- **Error Handling:** All exceptions are logged and reported.

---

### 2. `get_all_sp_sites`
Fetches all root-level SharePoint sites in the tenant using the Microsoft Graph API:
```python
def get_all_sp_sites():
    url = f"{AZURE_GRAPH_V1}sites?search=*"
    return execute_odata_query_get(url)
```
- **Purpose:** Returns a list of all root SharePoint sites.
- **API Used:** [List SharePoint Sites](https://learn.microsoft.com/en-us/graph/api/site-list?view=graph-rest-1.0&tabs=http)

---

### 3. `fetch_all_sites_including_subsites`
Recursively discovers all subsites for each root site:
```python
def fetch_all_sites_including_subsites(sharepoint_root_sites):
    all_sites = []
    for site in sharepoint_root_sites:
        logger.info(f"Started site {site['webUrl']}")
        all_sites.append({"id": site["id"], "webUrl": site["webUrl"]})
        sharepoint_subsites = get_sp_subsites(site["id"])
        if len(sharepoint_subsites) > 0:
            for subsite in sharepoint_subsites:
                all_sites.append({"id": subsite["id"], "webUrl": subsite["webUrl"]})
    return all_sites
```
- **Purpose:** Ensures every site and subsite is included in the inventory.
- **API Used:** [List Subsites](https://learn.microsoft.com/en-us/graph/api/site-list?view=graph-rest-1.0&tabs=http#list-subsites)

---

### 4. `process_document_library`
Processes each document library (drive) for a site:
```python
def process_document_library(site_id, drive_id, drive_name, all_sites):
    data = []
    logger.info(f"Started Document Library -- {drive_name}")
    start_time = time.perf_counter()
    site_url = f"{AZURE_GRAPH_V1}sites/{site_id}/drives/{drive_id}/root/delta{DOCUMENT_LIB_SELECT_QUERY}"
    search_results = execute_odata_query_get(site_url)
    for item in search_results:
        entry = {
            "site_id": site_id,
            "webUrl": next(site["webUrl"] for site in all_sites if site["id"] == site_id),
            "drive_id": drive_id,
            "document_id": item["id"],
            "name": item["name"],
            "lastModifiedDateTime": parse_iso_date(item.get("lastModifiedDateTime")),
            "size": item.get("size") if "file" in item else ""
        }
        data.append(entry)
    write_data_to_csv(data, SP_WITHOUT_VERSION_CSV_FILE_PATH)
    elapsed_time = time.perf_counter() - start_time
    logger.info(f"Document Library '{drive_name}' took {elapsed_time:.2f} seconds to process.")
```
- **Purpose:**
  - Queries all files in the document library using the Graph API delta endpoint.
  - Collects metadata for each file.
  - Writes results to a CSV for further processing or database import.
  - Logs processing time for performance monitoring.

---

## Supporting Utilities (Full Implementations)

### `execute_odata_query_get(url)`
Handles authenticated GET requests to the Microsoft Graph API, including error handling and token refresh.
```python
def execute_odata_query_get(url):
    try:
        token = get_access_token_API_Access_AAD()
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        return response.json().get("value", [])
    except Exception as e:
        handle_global_exception(sys._getframe().f_code.co_name, e)
        return []
```

### `parse_iso_date(date_str)`
Converts ISO 8601 date strings to Python datetime objects for easier manipulation and formatting.
```python
def parse_iso_date(date_str: str):
    if not date_str:
        return None
    date_str = date_str.rstrip('Z')
    formats = ["%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"]
    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt).date()
        except ValueError:
            continue
    return None
```

### `write_data_to_csv(data, file_path)`
Appends data to a CSV file, writing headers if the file does not exist.
```python
def write_data_to_csv(data, file_path):
    file_exists = os.path.isfile(file_path)
    with open(file_path, mode='a', newline='', encoding='utf-8') as csv_file:
        fieldnames = ["site_id", "webUrl", "drive_id", "document_id", "name", "lastModifiedDateTime", "size"]
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        if not file_exists:
            writer.writeheader()
        writer.writerows(data)
```

### `handle_global_exception(functionName, exceptionObject)`
Logs and emails details of any exception that occurs.
```python
def handle_global_exception(functionName, exceptionObject):
    emailBody = f"Function Name: {functionName}; Exception Description: {exceptionObject}"
    send_email(recipients=EMAIL_TO_SEND_EXCEPTIONS,
               subject='Exception occured in code', 
               plain_message=emailBody)
```

### `get_access_token_API_Access_AAD(scopes=None)`
Obtains an access token for Microsoft Graph API using MSAL or Azure Identity. (Example implementation:)
```python
def get_access_token_API_Access_AAD(scopes=None):
    if scopes is None:
        scopes = ['https://graph.microsoft.com/.default']
    app = ConfidentialClientApplication(
        client_id=AZURE_CONFIDENTIAL_APP_ID,
        authority=f"{AZURE_AUTHORITY_BASE_URL}{AZURE_TENANT_ID}",
        client_credential=AZURE_CONFIDENTIAL_SECRET
    )
    result = app.acquire_token_for_client(scopes=scopes)
    return result["access_token"]
```

---

## Handling Large SharePoint Environments

**Important:** Large tenants with many sites, subsites, and document libraries can have tens or hundreds of thousands of files. Processing all of them can take significant time and resources.

### Best Practices for Large Document Libraries
- **Run in Azure:** For large environments, it is highly recommended to run this inventory code in an Azure Container Instance or Azure VM. This ensures:
  - Sufficient compute and memory resources.
  - Proximity to Microsoft 365 services for faster API calls.
  - Ability to scale or schedule the job as needed.
- **Batch Processing:** The code is designed to process and write data in batches, minimizing memory usage and allowing for partial progress in case of interruptions.
- **Progress Notifications:** The function sends email notifications after each document library and when all sites are complete, so you can monitor long-running jobs.
- **Error Handling:** All exceptions are logged and reported, ensuring that issues with individual sites or libraries do not halt the entire process.

---

## Example: End-to-End Inventory Flow

1. **Discover Sites:**
   - `get_all_sp_sites()` → returns all root sites.
2. **Expand to Subsites:**
   - `fetch_all_sites_including_subsites()` → returns all sites and subsites.
3. **Process Each Library:**
   - For each site, enumerate all document libraries and call `process_document_library()`.
4. **Write Results:**
   - Metadata for each file is written to a CSV file for further analysis or database import.

---

## References
- [Microsoft Graph API: List SharePoint Sites](https://learn.microsoft.com/en-us/graph/api/site-list?view=graph-rest-1.0&tabs=http)
- [Microsoft Graph API: List Drive Items](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0&tabs=http)
- [Azure Container Instances Documentation](https://learn.microsoft.com/en-us/azure/container-instances/)

---

## Conclusion

The `get_all_files_from_sp` function and its supporting helpers provide a robust, scalable way to inventory all files and folders across a Microsoft 365 tenant's SharePoint environment. For large tenants, running this code in an Azure container or VM is strongly recommended to ensure reliability and performance.
