# Automating UKG Dimensions Integrations and DataView Exports with Python

## Introduction

UKG Dimensions (formerly Kronos) provides powerful APIs for automating data extraction and integration tasks. This article demonstrates how to:

- Programmatically execute a predefined integration (such as a payroll export) in UKG Dimensions and retrieve the output file.
- Programmatically extract data from an existing DataView using a Hyperfind query.

All code is provided in Python, and the approach is suitable for any enterprise environment. This guide is company-agnostic and can be adapted to your own UKG tenant.

---

## Prerequisites

- Access to UKG Dimensions APIs (with appropriate permissions)
- A predefined integration (e.g., Payroll Export) already set up in your UKG tenant
- An existing DataView in UKG Dimensions
- Python 3.8+ and the `requests` library
- Secure storage for API credentials (e.g., Azure Key Vault)

---

## 1. Executing a Predefined Integration in UKG Dimensions

UKG Dimensions allows you to define integrations (such as payroll exports) via the UI. These integrations can be triggered and monitored via API, and the resulting files can be downloaded programmatically.

### Python Function: `fetch_and_store_payroll_hours`

```python
def fetch_and_store_payroll_hours(environment, week_start, week_end, week_start_datetime, week_end_datetime):
    import uuid, json, time, csv
    from io import StringIO
    # ... import your secret and DB utilities ...
    unique_id = 'Automation-' + str(uuid.uuid4())
    access_token, base_uri, api_key = get_token_apikey_and_uri(environment)
    headers = {
        'Content-Type': 'application/json',
        'appkey': api_key,
        'Authorization': access_token
    }
    # 1. Trigger the integration
    dimensions_api_uri = base_uri + 'api/v1/platform/integrations/4/execute'
    payload = json.dumps({
        "integrationParameters": [
            {"name": "Symbolic Period", "value": {'symbolicPeriod': {'id': '0'}, 'startDate': week_start + '.000Z', 'endDate': week_end + '.000Z'}},
            {"name": "Summary File Name", "value": "AutomationPayrollSummaryExport.csv"},
            {"name": "Hyperfind ID", "value": {'hyperfind': {'id': '1304'}}},
            {"name": "Ignore Sign Off", "value": False},
            {"name": "File Name", "value": "automationpayrollexport.csv"}
        ],
        "name": unique_id
    })
    response = requests.post(dimensions_api_uri, headers=headers, data=payload).json()
    # 2. Poll for completion
    execution_id = response['id']
    status_url = base_uri + f'api/v1/platform/integration_executions/{execution_id}'
    while True:
        status_response = requests.get(status_url, headers=headers).json()
        if status_response['status'] == 'Completed':
            break
        time.sleep(60)  # Wait before polling again
    # 3. Download the output file
    file_url = status_url + '/file'
    params = {'file_name': 'automationpayrollexport.csv'}
    file_response = requests.get(file_url, headers=headers, params=params)
    data_file = StringIO(file_response.text)
    csv_reader = csv.DictReader(data_file)
    data_list = list(csv_reader)
    # ... process and store data as needed ...
```

### Explanation
- **Trigger Integration:** The function sends a POST request to the integration execution endpoint, passing required parameters (dates, file names, hyperfind, etc.).
- **Poll for Completion:** The function polls the execution status endpoint until the integration is complete.
- **Download Output:** Once complete, the output file is downloaded and parsed as CSV.
- **Processing:** The data can then be processed or loaded into a database as needed.

**Reference:**
- [UKG Dimensions API Documentation – Integrations](https://community.kronos.com/s/article/UKG-Dimensions-API-Documentation)

---

## 2. Extracting Data from a DataView Using a Hyperfind Query

DataViews in UKG Dimensions allow you to define custom reports. You can extract data from a DataView programmatically using the API and a Hyperfind query to filter employees.

### Python Function: `fetch_and_store_hours_using_dataview`

```python
def fetch_and_store_hours_using_dataview(environment, week_start_datetime, week_end_datetime):
    import json, time, csv, os
    # ... import your secret and DB utilities ...
    pay_code_translation = { 'Regular': 'REG', 'Overtime 1.5': 'OT', 'Doubletime': 'DBL', ... }
    access_token, base_uri, api_key = get_token_apikey_and_uri(environment)
    export_url = base_uri + 'api/v1/commons/exports/async'
    headers = {
        'Content-Type': 'application/json',
        'appkey': api_key,
        'Authorization': access_token
    }
    payload = json.dumps({
        "name": "UKG DV Export Pay Code",
        "payLoad": {
            "from": {
                "view": 0,
                "employeeSet": {
                    "hyperfind": {"id": "1304"},
                    "dateRange": {
                        "startDate": week_start_datetime.strftime("%Y-%m-%d"),
                        "endDate": week_end_datetime.strftime("%Y-%m-%d"),
                    }
                },
                "viewPresentation": "People"
            },
            "select": [
                {"key": "PEOPLE_PERSON_NUMBER", "alias": "Employee ID", ...},
                {"key": "CORE_PAYCODE", "alias": "Pay Code Name", ...},
                {"key": "TIMECARD_TRANS_ACTUAL_HOURS", "alias": "Actual Hours", ...},
                # ... more fields ...
            ],
            "groupBy": [],
            "where": [],
        },
        "type": "DATA"
    })
    # 1. Trigger DataView export
    response = requests.post(export_url, headers=headers, data=payload)
    execution_key = response.json()['executionKey']
    # 2. Wait for export to complete
    time.sleep(60)
    # 3. Download the CSV file
    csv_export_url = base_uri + f'api/v1/commons/exports/{execution_key}/file'
    response = requests.get(csv_export_url, headers=headers)
    temp_file_path = '/tmp/paycodeextracttempdetail.csv'
    with open(temp_file_path, "w", encoding="utf-8") as file:
        file.write(response.text)
    # ... process CSV as needed ...
```

### Explanation
- **Trigger DataView Export:** Sends a POST request to the DataView export endpoint with the required payload (including Hyperfind and date range).
- **Wait for Completion:** Waits for the export to complete (can be improved with polling).
- **Download CSV:** Downloads the resulting CSV file for further processing.
- **Processing:** The CSV can be parsed and loaded into a database or used for reporting.

**Reference:**
- [UKG Dimensions API Documentation – DataViews](https://community.kronos.com/s/article/UKG-Dimensions-API-Documentation)

---

## 3. Orchestrating the Process: `process_and_validate_payroll_hours`


This function coordinates the two previous steps, automating the extraction of both payroll export and DataView data for a given period. It uses the `fetch_period` function to retrieve the start and end dates for both the prior and current pay periods, and then passes these as parameters to the extraction functions.

### Python Function: `process_and_validate_payroll_hours` (with `prior_period` and `current_period` parameters)

```python
def process_and_validate_payroll_hours(environment='PROD'):
    """
    Main function to process and validate payroll hours.
    Steps:
    1. Fetches the prior period data and stores payroll hours.
    2. Fetches and stores hours using dataview for the prior period.
    3. Fetches the current period data and stores hours using dataview.
    """
    # Get prior period (returns tuple: start_date, end_date, start_datetime, end_datetime)
    prior_period = fetch_period('Previous', environment)
    # Extract and store payroll hours for prior period
    fetch_and_store_payroll_hours(environment, *prior_period)
    # Extract and store DataView hours for prior period
    fetch_and_store_hours_using_dataview(environment, prior_period[2], prior_period[3])

    # Get current period
    current_period = fetch_period('Current', environment)
    # Extract and store DataView hours for current period
    fetch_and_store_hours_using_dataview(environment, current_period[2], current_period[3])

    # Optionally, add validation or reporting here
```

#### About `prior_period` and `current_period`

The `fetch_period` function returns a tuple for each period:

- `start_date` (str): Start date of the pay period (e.g., '2025-06-01')
- `end_date` (str): End date of the pay period (e.g., '2025-06-15')
- `start_datetime` (datetime): Start date as a Python `datetime` object
- `end_datetime` (datetime): End date as a Python `datetime` object

These are used as parameters for the extraction functions:

- `fetch_and_store_payroll_hours(environment, start_date, end_date, start_datetime, end_datetime)`
- `fetch_and_store_hours_using_dataview(environment, start_datetime, end_datetime)`

This approach ensures that all data extraction is aligned to the correct pay periods, and makes it easy to extend the process for additional periods or custom ranges.

### Example Usage

```python
if __name__ == "__main__":
    process_and_validate_payroll_hours(environment="PROD")
```

### Explanation
- **Fetch Periods:** Retrieves the date ranges for the previous and current pay periods using `fetch_period`.
- **Extract Data:** Calls the two extraction functions for each period, passing the correct parameters.
- **Validation:** (Optional) You can add logic to compare and validate the extracted data.

---

## Conclusion

By leveraging the UKG Dimensions API, you can automate the execution of predefined integrations and the extraction of DataView data. This enables robust, repeatable, and auditable data flows for payroll, compliance, and analytics.

For more details, consult the official [UKG Dimensions API Documentation](https://community.kronos.com/s/article/UKG-Dimensions-API-Documentation) or your UKG support representative.

