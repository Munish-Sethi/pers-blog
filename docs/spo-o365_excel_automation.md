# Programmatically Editing Excel Files on SharePoint Online with Python

## Introduction

Have you ever faced a situation where users have built a complex Excel workbook with intricate formulas, VLOOKUPs, cross-sheet references, and embedded charts—and now they want a web interface for data entry, but **without duplicating the Excel logic**?

This is exactly the challenge our Engineering Department faced. They had a sophisticated pump comparison workbook (`.xlsx` file, no macros) with multiple worksheets containing complicated formulas and inter-sheet dependencies. Once data was input into the data input sheet, various VLOOKUPs and formulas would refresh all dependent worksheets, which contained embedded graphs showing comparative analysis.

### The Business Requirements

The engineering team wanted to:
1. **Create a web interface** for users to input pump comparison parameters
2. **Reuse the existing Excel logic** (not rebuild formulas in code)
3. **Inject data** into the Excel input worksheet programmatically
4. **Let Excel recalculate** all formulas and charts automatically
5. **Export the refreshed charts** from Excel as images
6. **Generate a PDF report** combining all charts
7. **Email the PDF** to specified recipients

### The Challenge

Traditionally, this would require one of these approaches:
- **COM Automation**: Requires Excel installation on the server, Windows-only, licensing costs, not cloud-ready
- **Third-party libraries** (openpyxl, xlwings): Cannot execute Excel formulas, would need to duplicate all logic in Python
- **Rebuild everything in code**: Weeks of development to replicate complex Excel formulas, error-prone, hard to maintain

### Solution

What if we could **store the Excel file on SharePoint**, **open it programmatically via Microsoft Graph API**, **inject data without needing Excel installed**, and let Excel's native calculation engine do all the work?

This is exactly what we built—and it's surprisingly simple.

### What This Article Demonstrates

This article shows you how to:
- Open and edit an `.xlsx` file on SharePoint Online using Python and Microsoft Graph API
- Inject data into worksheets, triggering automatic formula recalculation
- Extract refreshed charts as PNG images
- Build a complete Flask web application for user input
- Generate professional PDF reports with ReportLab
- Automate email distribution with attachments
- Deploy a production-ready solution without Excel components or third-party Excel libraries

**The result?** A simple, cloud-native solution to a complex problem—avoiding weeks of development time and eliminating ongoing maintenance of duplicated Excel logic.

---

## Authentication and Permissions

Our solution uses **Azure AD Service Principal with certificate-based authentication** for secure, automated access to SharePoint Online.

> For detailed authentication setup and certificate-based SPN configuration, see my previous blog article:
> - [Certificate Based Authentication](azure-ad-certificate.md)

### Required Graph API Permissions

The Azure AD App Registration requires these **Application Permissions** (not delegated):

- `Files.ReadWrite.All` - Read and write files in all site collections
- `Sites.ReadWrite.All` - Access SharePoint sites
- `User.Read` - Read basic user profile
- `offline_access` - Maintain access to data

### Authentication Code

The production code uses the Microsoft Authentication Library (MSAL) to acquire access tokens:

```python
import msal
import requests
from datetime import datetime

# Azure AD Configuration
TENANT_ID = "your-tenant-id"
CLIENT_ID = "your-client-id"
CERTIFICATE_PATH = "/path/to/certificate.pem"
THUMBPRINT = "certificate-thumbprint"
AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPES = ["https://graph.microsoft.com/.default"]

def get_access_token_API_Access_AAD():
    """
    Acquire access token using certificate-based authentication.
    Returns a valid access token for Microsoft Graph API calls.
    """
    try:
        # Load the certificate
        with open(CERTIFICATE_PATH, 'r') as cert_file:
            certificate = cert_file.read()

        # Create MSAL confidential client application
        app = msal.ConfidentialClientApplication(
            CLIENT_ID,
            authority=AUTHORITY,
            client_credential={
                "thumbprint": THUMBPRINT,
                "private_key": certificate
            }
        )

        # Acquire token from cache or request new one
        result = app.acquire_token_silent(SCOPES, account=None)

        if not result:
            result = app.acquire_token_for_client(scopes=SCOPES)

        if "access_token" in result:
            return result["access_token"]
        else:
            error_msg = result.get("error_description", "Unknown error")
            raise Exception(f"Failed to acquire token: {error_msg}")

    except Exception as e:
        print(f"Authentication error: {e}")
        raise

# Azure Graph API base URL
AZURE_GRAPH_V1 = "https://graph.microsoft.com/v1.0/"
```

### Configuration for Your Excel Workbook

You'll need to identify your SharePoint Drive ID and Excel file Item ID:

```python
# SharePoint Drive and Item IDs
DRIVE_ID = 'u9lKkdkMJrbBGuSPA3SOEES-Q6_dw04h-byj'
ITEM_ID = '01WWHOXQPRVTA47QWLKVA34C4X56SD3KQB'

# Construct workbook base URL
WORKBOOK_BASE = f"{AZURE_GRAPH_V1}drives/{DRIVE_ID}/items/{ITEM_ID}/workbook"
```

**How to find your Drive ID and Item ID:**

1. Navigate to your SharePoint document library in a browser
2. Right-click on the Excel file and select "Details"
3. Use Microsoft Graph Explorer or the REST API to query file metadata:
   ```
   GET https://graph.microsoft.com/v1.0/sites/{site-id}/drive/root:/path/to/file.xlsx
   ```

Once authenticated, you can use the access token to interact with the Excel file on SPO.

---

## Why This Approach Wins: Comparison with Alternatives

Before diving into the implementation, let's understand why the Microsoft Graph API approach is superior to traditional methods:

| Approach | Implementation Complexity | Maintenance Burden | Infrastructure Requirements | Formula Execution | Cost |
|----------|---------------------------|--------------------|-----------------------------|-------------------|------|
| **Microsoft Graph API** ✅ | Low - REST API calls | Minimal - Excel team maintains formulas | Cloud-native, no servers | Native Excel engine | Free (O365 license) |
| **COM Automation** | High - COM interop, Windows-specific | High - Server maintenance, Excel licensing | Windows Server, Excel installation | Native Excel engine | High (Windows Server + Excel licenses) |
| **Third-party Libraries** (openpyxl, xlwings) | Medium - Python code | High - Must duplicate ALL formulas in code | Any OS | **No formula execution** | Medium (library licenses) |
| **Rebuild in Code** | Very High - Replicate all Excel logic | Very High - Code changes for every formula update | Any OS | Custom implementation | High (development time) |
| **Excel Online Automation** | Medium - Selenium/browser automation | High - Brittle, breaks with UI changes | Browser automation infrastructure | Native Excel engine | Medium (infrastructure) |

### Key Advantages of Graph API Approach

1. **No Excel Installation Required**
   - Runs on any OS (Linux, macOS, Windows)
   - No licensing costs for Excel on servers
   - Cloud-native architecture

2. **Reuse Existing Excel Logic**
   - Subject matter experts (engineers, finance teams) maintain formulas in Excel
   - Developers don't need to understand complex business logic
   - Changes to formulas don't require code changes

3. **Formula Execution Without Code**
   - Excel's native calculation engine handles all formulas
   - VLOOKUPs, array formulas, charts automatically recalculate
   - No risk of formula logic discrepancies

4. **Scalable & Secure**
   - Azure AD authentication
   - Role-based access control
   - Audit logging built-in
   - Handles concurrent users

5. **Simple Deployment**
   - Deploy to Azure App Service, Docker, or any Python host
   - No Windows dependencies
   - Standard REST API calls

### When This Approach Is Ideal

✅ Complex Excel workbooks with intricate formulas
✅ Business users maintain formulas, developers build interface
✅ Need web/mobile access to Excel functionality
✅ Want to avoid duplicating business logic in code
✅ Cloud-first architecture

### When to Consider Alternatives

❌ Need to execute VBA macros (`.xlsm` files not supported by Graph API)
❌ Excel file must remain on local/on-premises servers
❌ Need offline access (Graph API requires internet connectivity)

---

## Connecting to the Excel File on SPO

The following code sets up the workbook endpoint and session management:

```python
DRIVE_ID = '...'
ITEM_ID = '...'
GRAPH_BASE = f"{AZURE_GRAPH_V1}drives/{DRIVE_ID}/items/{ITEM_ID}/workbook"

def headers(token, session_id=None):
    h = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if session_id:
        h["workbook-session-id"] = session_id
    return h
```

---

## Creating and Closing Workbook Sessions

Sessions ensure your changes are saved and visible to all users. Always close the session after editing.

```python
def create_session(token, persist=True):
    url = f"{GRAPH_BASE}/createSession"
    body = {"persistChanges": persist}
    r = requests.post(url, headers=headers(token), json=body)
    r.raise_for_status()
    return r.json()["id"]

def close_session(token, session_id):
    url = f"{GRAPH_BASE}/closeSession"
    try:
        r = requests.post(url, headers=headers(token, session_id))
        if r.status_code == 204:
            print("✅ Workbook session closed successfully.")
        else:
            print(f"⚠️  Could not close session cleanly: {r.status_code} {r.text}")
    except Exception as e:
        print(f"⚠️  Error closing session: {e}")
```

---

## Listing Worksheets and Charts

You can enumerate all worksheets and charts in the workbook:

```python
def list_worksheets(token, session_id):
    url = f"{GRAPH_BASE}/worksheets"
    r = requests.get(url, headers=headers(token, session_id))
    r.raise_for_status()
    return r.json().get("value", [])

def list_charts(token, session_id, sheet_name):
    url = f"{GRAPH_BASE}/worksheets('{sheet_name}')/charts"
    r = requests.get(url, headers=headers(token, session_id))
    r.raise_for_status()
    return r.json().get("value", [])
```

---

## Injecting Data into Excel Worksheets

You can update any cell in the workbook using the Graph API. This triggers recalculation of formulas, tables, and charts automatically.

### Cell Update Function

Here's the production code for updating a single cell:

```python
import requests
from common.logger import setup_logger

logger = setup_logger("pumpapp", "/mnt/azure/logs/pumpapp.log")

UNPROCESSED_PATH = "/mnt/azure/pumpcompare/unprocessed"
PROCESSED_PATH = "/mnt/azure/pumpcompare/processed"

def workbook_headers(token, session_id=None):
    """Generate headers for workbook API requests."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    if session_id:
        headers["workbook-session-id"] = session_id
    return headers

def update_cell(token, session_id, sheet_name, cell_address, value):
    """
    Update a single cell in the worksheet.

    Args:
        token: Access token for Graph API
        session_id: Active workbook session ID
        sheet_name: Name of the worksheet (e.g., "Input Screen")
        cell_address: Excel cell address (e.g., "B3")
        value: Value to write to the cell
    """
    try:
        url = f"{WORKBOOK_BASE}/worksheets('{sheet_name}')/range(address='{cell_address}')"
        body = {"values": [[value]]}  # Must be a 2D array

        r = requests.patch(url, headers=workbook_headers(token, session_id), json=body)
        r.raise_for_status()

        logger.info(f"✅ Updated {sheet_name}!{cell_address} to '{value}'")
    except Exception as e:
        logger.error(f"❌ Failed to update {sheet_name}!{cell_address}: {e}")
        raise
```

### JSON-Driven Workbook Update

The production system uses JSON files to define what data should be injected into which cells. This is the complete `update_workbook` function:

```python
import json
import os

def extract_filename(filepath):
    """Extract filename without extension from a path."""
    filename = os.path.basename(filepath)
    filename_without_ext = os.path.splitext(filename)[0]
    return filename_without_ext

def update_workbook(token, session_id, file_to_process):
    """
    Update workbook cells based on JSON file.

    The JSON file structure:
    {
        "jobPressure": {"value": 14, "worksheet": "Input Screen", "cell": "B3"},
        "driverPower": {"value": 3100, "worksheet": "Input Screen", "cell": "B4"},
        "pumps": [
            {
                "name": {"value": "Model-5000 HF", "worksheet": "Input Screen", "cell": "B13"},
                "diameter": {"value": 4.0, "worksheet": "Input Screen", "cell": "B21"}
            }
        ],
        "emailRecipients": ["user@example.com"]
    }

    Returns:
        tuple: (graph_files_prefix, email_recipients, email_recipients_bcc)
    """
    try:
        graph_files_prefix = extract_filename(file_to_process)

        # Load JSON file
        with open(os.path.join(UNPROCESSED_PATH, file_to_process), 'r') as f:
            data = json.load(f)

        # Extract email arrays
        email_recipients = data.get('emailRecipients', [])
        email_recipients_bcc = data.get('emailRecipientsbcc', [])

        # Process global parameters (excluding email fields and pumps)
        global_params = ['jobPressure', 'driverPower', 'fleetSize', 'pumpUsage', 'engineRPM']

        for param in global_params:
            if param in data:
                param_data = data[param]
                value = param_data['value']
                worksheet = param_data['worksheet']
                cell = param_data['cell']
                # Update the cell
                update_cell(token, session_id, worksheet, cell, value)

        # Process pumps array
        if 'pumps' in data:
            for pump in data['pumps']:
                # Update pump name
                name_data = pump['name']
                update_cell(
                    token,
                    session_id,
                    name_data['worksheet'],
                    name_data['cell'],
                    name_data['value']
                )

                # Update pump diameter
                diameter_data = pump['diameter']
                update_cell(
                    token,
                    session_id,
                    diameter_data['worksheet'],
                    diameter_data['cell'],
                    diameter_data['value']
                )

        return graph_files_prefix, email_recipients, email_recipients_bcc

    except Exception as e:
        logger.error(f"Failed to update workbook: {e}")
        raise
```

### Example JSON Input File

Here's an actual JSON file that gets processed:

```json
{
  "jobPressure": {
    "value": 14,
    "worksheet": "Input Screen",
    "cell": "B3"
  },
  "driverPower": {
    "value": 3100,
    "worksheet": "Input Screen",
    "cell": "B4"
  },
  "fleetSize": {
    "value": 20,
    "worksheet": "Input Screen",
    "cell": "B5"
  },
  "pumpUsage": {
    "value": 20,
    "worksheet": "Input Screen",
    "cell": "B8"
  },
  "engineRPM": {
    "value": 1900,
    "worksheet": "Input Screen",
    "cell": "B9"
  },
  "pumps": [
    {
      "name": {
        "value": "Model-5000 HF",
        "worksheet": "Input Screen",
        "cell": "B13"
      },
      "diameter": {
        "value": 4.0,
        "worksheet": "Input Screen",
        "cell": "B21"
      }
    },
    {
      "name": {
        "value": "Kerr EF5",
        "worksheet": "Input Screen",
        "cell": "D13"
      },
      "diameter": {
        "value": 4.0,
        "worksheet": "Input Screen",
        "cell": "D21"
      }
    }
  ],
  "emailRecipients": ["engineer@company.com", "manager@company.com"]
}
```

**Key Points:**
- **No Excel installation needed** - Pure REST API calls
- **Formulas recalculate automatically** - Excel's native calculation engine handles all dependencies
- **VLOOKUPs update automatically** - Charts, pivot tables, and formulas refresh after data injection
- **Only `.xlsx` files supported** - Macro-enabled files (`.xlsm`) are not editable via Graph API
- **Declarative configuration** - Cell mappings defined in JSON, not hardcoded

---

## Looping Through Worksheets and Extracting Charts

After updating the workbook, you can loop through all worksheets and extract charts as images:

```python
worksheets = list_worksheets(token, session_id)
for ws in worksheets:
    ws_name = ws["name"]
    charts = list_charts(token, session_id, ws_name)
    if not charts:
        print(f"No charts found on worksheet '{ws_name}'")
        continue
    print(f"Charts on '{ws_name}': {[c['name'] for c in charts]}")
    for chart in charts:
        chart_name = chart["name"]
        try:
            img_bytes = get_chart_image(token, session_id, ws_name, chart_name)
            fname = os.path.join(PROCESSED_PATH, f"{graph_files_prefix}_{ws_name}_{chart_name.replace(' ', '_')}.png")
            with open(fname, "wb") as f:
                f.write(img_bytes)
            print(f"   ✔ Saved chart '{chart_name}' as {fname}")
        except Exception as e:
            print(f"   ⚠ Failed to get chart '{chart_name}': {e}")
```

**Chart Extraction Function:**

```python
def get_chart_image(token, session_id, sheet, chart_name):
    cname = quote(chart_name, safe="")
    url = f"{GRAPH_BASE}/worksheets('{sheet}')/charts('{cname}')/image(width=0,height=0,fittingMode='fit')"
    r = requests.get(url, headers=headers(token, session_id))
    r.raise_for_status()
    b64 = r.json()["value"]
    return base64.b64decode(b64)
```

---

## Building the Web Interface with Flask

The production system uses **Flask** to provide a responsive web interface that works on desktop, tablet, and mobile devices. This allows users to input data via a simple form instead of directly editing Excel.

### Flask Application Setup

```python
from flask import Flask, request, render_template_string, jsonify
import json
import os
from datetime import datetime
import time

app = Flask(__name__)

app.config.from_mapping(
    SECRET_KEY=os.urandom(24),
    SESSION_TYPE='filesystem',
)

# Directory configuration
UNPROCESSED_PATH = "/mnt/azure/pumpcompare/unprocessed"
PROCESSED_PATH = "/mnt/azure/pumpcompare/processed"
```

### The Pump Comparison Web Route

This is the main route that handles both displaying the form (GET) and processing submissions (POST):

```python
@app.route('/pump-comparison', methods=['GET', 'POST'])
def pump_comparison():
    """
    Handle pump comparison requests.
    GET: Display form with pump selections
    POST: Process form, create JSON, trigger Excel automation
    """

    if request.method == 'POST':
        # Check if user is returning to form (not processing new request)
        if request.form.get('action') == 'return':
            # Repopulate form with previous values
            pump_names = [
                "Dragon DP4000Q", "FET FXD3500", "Model-3500", "Model-3600 HF",
                "Model-5000 HF", "Kerr EF5", "Kerr EF5 Lite", "SPM WS335",
                "SPM QEM 3600C", "SPM QEM 5000C", "AW 2500", "FET FXD2250",
                "FET FXD2500", "FET FXD3000", "Model-2250T", "Model-2500Q HDF",
                "Model-C2500", "Model-3000", "SPM EXL", "VT-2500Q 52IN", "VT-2500Q 60IN"
            ]
            diameters = [3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5]

            return render_template_string(
                get_form_template(),
                pump_names=pump_names,
                diameters=diameters,
                error_message=None,
                form_data=request.form
            )

        # Validate that at least 2 pumps are selected
        selected_pumps = 0
        for i in range(1, 5):
            pump_name = request.form.get(f'pump{i}_name', '').strip()
            pump_diameter = request.form.get(f'pump{i}_diameter', '').strip()
            if pump_name and pump_diameter:
                selected_pumps += 1

        if selected_pumps < 2:
            error_message = "Please select at least 2 pumps for comparison."
            # Redisplay form with error
            pump_names = ["Dragon DP4000Q", "FET FXD3500", ...]  # Full list
            diameters = [3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5]

            return render_template_string(
                get_form_template(),
                pump_names=pump_names,
                diameters=diameters,
                error_message=error_message,
                form_data=request.form
            )

        # Build JSON structure from form data
        json_data = {
            "jobPressure": {
                "value": int(request.form.get('jobPressure', 0)),
                "worksheet": "Input Screen",
                "cell": "B3"
            },
            "driverPower": {
                "value": int(request.form.get('driverPower', 0)),
                "worksheet": "Input Screen",
                "cell": "B4"
            },
            "fleetSize": {
                "value": int(request.form.get('fleetSize', 0)),
                "worksheet": "Input Screen",
                "cell": "B5"
            },
            "pumpUsage": {
                "value": int(request.form.get('pumpUsage', 0)),
                "worksheet": "Input Screen",
                "cell": "B8"
            },
            "engineRPM": {
                "value": int(request.form.get('engineRPM', 0)),
                "worksheet": "Input Screen",
                "cell": "B9"
            },
            "emailRecipients": [],
            "pumps": []
        }

        # Define cell mappings for 4 pumps
        pump_cells = {
            1: {"name": "B13", "diameter": "B21"},
            2: {"name": "D13", "diameter": "D21"},
            3: {"name": "F13", "diameter": "F21"},
            4: {"name": "H13", "diameter": "H21"}
        }

        # Process all 4 pumps (empty strings for unselected pumps)
        for i in range(1, 5):
            pump_name = request.form.get(f'pump{i}_name', '').strip()
            pump_diameter = request.form.get(f'pump{i}_diameter', '').strip()

            # Convert diameter to float if it exists, otherwise empty string
            diameter_value = float(pump_diameter) if pump_diameter else ""

            pump_data = {
                "name": {
                    "value": pump_name if pump_name else "",
                    "worksheet": "Input Screen",
                    "cell": pump_cells[i]["name"]
                },
                "diameter": {
                    "value": diameter_value,
                    "worksheet": "Input Screen",
                    "cell": pump_cells[i]["diameter"]
                }
            }
            json_data["pumps"].append(pump_data)

        # Create filename with timestamp
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S%f")
        filename = f"pump_comparison_{timestamp}.json"

        # Define file path
        file_path = os.path.join(UNPROCESSED_PATH, filename)

        # Ensure directory exists
        os.makedirs(os.path.dirname(file_path), exist_ok=True)

        # Write JSON file
        with open(file_path, 'w') as json_file:
            json.dump(json_data, json_file, indent=2)

        # Sleep briefly to ensure file is on storage account
        time.sleep(3)

        # Trigger the Excel automation process
        chart_files = process_pump_comparison_requests()

        # Construct the PDF filename
        pdf_filename = f"{filename.replace('.json', '')}_Pump_Comparison.pdf"

        # Return success page with charts
        return render_template_string(
            get_success_template(),
            filename=filename,
            pdf_filename=pdf_filename,
            form_data=request.form,
            chart_files=chart_files
        )

    # GET method - Display the form with default values
    pump_names = [
        "Dragon DP4000Q", "FET FXD3500", "Model-3500", "Model-3600 HF",
        "Model-5000 HF", "Kerr EF5", "Kerr EF5 Lite", "SPM WS335",
        "SPM QEM 3600C", "SPM QEM 5000C", "AW 2500", "FET FXD2250",
        "FET FXD2500", "FET FXD3000", "Model-2250T", "Model-2500Q HDF",
        "Model-C2500", "Model-3000", "SPM EXL", "VT-2500Q 52IN", "VT-2500Q 60IN"
    ]
    diameters = [3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5]

    # Set default values
    default_data = {
        'jobPressure': '14',
        'driverPower': '3100',
        'fleetSize': '20',
        'pumpUsage': '20',
        'engineRPM': '1900',
        'pump1_name': 'Model-5000 HF',
        'pump1_diameter': '4.0',
        'pump2_name': 'Kerr EF5',
        'pump2_diameter': '4.0'
    }

    return render_template_string(
        get_form_template(),
        pump_names=pump_names,
        diameters=diameters,
        error_message=None,
        form_data=default_data
    )

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=80)
```

### Key Features of the Web Interface

1. **Responsive Design**: Works on desktop, tablet (iPad optimized), and mobile devices
2. **Client-Side Validation**: JavaScript ensures at least 2 pumps are selected
3. **Server-Side Validation**: Python validates data before processing
4. **Default Values**: Pre-populated sensible defaults for quick testing
5. **Error Handling**: Clear error messages guide users
6. **Progress Feedback**: Users see their input parameters and generated charts

### HTML Form Template

The form template is embedded in the Python code using Jinja2 templating. Here's an excerpt showing the structure:

```python
def get_form_template():
    return """
    <!doctype html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
        <title>Pump Comparison</title>
        <style>
            /* Modern, responsive CSS */
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto; }
            .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; }
            input[type="number"], select {
                width: 100%;
                padding: 12px;
                border: 2px solid #ddd;
                border-radius: 8px;
                min-height: 44px;  /* iPad touch target */
            }
            /* Mobile responsive */
            @media (max-width: 767px) {
                .form-grid { grid-template-columns: 1fr; }
            }
        </style>
    </head>
    <body>
        <h1>Pump Comparison Tool</h1>
        <form method="POST">
            {% if error_message %}
            <div class="error-message">{{ error_message }}</div>
            {% endif %}

            <!-- Global Parameters Section -->
            <div class="section">
                <h2>Global Parameters</h2>
                <div class="form-grid">
                    <div class="form-group">
                        <label for="jobPressure">Job Pressure (1-20)</label>
                        <input type="number" name="jobPressure" min="1" max="20"
                               value="{{ form_data.get('jobPressure', '14') }}" required>
                    </div>
                    <!-- Additional fields... -->
                </div>
            </div>

            <!-- Pump Selection Section -->
            <div class="section">
                <h2>Pump Comparison</h2>
                {% for i in range(1, 5) %}
                <div class="pump-card">
                    <div class="pump-header">Pump {{ i }}</div>
                    <select name="pump{{ i }}_name" {% if i <= 2 %}required{% endif %}>
                        <option value="">-- Select Pump --</option>
                        {% for pump in pump_names %}
                        <option value="{{ pump }}">{{ pump }}</option>
                        {% endfor %}
                    </select>
                    <select name="pump{{ i }}_diameter" {% if i <= 2 %}required{% endif %}>
                        {% for diameter in diameters %}
                        <option value="{{ diameter }}">{{ diameter }}</option>
                        {% endfor %}
                    </select>
                </div>
                {% endfor %}
            </div>

            <input type="submit" value="Generate Comparison">
        </form>

        <script>
            // Client-side validation
            document.querySelector('form').addEventListener('submit', function(e) {
                let selectedCount = 0;
                for (let i = 1; i <= 4; i++) {
                    const name = document.getElementById('pump' + i + '_name').value;
                    const diameter = document.getElementById('pump' + i + '_diameter').value;
                    if (name && diameter) selectedCount++;
                }
                if (selectedCount < 2) {
                    e.preventDefault();
                    alert('Please select at least 2 pumps for comparison.');
                }
            });
        </script>
    </body>
    </html>
    """
```

---

## End-to-End Workflow Example

Here is a simplified workflow for processing pump comparison requests:

```python
def process_pump_comparison_requests():
    unprocessed_files = fetch_unprocessed_pump_comparisons_requests()
    for unprocessed_file in unprocessed_files:
        token = get_access_token_API_Access_AAD()
        session_id = create_session(token)
        graph_files_prefix, email_recipients, email_recipients_bcc = update_workbook(token, session_id, unprocessed_file)
        OUTPUT_PDF = os.path.join(PROCESSED_PATH, f"{graph_files_prefix}_Pump_Comparison.pdf")
        worksheets = list_worksheets(token, session_id)
        print("Worksheets found:", [ws["name"] for ws in worksheets])
        # Loop through worksheets and extract charts
        for ws in worksheets:
            ws_name = ws["name"]
            charts = list_charts(token, session_id, ws_name)
            if not charts:
                print(f"No charts found on worksheet '{ws_name}'")
                continue
            print(f"Charts on '{ws_name}': {[c['name'] for c in charts]}")
            for chart in charts:
                chart_name = chart["name"]
                try:
                    img_bytes = get_chart_image(token, session_id, ws_name, chart_name)
                    fname = os.path.join(PROCESSED_PATH, f"{graph_files_prefix}_{ws_name}_{chart_name.replace(' ', '_')}.png")
                    with open(fname, "wb") as f:
                        f.write(img_bytes)
                    print(f"   ✔ Saved chart '{chart_name}' as {fname}")
                except Exception as e:
                    print(f"   ⚠ Failed to get chart '{chart_name}': {e}")
        close_session(token, session_id)
```

---

## Generating Professional PDF Reports with ReportLab

After updating the Excel file and extracting charts, the production system generates a professional PDF report combining the input parameters table with all refreshed charts.

### Complete PDF Generation Code

```python
from reportlab.lib.pagesizes import letter, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
import requests

def generate_pump_comparison_pdf(token, session_id, workbook_base, chart_files, output_pdf_path, graph_files_prefix):
    """
    Generate a comprehensive PDF report with input parameters and charts.

    Args:
        token: Access token
        session_id: Workbook session ID
        workbook_base: Base URL for workbook
        chart_files: List of chart file paths
        output_pdf_path: Path where PDF should be saved
        graph_files_prefix: Prefix for naming
    """

    # Fetch the "Input screen" worksheet data from Excel
    url = f"{workbook_base}/worksheets('Input screen')/usedRange(valuesOnly=true)"
    r = requests.get(url, headers=workbook_headers(token, session_id))
    data = r.json()["values"]  # Returns 2D array

    # Create PDF document with landscape layout
    doc = SimpleDocTemplate(
        output_pdf_path,
        pagesize=landscape(letter),
        leftMargin=6,
        rightMargin=6,
        topMargin=6,
        bottomMargin=6
    )

    elements = []
    styles = getSampleStyleSheet()

    if data:
        # Add company logo
        workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '../'))
        logo_path = os.path.join(workspace_root, 'static', 'logo.png')
        logo = Image(logo_path, width=120, height=60)

        # Create header with title and logo
        title = Paragraph("Input Parameters (Pump Comparisons)", styles['Heading1'])
        header_table = Table([[title, logo]], colWidths=[None, 140])
        header_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))
        elements.append(header_table)
        elements.append(Spacer(1, 12))

        # Clean up rows 0 and 9 (section headers - span across all columns)
        num_cols = len(data[0]) if data and len(data) > 0 else 1
        for row_idx in [0, 9]:
            if len(data) > row_idx:
                data[row_idx] = [data[row_idx][0]] + [''] * (num_cols - 1)

        # Create input parameters table
        table = Table(data)
        table_style = TableStyle([
            # General formatting
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
            ('RIGHTPADDING', (0, 0), (-1, -1), 6),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),

            # Rows 10-11: Pump comparison header (bold, green background)
            ('FONTNAME', (0, 10), (-1, 11), 'Helvetica-Bold'),
            ('BACKGROUND', (0, 10), (-1, 11), colors.lightgreen),

            # Row 0: Main title (span all columns, left align, bold)
            ('SPAN', (0, 0), (-1, 0)),
            ('ALIGN', (0, 0), (-1, 0), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),

            # Row 9: Section header (span all columns, center align, bold)
            ('SPAN', (0, 9), (-1, 9)),
            ('ALIGN', (0, 9), (-1, 9), 'CENTER'),
            ('FONTNAME', (0, 9), (-1, 9), 'Helvetica-Bold'),
        ])
        table.setStyle(table_style)
        elements.append(table)

    # Add all charts to subsequent pages
    chart_files_sorted = sorted(chart_files, reverse=True)
    for img_path in chart_files_sorted:
        elements.append(Spacer(1, 24))
        elements.append(Image(img_path, width=700, height=400))

    # Build the PDF
    doc.build(elements)
    logger.info(f"✅ PDF created with worksheet + charts: {output_pdf_path}")

    return output_pdf_path
```

### Integrating PDF Generation into the Workflow

The PDF generation is called after all charts are extracted:

```python
def process_pump_comparison_requests():
    """Main processing function that orchestrates the entire workflow."""
    try:
        chart_files_for_all_requests = []
        unprocessed_files = fetch_unprocessed_pump_comparisons_requests()

        for unprocessed_file in unprocessed_files:
            # Authenticate and create session
            token = get_access_token_API_Access_AAD()
            session_id = create_workbook_session(token, pump_comparison_workbook_base)

            # Update workbook with JSON data
            graph_files_prefix, email_recipients, email_recipients_bcc = update_workbook(
                token, session_id, unprocessed_file
            )

            OUTPUT_PDF = os.path.join(PROCESSED_PATH, f"{graph_files_prefix}_Pump_Comparison.pdf")

            # List worksheets
            worksheets = list_worksheets(token, session_id, pump_comparison_workbook_base)
            logger.info(f"Worksheets found: {[ws['name'] for ws in worksheets]}")

            chart_files_this_request = []

            # Loop through each worksheet and extract charts
            for ws in worksheets:
                ws_name = ws["name"]
                charts = list_charts(token, session_id, pump_comparison_workbook_base, ws_name)

                if not charts:
                    logger.info(f"No charts found on worksheet '{ws_name}'")
                    continue

                logger.info(f"Charts on '{ws_name}': {[c['name'] for c in charts]}")

                for chart in charts:
                    chart_name = chart["name"]
                    try:
                        img_bytes = get_chart_image(
                            token, session_id, pump_comparison_workbook_base, ws_name, chart_name
                        )
                        fname = os.path.join(
                            PROCESSED_PATH,
                            f"{graph_files_prefix}_{ws_name}_{chart_name.replace(' ', '_')}.png"
                        )
                        with open(fname, "wb") as f:
                            f.write(img_bytes)

                        logger.info(f"   ✔ Saved chart '{chart_name}' as {fname}")
                        chart_files_this_request.append(fname)

                    except Exception as e:
                        logger.error(f"   ⚠ Failed to get chart '{chart_name}': {e}")

            # Generate the PDF report
            generate_pump_comparison_pdf(
                token,
                session_id,
                pump_comparison_workbook_base,
                chart_files_this_request,
                OUTPUT_PDF,
                graph_files_prefix
            )

            # Close workbook session
            close_workbook_session(token, session_id, pump_comparison_workbook_base)

            # Move processed file
            src_path = os.path.join(UNPROCESSED_PATH, unprocessed_file)
            dest_path = os.path.join(PROCESSED_PATH, unprocessed_file)
            os.rename(src_path, dest_path)

            chart_files_for_all_requests.extend(chart_files_this_request)

        return chart_files_for_all_requests

    except Exception as e:
        logger.error(f"Processing error: {e}")
        raise
```

### Key PDF Features

1. **Professional Layout**
   - Landscape orientation for wide tables
   - Company logo in header
   - Consistent styling and spacing

2. **Dynamic Table Rendering**
   - Automatically adapts to Excel data structure
   - Conditional formatting (bold headers, colored backgrounds)
   - Proper cell spanning for section headers

3. **Chart Integration**
   - High-quality PNG images from Excel
   - Optimal sizing (700x400 pixels)
   - Sorted display order

4. **Production-Ready**
   - Error handling and logging
   - File path management
   - Memory-efficient processing

---

## Email Automation: Delivering Reports to Recipients

The final step in the workflow is automatically emailing the PDF report to specified recipients. The production system includes both automatic and user-triggered email sending.

### Email Sending Function

```python
from common.utils import send_email

def send_pump_comparison_email(customer_name, email_recipients, pdf_attachment_path):
    """
    Send an HTML formatted email with pump comparison PDF attachment.

    Args:
        customer_name: Name of the customer/requester
        email_recipients: List of email addresses
        pdf_attachment_path: Full path to the PDF file
    """
    try:
        subject = "Pump Comparison Summary"

        body = f"""
        <html>
        <body style="font-family:verdana,courier,serif; font-size: 13px;">
            <p>Thank you for requesting the pump comparisons summary.</p>
            <p>Attached please find the PDF document with the detailed pump comparisons.</p>
            <br><br><b>**This is an automated message please do not reply**</b><br>
        </body>
        </html>
        """

        send_email(
            recipients=email_recipients,
            subject=subject,
            html_message=body,
            attachments=[pdf_attachment_path],
            bcc=['admin@company.com']
        )

        logger.info(f"Email sent successfully to {email_recipients}")

    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        raise
```

### Flask Route for User-Triggered Email Sending

The web application allows users to send the PDF report via email after reviewing the results:

```python
@app.route('/send-pump-comparison-email', methods=['POST'])
def send_pump_comparison_email_route():
    """
    Handle email sending requests from the results page.
    Users can specify recipient email addresses and trigger sending.
    """
    try:
        # Parse email addresses from form (semicolon-separated)
        customer_emails_raw = request.form.get('customerEmails', '').strip()
        email_list = [email.strip() for email in customer_emails_raw.split(';') if email.strip()]

        pdf_filename = request.form.get('filename', '').strip()

        # Construct PDF file path
        pdf_path_processed = os.path.join(
            "/mnt/azure/pumpcompare/processed",
            pdf_filename.replace('.json', '.pdf')
        )

        # Verify PDF exists
        if not os.path.exists(pdf_path_processed):
            return jsonify({
                "success": False,
                "message": f"PDF file not found: {pdf_filename}"
            }), 404

        # Send the email
        send_pump_comparison_email("", email_list, pdf_path_processed)

        # Return success response and redirect back to results
        return jsonify({
            "success": True,
            "message": "Email sent successfully!"
        }), 200

    except Exception as e:
        logger.error(f"Error sending email: {e}")
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500
```

### Email Form in Results Page

The results page includes an email form where users can specify recipients:

```html
<form method="POST" action="/send-pump-comparison-email">
    <input type="hidden" name="filename" value="{{ pdf_filename }}">

    <label for="customerEmails">Customer Email(s) (Required)</label>
    <input type="text"
           name="customerEmails"
           id="customerEmails"
           placeholder="email1@example.com; email2@example.com"
           required>

    <div class="email-hint">
        Separate multiple emails with semicolons (;)
    </div>

    <button type="submit">Send Email</button>
</form>
```

### Email Integration Options

The production system supports multiple email delivery methods:

1. **Direct SMTP** - Using Python's `smtplib` library
2. **Microsoft Graph API** - Leveraging Office 365 Send Mail endpoint
3. **SendGrid/Mailgun** - Third-party email services

**Example: Microsoft Graph API Email Sending**

```python
import requests

def send_email_via_graph(token, recipients, subject, html_body, attachments):
    """Send email using Microsoft Graph API."""

    url = "https://graph.microsoft.com/v1.0/me/sendMail"

    # Build message payload
    message = {
        "message": {
            "subject": subject,
            "body": {
                "contentType": "HTML",
                "content": html_body
            },
            "toRecipients": [{"emailAddress": {"address": r}} for r in recipients],
            "attachments": []
        }
    }

    # Add PDF attachment (base64 encoded)
    for attachment_path in attachments:
        with open(attachment_path, 'rb') as f:
            file_content = base64.b64encode(f.read()).decode('utf-8')

        message["message"]["attachments"].append({
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": os.path.basename(attachment_path),
            "contentType": "application/pdf",
            "contentBytes": file_content
        })

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    response = requests.post(url, headers=headers, json=message)
    response.raise_for_status()

    return response.status_code == 202  # Accepted
```

### Key Email Features

1. **HTML Formatting** - Professional, branded email templates
2. **Multiple Recipients** - Semicolon-separated email list
3. **PDF Attachments** - Automatically attach generated reports
4. **BCC Support** - Copy management/audit addresses
5. **Error Handling** - Graceful failure with user notification
6. **Audit Logging** - Track all email sending activities

## Production Considerations: Performance, Security, and Error Handling

### Performance Optimization

**1. Access Token Caching**

Avoid acquiring a new token for every request. Cache and reuse tokens until expiration:

```python
# Token cache with expiration check
token_cache = {"token": None, "expires_at": 0}

def get_cached_access_token():
    """Get access token with caching to reduce auth overhead."""
    import time

    current_time = time.time()

    if token_cache["token"] and current_time < token_cache["expires_at"]:
        return token_cache["token"]

    # Token expired or doesn't exist, acquire new one
    token = get_access_token_API_Access_AAD()

    # Cache for 50 minutes (tokens typically valid for 60 minutes)
    token_cache["token"] = token
    token_cache["expires_at"] = current_time + (50 * 60)

    return token
```

**2. Session Management Best Practices**

Always close workbook sessions to free server resources:

```python
def safe_workbook_operation(workbook_base, operation_func):
    """Execute workbook operation with guaranteed session cleanup."""
    token = get_cached_access_token()
    session_id = None

    try:
        session_id = create_workbook_session(token, workbook_base)
        result = operation_func(token, session_id)
        return result

    finally:
        if session_id:
            try:
                close_workbook_session(token, session_id, workbook_base)
            except Exception as e:
                logger.warning(f"Failed to close session {session_id}: {e}")
```

**3. Batch Updates for Large Datasets**

When updating many cells, batch operations reduce API calls:

```python
def batch_update_cells(token, session_id, worksheet, updates):
    """
    Update multiple cells in a single API call.

    updates = [
        {"cell": "A1", "value": 100},
        {"cell": "B1", "value": 200},
        ...
    ]
    """
    # Determine the range that encompasses all cells
    # Then update the entire range in one call
    url = f"{WORKBOOK_BASE}/worksheets('{worksheet}')/range(address='A1:Z100')"

    # Build 2D array for bulk update
    # ... implementation details

    r = requests.patch(url, headers=workbook_headers(token, session_id), json=body)
    r.raise_for_status()
```

**4. File Cleanup Strategy**

Prevent disk space issues with automatic cleanup:

```python
import time
import os

def cleanup_old_files(directory, max_age_days=2):
    """Remove files older than max_age_days."""
    now = time.time()
    cutoff = now - (max_age_days * 24 * 60 * 60)

    for fname in os.listdir(directory):
        fpath = os.path.join(directory, fname)

        if fname == 'logo.png':  # Preserve static assets
            continue

        try:
            if os.path.isfile(fpath):
                mtime = os.path.getmtime(fpath)
                if mtime < cutoff:
                    os.remove(fpath)
                    logger.info(f"🧹 Deleted old file: {fpath}")
        except Exception as e:
            logger.warning(f"⚠️  Error deleting file {fpath}: {e}")
```

---

### Security Considerations

**1. Certificate-Based Authentication**

Use certificate authentication (not client secrets) for production:

- **Certificates expire** - Implement rotation strategy
- **Store securely** - Azure Key Vault or encrypted file system
- **Monitor expiration** - Alert 30 days before expiry

**2. Least-Privilege Permissions**

Grant only necessary permissions:

```python
# Required Application Permissions (not Delegated)
REQUIRED_PERMISSIONS = [
    "Files.ReadWrite.All",  # Read/write files
    "Sites.ReadWrite.All"   # Access SharePoint sites
]

# DO NOT grant broader permissions like:
# - Files.ReadWrite.All with Delegated (allows user impersonation)
# - Sites.FullControl.All (excessive)
```

**3. Input Validation**

Always validate user input before injecting into Excel:

```python
def validate_pump_selection(pump_name, diameter):
    """Validate user input to prevent injection attacks."""

    # Whitelist approach
    ALLOWED_PUMPS = ["Model-5000 HF", "Kerr EF5", "SPM WS335", ...]
    ALLOWED_DIAMETERS = [3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5]

    if pump_name not in ALLOWED_PUMPS:
        raise ValueError(f"Invalid pump name: {pump_name}")

    if float(diameter) not in ALLOWED_DIAMETERS:
        raise ValueError(f"Invalid diameter: {diameter}")

    # Prevent formula injection
    dangerous_chars = ['=', '+', '-', '@']
    if any(char in str(pump_name) for char in dangerous_chars):
        raise ValueError("Input contains forbidden characters")

    return True
```

**4. Audit Logging**

Log all operations for compliance and debugging:

```python
def audit_log(user, action, resource, status, details=""):
    """Log security-relevant actions."""
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "user": user,
        "action": action,  # e.g., "EXCEL_UPDATE", "PDF_GENERATE"
        "resource": resource,  # e.g., "PumpComparison.xlsx"
        "status": status,  # "SUCCESS" or "FAILURE"
        "details": details,
        "ip_address": request.remote_addr if request else "N/A"
    }

    logger.info(f"AUDIT: {json.dumps(log_entry)}")
```

---

### Error Handling and Resilience

**1. Retry Logic for Transient Failures**

Graph API calls can fail due to network issues or throttling:

```python
import time
from requests.exceptions import RequestException

def call_with_retry(func, max_retries=3, backoff_factor=2):
    """Execute function with exponential backoff retry."""
    for attempt in range(max_retries):
        try:
            return func()
        except RequestException as e:
            if attempt == max_retries - 1:
                raise  # Last attempt failed

            wait_time = backoff_factor ** attempt
            logger.warning(f"Attempt {attempt + 1} failed: {e}. Retrying in {wait_time}s...")
            time.sleep(wait_time)

# Usage
def safe_update_cell(token, session_id, worksheet, cell, value):
    def update_op():
        return update_cell(token, session_id, worksheet, cell, value)

    return call_with_retry(update_op)
```

**2. Graceful Degradation**

Handle missing charts or worksheets without crashing:

```python
def extract_charts_safe(token, session_id, workbook_base, worksheet_name):
    """Extract charts with graceful failure handling."""
    chart_files = []

    try:
        charts = list_charts(token, session_id, workbook_base, worksheet_name)

        if not charts:
            logger.info(f"No charts found on '{worksheet_name}' - continuing")
            return chart_files

        for chart in charts:
            try:
                img_bytes = get_chart_image(token, session_id, workbook_base, worksheet_name, chart["name"])
                # Save chart...
                chart_files.append(file_path)

            except Exception as e:
                logger.error(f"Failed to extract chart '{chart['name']}': {e}")
                # Continue processing other charts

    except Exception as e:
        logger.error(f"Failed to list charts on '{worksheet_name}': {e}")

    return chart_files
```

**3. Global Exception Handler**

Centralized exception handling for Flask:

```python
@app.errorhandler(Exception)
def handle_exception(e):
    """Global exception handler for all routes."""
    logger.error(f"Unhandled exception: {e}", exc_info=True)

    # Don't expose internal errors to users
    return render_template_string(
        get_error_template(),
        error_message="An unexpected error occurred. Please try again later."
    ), 500
```

**4. Session Timeout Handling**

Detect and recover from expired sessions:

```python
def is_session_expired_error(response):
    """Check if error indicates session expiration."""
    if response.status_code == 404:
        error_msg = response.json().get("error", {}).get("message", "")
        return "session" in error_msg.lower() or "not found" in error_msg.lower()
    return False

def update_cell_with_session_recovery(token, session_id, worksheet, cell, value):
    """Update cell with automatic session recovery."""
    url = f"{WORKBOOK_BASE}/worksheets('{worksheet}')/range(address='{cell}')"
    body = {"values": [[value]]}

    r = requests.patch(url, headers=workbook_headers(token, session_id), json=body)

    if is_session_expired_error(r):
        logger.warning("Session expired, creating new session...")
        new_session_id = create_workbook_session(token, WORKBOOK_BASE)
        r = requests.patch(url, headers=workbook_headers(token, new_session_id), json=body)

    r.raise_for_status()
    return r
```

---

## Limitations and Considerations

- **Macro-Enabled Files:** The Graph API cannot edit `.xlsm` files. Macros are not executed or updated.
- **Security:** All operations require Azure AD authentication and appropriate permissions.
- **Concurrency:** Use workbook sessions to avoid conflicts and ensure changes are saved.

> **Reference:** [Why can't macro-enabled Excel files be edited via Graph API?](https://learn.microsoft.com/en-us/graph/api/resources/excel?view=graph-rest-1.0#limitations)

---

## Conclusion

This article demonstrated a **simple solution to a complex problem**: automating Excel-based business workflows without duplicating logic in code.

### The Power of Separation of Concerns

By leveraging the Microsoft Graph API, you achieve a clean separation:

- **Subject Matter Experts** (engineers, finance teams, clinicians) maintain business logic in Excel—their domain of expertise
- **Developers** build intuitive web interfaces and robust infrastructure
- **End Users** get simple, accessible tools without needing Excel skills

### What We've Built

This production-ready solution includes:

1. **Azure AD Authentication** - Certificate-based, secure access
2. **Excel Data Injection** - REST API calls to update cells programmatically
3. **Automatic Formula Recalculation** - Excel's native engine handles all calculations
4. **Chart Extraction** - Export refreshed charts as PNG images
5. **PDF Report Generation** - Professional reports with ReportLab
6. **Email Automation** - Distribute reports to stakeholders
7. **Flask Web Application** - Responsive UI for desktop, tablet, and mobile
8. **Production Features** - Error handling, retry logic, audit logging, file cleanup

### Why This Approach Wins

| Traditional Approach | Graph API Approach |
|---------------------|-------------------|
| Weeks of development to duplicate Excel formulas | Reuse existing Excel, zero formula duplication |
| Code changes every time formulas change | Business users update Excel, no deployments |
| Requires Excel installation on servers | Cloud-native, works on any OS |
| COM automation, Windows-only | REST API, platform-independent |
| High infrastructure and licensing costs | Free with O365 subscription |

### Real-World Applicability

This architecture applies to any scenario where:

✅ Complex Excel workbooks contain valuable business logic
✅ Subject matter experts (not developers) maintain formulas
✅ Users need web/mobile access instead of native Excel
✅ Formulas change frequently due to business rules or regulations
✅ Reporting and visualization are critical


### Key Technical Takeaways

1. **No Excel Installation Required** - Pure cloud-native solution using Microsoft Graph API
2. **Formula Execution Without Code** - Excel's calculation engine handles VLOOKUPs, nested formulas, charts
3. **Only `.xlsx` Supported** - Macro-enabled files (`.xlsm`) are not editable via Graph API
4. **Session Management Critical** - Always close sessions to free server resources
5. **Input Validation Essential** - Prevent formula injection attacks with whitelist validation
6. **Production-Ready Patterns** - Token caching, retry logic, error handling, audit logging


### The Bottom Line

You don't need to choose between **Excel's flexibility** and **web application accessibility**.
You don't need to duplicate complex business logic in code.
You don't need expensive COM automation or Windows servers.

**The Microsoft Graph API gives you the best of both worlds**: Excel's proven calculation engine + modern web architecture.

The result? **A simple, elegant solution that saves weeks of development time and eliminates ongoing maintenance of duplicated logic.**

---

## Further Reading
- [Microsoft Graph Excel API Overview](https://learn.microsoft.com/en-us/graph/api/resources/excel?view=graph-rest-1.0)
- [Python Requests Library](https://docs.python-requests.org/en/latest/)
- [ReportLab PDF Toolkit](https://www.reportlab.com/dev/docs/)

---
