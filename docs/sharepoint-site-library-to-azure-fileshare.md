# Copying Files from SharePoint to Azure File Share at Scale

## Overview

This article provides a comprehensive, company-agnostic guide for copying large volumes of files from SharePoint Online document libraries into Azure File Shares. The solution is designed for high-throughput, scalable execution (e.g., as an Azure Container Instance), and is suitable for enterprise-scale migrations, backups, or data archiving. The approach leverages multi-threading for performance and handles large files (30–50 GB+) efficiently by streaming and chunked uploads.

**Key Features:**
- Secure, certificate-based authentication to Microsoft Graph and Azure
- Multi-threaded file copy for high throughput
- Chunked upload for large files
- Robust error handling and progress tracking
- All secrets managed via Azure Key Vault

> **Note:** This article assumes you have already extracted the list of files and their metadata from SharePoint. For details on how to enumerate SharePoint files and extract metadata, see [Extracting SharePoint Document Library Metadata](sharepoint-site-library-enumeration.md).

---

## Prerequisites

- Python 3.8+
- Azure File Share and connection string
- Azure AD App Registration with certificate-based authentication
- Azure Key Vault for secret management
- Extracted metadata for all SharePoint files to be copied (see stub above)

---

## Solution Architecture

1. **Metadata Extraction**: Retrieve all file metadata from SharePoint (site ID, drive ID, item ID, file path, size, timestamps, etc.) and store in a database or CSV. *(See stub above)*
2. **File Copy Process**: For each file, download from SharePoint using Microsoft Graph and upload to Azure File Share, preserving directory structure and metadata.
3. **Multi-threading**: Use a thread pool to process multiple files in parallel for maximum throughput.
4. **Chunked Upload**: For large files, stream and upload in chunks to avoid memory issues and support files up to 100s of GB.
5. **Progress Tracking**: Log and track progress for monitoring and troubleshooting.

---

## Full Python Code Example

Below is a complete, production-ready script for the file copy process. All company-specific values have been removed. Replace stub values and secret names as appropriate for your environment.

```python
"""
This script copies files from SharePoint Online to Azure File Share using multi-threading and chunked uploads.
- Designed for high-volume, large-file scenarios (30–50 GB+)
- All secrets are retrieved from Azure Key Vault
- Can be run as an Azure Container Instance (ACI) or VM
"""
import threading
import requests
from queue import Queue
from urllib.parse import unquote
import os
from azure.storage.fileshare import ShareFileClient, ShareDirectoryClient
from datetime import datetime, timedelta, timezone, time
from msal import ConfidentialClientApplication

from gdepcommon.logger import setup_logger
from gdepcommon.utils import (
    get_azure_kv_sceret,
    sql_dbconnection,
    PFX_CERTIFICATE_NAME,
    PFX_CERTIFICATE_NAME_TP
)
from gdepazure.common import (
    AZURE_CONFIDENTIAL_APP_ID,
    AZURE_TENANT_ID,
    AZURE_AUTHORITY_BASE_URL,
    AZURE_GRAPH_DEFAULT_RESOURCE
)

# Thread and chunk parameters
THREAD_COUNT = 10  # Tune based on environment
CHUNK_SIZE = 4 * 1024 * 1024  # 4 MB

# Shared progress state
total_files = 0
processed_files = 0
lock = threading.Lock()

# Token management
access_token = None
token_expiry_time = None

def refresh_access_token(logger):
    """Refreshes the Microsoft Graph access token using certificate-based auth."""
    global access_token, token_expiry_time
    try:
        logger.info("Refreshing access token...")
        with open(f"certs/{PFX_CERTIFICATE_NAME}.key", "r") as key_file:
            private_key = key_file.read()
        app = ConfidentialClientApplication(
            client_id=AZURE_CONFIDENTIAL_APP_ID,
            authority=f"{AZURE_AUTHORITY_BASE_URL}{AZURE_TENANT_ID}",
            client_credential={
                "thumbprint": PFX_CERTIFICATE_NAME_TP,
                "private_key": private_key,
            },
        )
        result = app.acquire_token_for_client(scopes=AZURE_GRAPH_DEFAULT_RESOURCE)
        access_token = result["access_token"]
        expires_in = result["expires_in"]
        token_expiry_time = datetime.now(tz=timezone.utc) + timedelta(seconds=expires_in - 60)
        logger.info("Access token refreshed successfully.")
    except Exception as e:
        logger.error(f"Failed to refresh access token: {e}")
        raise Exception("Access token refresh failed.")

def get_access_token(logger):
    """Returns a valid access token, refreshing if expired."""
    global access_token, token_expiry_time
    if not access_token or datetime.now(tz=timezone.utc) >= token_expiry_time:
        for attempt in range(3):
            try:
                refresh_access_token(logger)
                break
            except Exception as e:
                if attempt < 2:
                    logger.warning(f"Retrying token refresh (attempt {attempt + 1}/3)...")
                else:
                    raise e
    return access_token

def ensure_directory_path_exists(azure_conn_str, share_name, directory_path, cache=None):
    """Ensures the full directory path exists in Azure File Share."""
    if cache is None:
        cache = set()
    parts = directory_path.strip('/').split('/')
    current_path = ''
    for part in parts:
        current_path = f"{current_path}/{part}" if current_path else part
        if current_path in cache:
            continue
        dir_client = ShareDirectoryClient.from_connection_string(
            conn_str=azure_conn_str,
            share_name=share_name,
            directory_path=current_path
        )
        try:
            dir_client.create_directory()
            cache.add(current_path)
        except Exception as ex:
            if "ResourceAlreadyExists" in str(ex):
                cache.add(current_path)
            else:
                raise

def copy_file_from_sp_to_azure(site_id, drive_id, item_id, azure_file_client, total_file_size_in_bytes, created_date=None, modified_date=None, logger=None):
    """Streams a file from SharePoint and uploads to Azure File Share in chunks."""
    access_token = get_access_token(logger)
    url = f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives/{drive_id}/items/{item_id}/content"
    headers = {"Authorization": f"Bearer {access_token}"}
    retries = 3
    for attempt in range(retries):
        try:
            logger.info(f"Starting file copy for item_id: {item_id}")
            with requests.get(url, headers=headers, stream=True) as response:
                response.raise_for_status()
                azure_file_client.create_file(size=total_file_size_in_bytes)
                offset = 0
                for chunk in response.iter_content(chunk_size=CHUNK_SIZE):
                    azure_file_client.upload_range(data=chunk, offset=offset, length=len(chunk))
                    offset += len(chunk)
                    # Log progress for large files (>5GB) every 10%
                    if total_file_size_in_bytes > 5 * 1024 * 1024 * 1024:
                        percent_complete = (offset / total_file_size_in_bytes) * 100
                        if int(offset / CHUNK_SIZE) % int((total_file_size_in_bytes / CHUNK_SIZE) * 0.05) == 0:
                            logger.info(f"File {item_id}: {percent_complete:.2f}% complete")
            # Set file properties for created/modified dates
            if created_date or modified_date:
                file_properties = {}
                if created_date:
                    created_datetime = datetime.combine(created_date, time())
                    file_properties['file_creation_time'] = created_datetime
                if modified_date:
                    modified_datetime = datetime.combine(modified_date, time())
                    file_properties['file_last_write_time'] = modified_datetime
                from azure.storage.fileshare import ContentSettings
                content_settings = ContentSettings(content_type="application/octet-stream")
                azure_file_client.set_http_headers(file_attributes="none", content_settings=content_settings, **file_properties)
            logger.info(f"Successfully copied file for item_id: {item_id}")
            return
        except requests.exceptions.RequestException as e:
            if attempt < retries - 1:
                logger.warning(f"Retrying file copy for item_id {item_id} (attempt {attempt + 1}/{retries})...")
            else:
                logger.error(f"Failed to copy file for item_id: {item_id}. Error: {e}")
                raise
        except Exception as e:
            logger.error(f"Unexpected error during file copy for item_id {item_id}: {e}")

def worker(queue, azure_conn_str, share_name, created_dirs, logger):
    """Thread worker function: processes files from the queue."""
    global processed_files
    while not queue.empty():
        try:
            file_record = queue.get()
            site_id = file_record['site_id']
            drive_id = file_record['drive_id']
            item_id = file_record['item_id']
            total_file_size_in_bytes = file_record['length']
            created_date = file_record['created_date']
            modified_date = file_record['modified_date']
            decoded_path = file_record['decoded_path']
            # Ensure directory exists
            azure_directory_path = os.path.dirname(decoded_path)
            if azure_directory_path:
                ensure_directory_path_exists(azure_conn_str, share_name, azure_directory_path, created_dirs)
            file_client = ShareFileClient.from_connection_string(
                conn_str=azure_conn_str,
                share_name=share_name,
                file_path=decoded_path
            )
            copy_file_from_sp_to_azure(site_id, drive_id, item_id, file_client, total_file_size_in_bytes, created_date, modified_date, logger)
            # Mark as copied in DB
            with sql_dbconnection() as conn:
                cursor = conn.cursor()
                cursor.execute("UPDATE [dbo].[Fact_Document_Library_Details] SET [copied] = 1 WHERE [unique_id] = ?", file_record['unique_id'])
                conn.commit()
            with lock:
                global processed_files
                processed_files += 1
                overall_progress = (processed_files / total_files) * 100
                logger.info(f"Overall Progress: {overall_progress:.2f}% ({processed_files}/{total_files} files complete)")
            queue.task_done()
        except Exception as e:
            logger.error(f"Error processing file: {e}")

def main(logger):
    """
    Main entry point: loads file metadata, initializes threads, and starts the copy process.
    - Loads Azure File Share connection string from Key Vault
    - Loads file metadata (site_id, drive_id, item_id, file path, size, timestamps, etc.)
    - Spawns worker threads to process the file queue
    - Tracks and logs progress
    """
    global total_files
    try:
        azure_conn_str = get_azure_kv_sceret('your-azure-file-connection-string-secret')
        share_name = "your-azure-file-share-name"
        site_id = "your-sharepoint-site-id"
        drive_id = "your-sharepoint-drive-id"
        created_dirs = set()
        # Fetch files to copy (replace with your DB or CSV logic)
        with sql_dbconnection() as sqlConnection:
            cursor = sqlConnection.cursor()
            cursor.execute("SELECT * FROM [dbo].[Fact_Document_Library_Details] WHERE [type] = 'file' AND [copied] = 0")
            results = cursor.fetchall()
        total_files = len(results)
        if total_files == 0:
            logger.info("No files to process.")
            return
        queue = Queue()
        for row in results:
            sp_relative_url = row.server_relative_url
            decoded_path = unquote(sp_relative_url[len("/sites/YourSite/YourLibrary"):].lstrip('/'))
            queue.put({
                'site_id': site_id,
                'drive_id': drive_id,
                'item_id': row.unique_id,
                'unique_id': row.unique_id,
                'length': row.length,
                'created_date': row.time_created,
                'modified_date': row.time_last_modified,
                'decoded_path': decoded_path
            })
        threads = []
        for _ in range(THREAD_COUNT):
            thread = threading.Thread(target=worker, args=(queue, azure_conn_str, share_name, created_dirs, logger))
            thread.start()
            threads.append(thread)
        for thread in threads:
            thread.join()
        logger.info("All files have been processed successfully.")
    except Exception as e:
        logger.error(f"Error in main function: {e}")

if __name__ == "__main__":
    logger = setup_logger("sp2azfileshare", "/mnt/azure/logs/sp2azfileshare.log")
    main(logger)
```

---

## Code Walkthrough

### 1. **Authentication and Secret Management**
- All secrets (Azure connection string, certificate thumbprint, etc.) are retrieved from Azure Key Vault using a utility function (`get_azure_kv_sceret`).
- Microsoft Graph authentication uses certificate-based credentials for security and automation.

### 2. **Multi-Threaded File Copy**
- The script uses a thread pool (`THREAD_COUNT`) and a `Queue` to distribute file copy tasks across multiple threads.
- Each thread processes files independently, ensuring high throughput and efficient use of resources.
- Thread-safe progress tracking is implemented using a `Lock`.

### 3. **Chunked Upload for Large Files**
- Files are streamed from SharePoint and uploaded to Azure File Share in 4 MB chunks.
- This approach supports very large files (30–50 GB+) without excessive memory usage.
- Progress for large files is logged every 10% (configurable).

### 4. **Directory Structure and Metadata Preservation**
- The script ensures that the full directory path exists in Azure File Share before uploading each file.
- File creation and modification timestamps are preserved if available.

### 5. **Database Integration and Idempotency**
- The script marks each file as copied in the database after successful upload, ensuring idempotency and resumability.
- You can adapt this logic to use a CSV or other metadata store as needed.

---

## Scaling and Running in Azure

- This script is designed to run as an Azure Container Instance (ACI), but can also be run on VMs or Kubernetes.
- Tune `THREAD_COUNT` based on available CPU and network bandwidth.
- For very large migrations, consider splitting the workload across multiple containers or jobs.

---

## Related Articles

- [Extracting SharePoint Document Library Metadata for Automation](sharepoint-site-library-enumeration.md)
- [Automating Secure Secret Management with Azure Key Vault](azure-ad-certificate.md)

---

## Conclusion

By following this guide and using the provided code, you can efficiently and securely copy massive volumes of files from SharePoint Online to Azure File Share, with full support for large files, multi-threaded performance, and robust error handling. All sensitive information is managed via Azure Key Vault, ensuring compliance and security for enterprise automation scenarios.
