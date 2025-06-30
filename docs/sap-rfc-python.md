# Calling SAP RFC Function Modules from Python Using PyRFC: A Step-by-Step Guide

> **Note:** For details on installing and configuring the `PyRFC` module inside a container, see the companion article: [Installing the PyRFC Module for SAP Integration](sap-rfc-python-container.md)

## Introduction

SAP ECC systems expose powerful RFC (Remote Function Call) interfaces that allow external programs to interact with SAP data and business logic. Python, with the help of the [PyRFC](https://github.com/SAP/PyRFC) library, makes it possible to call these RFC function modules directly and process the results in a modern, flexible way.

This article demonstrates how to:
- Connect to an SAP ECC 6.0 (EHP 8) system from Python
- Call a custom RFC function module 
- Pass parameters to the RFC
- Retrieve tabular data
- Save the results to a CSV file

We will use a modular, production-ready approach inspired by real-world enterprise integration scripts.

---

## Prerequisites

- Access to an SAP ECC system with a custom RFC function module you can call
- SAP user credentials with RFC permissions
- The [PyRFC](https://github.com/SAP/PyRFC) library installed (see [Installing the PyRFC Module for SAP Integration](sap-rfc-python-container.md) for setup)
- Python 3.7+

---

## Example: Extracting Data from SAP via RFC

Suppose you want to extract financial data from SAP using a custom RFC function module. The following example shows how to do this in a robust, reusable way.

### 1. Define Your RFC Connection and Extract Configuration

```python
from pyrfc import Connection, LogonError, ABAPApplicationError, ABAPRuntimeError
import csv
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sap_rfc_extract")

# --- RFC Connection Parameters (replace with your SAP system details) ---
SAP_CONN_PARAMS = {
    'ashost': 'SAP_APP_SERVER_HOST',   # SAP application server
    'sysnr': '00',                     # System number
    'client': '100',                   # Client number
    'user': 'SAP_USERNAME',            # SAP user
    'passwd': 'SAP_PASSWORD',          # SAP password
    'lang': 'EN',                      # Language
}

# --- RFC Extract Configuration ---
EXTRACT_CONFIG = {
    'example_extract': {
        'function_module': 'ZMY_CUSTOM_RFC_MODULE',  # Replace with your RFC FM name
        'table_name': 'IT_RESULT_TAB',              # The table returned by the RFC
        'params': ['IM_CC', 'IM_YEAR', 'IM_PERIOD'],
        'default_params': {'IM_CC': '1000', 'IM_YEAR': '2025', 'IM_PERIOD': '05'},
        'filename_fmt': 'sap_extract_{cc}_{year}_{period}.csv',
    },
}
```

### 2. Utility Functions for RFC Calls and CSV Export

```python
def call_rfc(conn_params, function_module, params):
    try:
        conn = Connection(**conn_params)
        logger.info(f"Calling RFC: {function_module} with params: {params}")
        return conn.call(function_module, **params)
    except LogonError as e:
        logger.error(f"Logon Error: {e}")
    except ABAPApplicationError as e:
        logger.error(f"ABAP Application Error: {e}")
    except ABAPRuntimeError as e:
        logger.error(f"ABAP Runtime Error: {e}")
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
    return None

def export_result_to_csv(table_data, filename):
    if not table_data:
        logger.warning("No data to export.")
        return
    with open(filename, 'w', newline='', encoding='utf-8') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=table_data[0].keys())
        writer.writeheader()
        writer.writerows(table_data)
    logger.info(f"Exported data to {filename}")
```

### 3. Main Script: Running the Extract

```python
import argparse

def main():
    parser = argparse.ArgumentParser(description="Run SAP RFC extract via PyRFC.")
    parser.add_argument('--im_cc', default=EXTRACT_CONFIG['example_extract']['default_params']['IM_CC'], help='Company code')
    parser.add_argument('--im_year', default=EXTRACT_CONFIG['example_extract']['default_params']['IM_YEAR'], help='Fiscal year')
    parser.add_argument('--im_period', default=EXTRACT_CONFIG['example_extract']['default_params']['IM_PERIOD'], help='Fiscal period')
    args = parser.parse_args()

    # Prepare parameters for RFC call
    params = {
        'IM_CC': args.im_cc,
        'IM_YEAR': args.im_year,
        'IM_PERIOD': args.im_period,
    }

    config = EXTRACT_CONFIG['example_extract']
    result = call_rfc(SAP_CONN_PARAMS, config['function_module'], params)
    if result and config['table_name'] in result:
        # Build filename
        filename = config['filename_fmt'].format(
            cc=args.im_cc, year=args.im_year, period=args.im_period
        )
        export_result_to_csv(result[config['table_name']], filename)
    else:
        logger.error("No data returned from RFC or table not found in result.")

if __name__ == "__main__":
    main()
```

---

## 4. Running the Script

You can run the script from the command line, specifying parameters as needed:

```bash
python sap_rfc_extract.py --im_cc=1000 --im_year=2025 --im_period=05
```

- The script will connect to SAP, call the RFC, and save the results to a CSV file (e.g., `sap_extract_1000_2025_05.csv`).
- You can override any parameter using the command line.

---

## 5. Step-by-Step Explanation

1. **Configuration:**
   - All SAP connection details and extract metadata are defined at the top for easy maintenance.
   - The RFC function module name and table name are generic placeholders—replace them with your actual SAP details.

2. **Calling the RFC:**
   - The `call_rfc` function establishes a connection and calls the RFC, handling common SAP errors.
   - Parameters are passed as a dictionary, matching the RFC signature.

3. **Exporting Data:**
   - The `export_result_to_csv` function writes the returned table to a CSV file, using the first row's keys as headers.

4. **Command-Line Interface:**
   - The script uses `argparse` to allow easy parameter overrides from the command line.

5. **Error Handling:**
   - All errors are logged, and the script will not crash on SAP or network errors.

---

## Conclusion

With this approach, you can easily:
- Call any SAP RFC function module from Python
- Parameterize your extracts
- Save results to CSV for downstream processing
- Integrate SAP data into modern Python workflows

For more advanced scenarios (multi-company code loops, dynamic extract configuration, etc.), see the full project code or reach out for further examples.

---

## Further Reading
- [PyRFC Documentation](https://github.com/SAP/PyRFC)
- [SAP RFC SDK](https://support.sap.com/en/product/connectors.html)
- [Installing the PyRFC Module for SAP Integration](sap-rfc-python-container.md) — How to install and configure PyRFC in a container
