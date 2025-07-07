# Importing Data into Fabric Data Warehouse 

## Introduction

In this article, we will walk through a robust Python-based workflow for importing employee data into Azure Fabric Data Warehouse (DW). This workflow leverages a combination of Azure SDKs, ODBC, and custom utility functions to automate the process of uploading, transforming, and loading data from CSV files into a cloud-based data warehouse. We will explore the key functions involved, their implementation, and how they work together to achieve a seamless data integration pipeline.

## Python Libraries Used

- **pyodbc**: Enables Python to connect to ODBC-compliant databases, such as SQL Server, for executing SQL queries and transactions.
- **os, sys**: Standard Python libraries for interacting with the operating system and system-specific parameters.
- **csv**: Provides tools for reading and writing CSV files.
- **datetime**: Used for manipulating dates and times.
- **io.StringIO**: Allows treating strings as file-like objects, useful for CSV parsing.
- **typing**: Provides type hints for better code clarity and static analysis.
- **azure.storage.filedatalake**: Azure SDK for interacting with Azure Data Lake Storage Gen2, including file and directory operations.

## The Data Import Workflow

The workflow is orchestrated by the `process_fabric_employees_dw` function, which coordinates the following steps:

1. **Upload the latest HR system file to the Azure Data Lake 'unprocessed' folder.**
2. **Retrieve all unprocessed files from the Data Lake.**
3. **Fetch metadata from the HR SQL Data Warehouse.**
4. **For each unprocessed file:**
    - Parse the CSV content.
    - Determine the date identifier for the data.
    - Transform the data for database insertion.
    - Insert the transformed data into the database.
    - Move the processed file to the 'processed' folder in Data Lake.

Let's examine the key functions involved in this workflow.

---

## 1. `process_fabric_employees_dw`

This is the main orchestration function. It manages the end-to-end process of uploading, processing, and loading employee data files.

```python
def process_fabric_employees_dw(adp_file):
    try:
        upload_file_to_datalake(adp_file)
        files = get_employee_unprocessed_files()
        if files:
            metadata = get_metadata_lists_from_hr_sql_wh()
            department, costcenter, jobfunction, location, payrate, terminationreason, *_ = metadata
            try:
                for file in files:
                    file_name = file['file_name']
                    file_datetime = file['file_datetime']
                    logger.info(f"Processing file: {file_name} (Datetime: {file_datetime})")
                    headers, rows = parse_csv(file['file_content'])
                    date_auto_id = determine_date_auto_id(file_datetime.date().strftime('%Y-%m-%d'))
                    transformed_data = transform_data(headers, rows, date_auto_id, department, costcenter, jobfunction, location, payrate, terminationreason)
                    insertsuccessfull = insert_into_db(date_auto_id, transformed_data, f"{HR_DBOBJECT_PREFIX}.[FactEmployee]", batch_size=50)
                    if insertsuccessfull:
                        move_file_to_processed_folder(file_name, f'{DATALAKE_UNPROCESSED_FOLDER}', f'{DATALAKE_PROCESSED_FOLDER}')
                        logger.info(f"Finished Successfully Processing file: {file_name} (Datetime: {file_datetime})")
            except Exception as localexception:
                handle_global_exception(sys._getframe().f_code.co_name, localexception)
    except Exception as exception_obj:
        handle_global_exception(sys._getframe().f_code.co_name, exception_obj)
```

This function first uploads the provided HR system file to the Data Lake, then processes all unprocessed files by parsing, transforming, and loading them into the database. Successfully processed files are moved to a 'processed' folder.

---

## 2. `upload_file_to_datalake`

Handles uploading a local file to the Azure Data Lake 'unprocessed' folder.

```python
def upload_file_to_datalake(file_path: str):
    try:
        datalake_folder = DATALAKE_UNPROCESSED_FOLDER
        credential = get_client_sceret_credential()
        service_client = DataLakeServiceClient(account_url=FABRIC_URL, credential=credential)
        file_system_client = service_client.get_file_system_client(file_system=FABRIC_WS_HR_NAME)
        file_name = os.path.basename(file_path)
        destination_path = f"{datalake_folder}/{file_name}"
        with open(ADP_LOCAL_FOLDER + file_path, "rb") as file_data:
            file_client = file_system_client.get_file_client(destination_path)
            file_client.upload_data(file_data, overwrite=True)
        logger.info(f"Uploaded file {file_name} to {destination_path} in Data Lake.")
    except Exception as e:
        logger.error(f"Failed to upload file {file_path} to Data Lake: {e}")
        raise
```

This function uses the Azure Data Lake SDK to authenticate and upload the file. The file is placed in the 'unprocessed' folder, ready for further processing.

---

## 3. `get_employee_unprocessed_files`

Retrieves all files in the 'unprocessed' folder of the Data Lake that match the expected filename format.

```python
def get_employee_unprocessed_files() -> List[Dict[str, str]]:
    try:
        credential = get_client_sceret_credential()
        service_client = DataLakeServiceClient(account_url=FABRIC_URL, credential=credential)
        file_system_client = service_client.get_file_system_client(file_system=FABRIC_WS_HR_NAME)
        paths = file_system_client.get_paths(path=f"{DATALAKE_UNPROCESSED_FOLDER}")
        valid_files = []
        for path in paths:
            if not path.is_directory:
                file_name = path.name.split("/")[-1]
                file_datetime = GDEPUtils.parse_datetime_from_filename(file_name)
                if file_datetime:
                    try:
                        file_client = file_system_client.get_file_client(path.name)
                        file_content = file_client.download_file().readall().decode('utf-8-sig')
                        valid_files.append({
                            "file_name": file_name,
                            "file_datetime": file_datetime,
                            "file_content": file_content,
                        })
                    except Exception as exception_obj:
                        logger.warning(f"Failed to process file {file_name}: {exception_obj}")
        valid_files.sort(key=lambda x: x["file_datetime"])
        GDEPUtils.send_email(recipients=GDEPUtils.EMAIL_TO_SEND_EXCEPTIONS, subject='Number of files', plain_message=f'Found {len(valid_files)} valid files.')
        logger.info(f"Found {len(valid_files)} valid files.")
        return valid_files
    except Exception as exception_obj:
        GDEPUtils.handle_global_exception(sys._getframe().f_code.co_name, exception_obj)
        return []
```

This function lists all files in the 'unprocessed' directory, filters them by filename pattern, downloads their content, and returns a list of valid files for processing.

---

## 4. `get_metadata_lists_from_hr_sql_wh`

Fetches reference metadata from the HR SQL Data Warehouse, such as departments, cost centers, job functions, etc.

```python
def get_metadata_lists_from_hr_sql_wh():
    try:
        metadata_sources = [
            (f"{HR_DBOBJECT_PREFIX}.[DimDepartment]", lambda row: (row[1], {row[0]: row[2]})),
            (f"{HR_DBOBJECT_PREFIX}.[DimCostCenter]", lambda row: (row[1], {row[0]: row[2]})),
            (f"{HR_DBOBJECT_PREFIX}.[DimJobFunction]", lambda row: (row[1], {row[0]: row[2]})),
            (f"{HR_DBOBJECT_PREFIX}.[DimLocation]", lambda row: (row[1], {row[0]: row[3]})),
            (f"{HR_DBOBJECT_PREFIX}.[DimPayRate]", lambda row: (row[1], {row[0]: row[2]})),
            (f"{HR_DBOBJECT_PREFIX}.[DimTerminationReason]", lambda row: (row[1], {row[0]: row[2]})),
            (f"{HR_DBOBJECT_PREFIX}.[DimDate]", lambda row: (row[1].strftime('%m-%d-%Y'), {row[0]: row[1]})),
        ]
        return_list = []
        sql_connection = get_sql_server_connection_hr_wh()
        db_cursor = sql_connection.cursor()
        for query, processor in metadata_sources:
            working_dict = {}
            try:
                db_cursor.execute(f"SELECT * FROM {query}")
                rows = db_cursor.fetchall()
                for row in rows:
                    key, value = processor(row)
                    working_dict[key] = value
            except Exception as exception_obj:
                GDEPUtils.handle_global_exception(sys._getframe().f_code.co_name, exception_obj)
            return_list.append(working_dict)
        return return_list
    except Exception as exception_obj:
        GDEPUtils.handle_global_exception(sys._getframe().f_code.co_name, exception_obj)
```

This function queries several dimension tables in the data warehouse and returns their contents as dictionaries for use in data transformation.

---

## 5. `parse_csv`

Parses the content of a CSV file into headers and rows.

```python
def parse_csv(file_content: str) -> Tuple[List[str], List[List[str]]]:
    try:
        csv_reader = csv.reader(StringIO(file_content))
        file_data = list(csv_reader)
        headers = file_data[0]
        rows = file_data[1:]
        return headers, rows
    except Exception as exception_obj:
        GDEPUtils.handle_global_exception(sys._getframe().f_code.co_name, exception_obj)
```

This function uses Python's built-in `csv` module to parse the file content, returning the header row and the data rows separately.

---

## 6. `determine_date_auto_id`

Determines or creates a unique date identifier for a given transaction date in the data warehouse.

```python
def determine_date_auto_id(date: str) -> int:
    sql_connection = None
    try:
        sql_connection = get_sql_server_connection_hr_wh()
        cursor = sql_connection.cursor()
        cursor.execute(f"SELECT DateAutoID FROM {HR_DBOBJECT_PREFIX}.[DimDate] WHERE TransactionDate = ?", (date,))
        result = cursor.fetchone()
        if result:
            return result[0]
        cursor.execute(f"SELECT MAX(DateAutoID) FROM {HR_DBOBJECT_PREFIX}.[DimDate]")
        max_date_auto_id = cursor.fetchone()[0]
        new_date_auto_id = (max_date_auto_id or 0) + 1
        cursor.execute(f"INSERT INTO {HR_DBOBJECT_PREFIX}.[DimDate] (DateAutoID, TransactionDate) VALUES (?, ?)", (new_date_auto_id, date))
        sql_connection.commit()
        return new_date_auto_id
    except Exception as exception_obj:
        GDEPUtils.handle_global_exception(sys._getframe().f_code.co_name, exception_obj)
        raise
    finally:
        if sql_connection:
            sql_connection.close()
```

This function checks if a date already exists in the `DimDate` table. If not, it inserts a new record and returns the new identifier.

---

## 7. `transform_data`

Transforms raw CSV data into the format required for database insertion, mapping codes to IDs using metadata.

```python
def transform_data(headers: List[str], rows: List[List[str]], date_auto_id: int, department: Dict[str, Dict], costcenter: Dict[int, Dict], jobfunction: Dict[str, Dict], location: Dict[str, Dict], payrate: Dict[str, Dict], terminationreason: Dict[str, Dict]) -> List[List]:
    try:
        def get_code_value(dictionary: Dict, code, default=None) -> int:
            if code is None or (isinstance(code, str) and not code.strip()):
                return int(list(dictionary.get(default, {0: None}).keys())[0])
            return int(list(dictionary.get(code, {0: None}).keys())[0])
        transformed_data = []
        for row in rows:
            row_dict = dict(zip(headers, row))
            cost_center_number = row_dict.get('Home Cost Number Code', 0)
            try:
                cost_center_number = int(cost_center_number)
            except (ValueError, TypeError):
                cost_center_number = 0
            is_management_position = row_dict.get('This is a Management position', 'false').strip()
            try:
                if is_management_position.lower() == 'yes':
                    is_management_position = True
                else:
                    is_management_position = False
            except Exception:
                is_management_position = False
            transformed_data.append([
                date_auto_id,
                get_code_value(department, row_dict.get('Home Department Code', 'UNDF')),
                get_code_value(costcenter, cost_center_number),
                get_code_value(jobfunction, row_dict.get('Job Function Code', 'UNDF')),
                get_code_value(location, row_dict.get('Location Code', 'UNDF')),
                get_code_value(payrate, row_dict.get('Regular Pay Rate Code', 'UNDF')),
                get_code_value(terminationreason, row_dict.get('Termination Reason Code', 'UNDF')),
                str(row_dict.get('File Number', '')).strip(),
                str(row_dict.get('Position ID', '')).strip(),
                str(row_dict.get('Legal First Name', '')).strip(),
                str(row_dict.get('Preferred First Name', '')).strip(),
                '',
                str(row_dict.get('Last Name', '')).strip(),
                convert_to_date(row_dict.get('Hire Date', '')),
                convert_to_date(row_dict.get('Rehire Date', '')),
                str(row_dict.get('Job Title Description', '')).strip(),
                is_management_position,
                str(row_dict.get('Work Contact: Work Email', '')).strip(),
                str(row_dict.get('Personal Contact: Personal Email', '')).strip(),
                str(row_dict.get('Reports To Name', '')).strip(),
                str(row_dict.get('Reports To Position ID', '')).strip(),
                str(row_dict.get('Payroll Company Code', '')).strip(),
                str(row_dict.get('Job Class Description', '')).strip(),
                str(row_dict.get('Position Status', '')).strip(),
                str(row_dict.get('Personal Contact: Personal Mobile', '')).strip(),
                str(row_dict.get('Work Contact: Work Phone', '')).strip(),
                convert_to_date(row_dict.get('Termination Date', '')),
                str(row_dict.get('Worker Category Code', '')).strip(),
                str(row_dict.get('Associate ID', '')).strip(),
                str(row_dict.get('Assigned Shift Description', '')).strip(),
                str(row_dict.get('FLSA Description', '')).strip(),
            ])
        return transformed_data
    except Exception as exception_obj:
        GDEPUtils.handle_global_exception(sys._getframe().f_code.co_name, exception_obj)
```

This function maps each row of the CSV to the required database schema, converting codes to IDs and handling data type conversions.

---

## 8. `insert_into_db`

Inserts the transformed data into the target SQL table in batches for efficiency.

```python
def insert_into_db(date_auto_id: int, data: List[List], table_name: str, batch_size: int = 50):
    try:
        returnvalue = False
        sql_connection = get_sql_server_connection_hr_wh()
        cursor = sql_connection.cursor()
        cursor.execute(f"DELETE FROM {table_name} WHERE DateAutoID = {date_auto_id}")
        sql_connection.commit()
        sql_query = f"INSERT INTO {table_name} ([DateAutoID],[DepartmentAutoID],[CostCenterAutoID],[JobFunctionAutoID],[LocationAutoID],[PayRateAutoID],[TerminationReasonAutoID],[FileNumber],[PositionID],[FirstName],[PreferredFirstName],[MiddleInitial],[LastName],[HireDate],[RehireDate],[JobTitleDescription],[IsManagementPosition],[WorkEmail],[PersonalEmail],[ManagerName],[ManagerPositionID],[PayrollCompanyCode],[JobClassDescription],[PositionStatus],[PersonalMobile],[WorkMobile],[TerminationDate],[WorkerCategoryCode],[AssociateID],[AssignedShiftDescription],[FLSADescription]) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
        cursor.fast_executemany = True
        for i in range(0, len(data), batch_size):
            batch = data[i:i + batch_size]
            cursor.executemany(sql_query, batch)
        sql_connection.commit()
        logger.info(f"Inserted {len(data)} rows into {table_name}.")
        returnvalue = True
        return returnvalue
    except Exception as exception_obj:
        GDEPUtils.handle_global_exception(sys._getframe().f_code.co_name, exception_obj)
    finally:
        sql_connection.close()
        return returnvalue
```

This function first deletes any existing records for the given date, then inserts the new data in batches for performance.

---

## 9. `move_file_to_processed_folder`

Moves a file from the 'unprocessed' folder to the 'processed' folder in Azure Data Lake by renaming it.

```python
def move_file_to_processed_folder(file_name: str, source_folder: str, destination_folder: str):
    try:
        credential = get_client_sceret_credential()
        service_client = DataLakeServiceClient(account_url=FABRIC_URL, credential=credential)
        file_system_client = service_client.get_file_system_client(file_system=FABRIC_WS_HR_NAME)
        source_path = f"{source_folder}/{file_name}"
        destination_path = f"{destination_folder}/{file_name}"
        logger.info(f"Source Path: {source_path}")
        logger.info(f"Destination Path: {destination_path}")
        file_client = file_system_client.get_file_client(source_path)
        file_client.rename_file(f"{file_system_client.file_system_name}/{destination_path}")
        logger.info(f"Moved file {file_name} from {source_folder} to {destination_folder}.")
    except Exception as exception_obj:
        GDEPUtils.handle_global_exception(sys._getframe().f_code.co_name, exception_obj)
```

This function uses the Azure Data Lake SDK to rename (move) the file, ensuring that processed files are archived and not reprocessed.

---

## Supplement: `get_client_sceret_credential`

This function provides the Azure credential used for authentication in all Data Lake and Azure SDK operations. It is a wrapper around Azure's `ClientSecretCredential` and is essential for secure, programmatic access to Azure resources.

```python
def get_client_sceret_credential():
    try:
        return ClientSecretCredential(
            tenant_id=AZURE_TENANT_ID,
            client_id=AZURE_CONFIDENTIAL_APP_ID,
            client_secret=AZURE_CONFIDENTIAL_SECRET
        )
    except Exception as localExceptionObject:
        handle_global_exception(sys._getframe().f_code.co_name, localExceptionObject)
    finally:
        pass
```

This function should be used in place of any direct reference to `GDEPAzure.get_client_sceret_credential` in the workflow. For example, in the `upload_file_to_datalake` and other related functions, replace `GDEPAzure.get_client_sceret_credential()` with `get_client_sceret_credential()` for clarity and modularity.

---

## References

- [Azure Data Lake Storage Gen2 Python SDK](https://learn.microsoft.com/en-us/python/api/overview/azure/storage-file-datalake-readme?view=azure-python)

## Conclusion

By combining Python's data processing capabilities with Azure's scalable storage and compute, this workflow provides a reliable and efficient way to automate the import of employee data into Azure Fabric Data Warehouse. The modular design allows for easy extension and maintenance, while leveraging batch operations and cloud-native features ensures performance and scalability. This approach can be adapted for similar ETL scenarios involving other data sources and targets in the Azure ecosystem.
