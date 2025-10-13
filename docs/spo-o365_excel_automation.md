# Programmatically Editing Excel Files on SharePoint Online with Python

## Introduction

Editing Excel files stored on SharePoint Online (SPO) programmatically is a powerful capability for automating business workflows, generating reports, and integrating data from web applications. Unlike traditional methods that rely on Microsoft Excel, COM automation, or macros, the Microsoft Graph API enables direct, secure, and scalable access to Excel workbooks in the cloud—without requiring Excel to be installed or running on the server.

This article demonstrates how to:
- Open and edit an XLSX file stored on SharePoint Online using Python and the Microsoft Graph API
- Inject data into worksheets, triggering automatic updates to formulas, tables, and charts
- Loop through worksheets and extract refreshed charts as image files
- Build a web interface for user input

---

## Authentication and Permissions

> For authentication setup and certificate-based SPN connection, see my previous blog articles:
> - [Certificate Based Authentication](azure-ad-certificate.md)

**Required Permissions for SPN:**
- `Files.ReadWrite.All` (edit/view files)
- `Sites.ReadWrite.All` (access SPO sites)
- `User.Read` (basic profile)
- `offline_access` (refresh tokens)

Once authenticated, you can use the access token to interact with the Excel file on SPO.

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

You can update any cell in the workbook using the Graph API. This triggers recalculation of formulas, tables, and charts automatically. Here is a full example from `common.py` showing how to inject multiple parameters and pump data:

```python
def update_workbook(token, session_id, file_to_process):
    # ...load JSON data...
    global_params = ['jobPressure', 'driverPower', 'fleetSize', 'pumpUsage', 'engineRPM']
    for param in global_params:
        if param in data:
            param_data = data[param]
            value = param_data['value']
            worksheet = param_data['worksheet']
            cell = param_data['cell']
            update_cell(token, session_id, worksheet, cell, value)

    # Process pumps array
    if 'pumps' in data:
        for idx, pump in enumerate(data['pumps']):
            # Update pump name
            name_data = pump['name']
            update_cell(token, session_id, name_data['worksheet'], name_data['cell'], name_data['value'])
            # Update pump diameter
            diameter_data = pump['diameter']
            update_cell(token, session_id, diameter_data['worksheet'], diameter_data['cell'], diameter_data['value'])
```

**Key Points:**
- You do not need to open Excel or use macros.
- All formulas, VLOOKUPs, and charts update automatically after cell edits.
- Only `.xlsx` files are supported; macro-enabled files (`.xlsm`) are not editable via Graph API.

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

## Visualizing Results: Generating PDFs with Refreshed Charts

After updating the Excel file and extracting charts, you can use ReportLab to generate visually appealing PDF reports. The code in `common.py` demonstrates how to:
- Render worksheet data as tables
- Insert chart images
- Format and style the PDF output

**Example: PDF Generation**

```python
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet

doc = SimpleDocTemplate(
    OUTPUT_PDF,
    pagesize=landscape(letter),
    leftMargin=6,
    rightMargin=6,
    topMargin=6,
    bottomMargin=6
)
elements = []
styles = getSampleStyleSheet()
# Add worksheet data as table, add charts as images
# ...see common.py for full implementation...
```

---

## Limitations and Considerations

- **Macro-Enabled Files:** The Graph API cannot edit `.xlsm` files. Macros are not executed or updated.
- **Security:** All operations require Azure AD authentication and appropriate permissions.
- **Concurrency:** Use workbook sessions to avoid conflicts and ensure changes are saved.

> **Reference:** [Why can't macro-enabled Excel files be edited via Graph API?](https://learn.microsoft.com/en-us/graph/api/resources/excel?view=graph-rest-1.0#limitations)

---

## Conclusion

By leveraging the Microsoft Graph API, you can automate Excel file editing and reporting on SharePoint Online—without relying on Excel, COM automation, or macros. This approach is secure, scalable, and works across platforms.

**Key Takeaways:**
- Use Graph API for direct, cloud-native Excel automation
- Only `.xlsx` files are supported (no macros)
- All formulas, tables, and charts update automatically
- Extract charts as images for reporting
- Integrate with web applications for seamless user input

---

## Further Reading
- [Microsoft Graph Excel API Overview](https://learn.microsoft.com/en-us/graph/api/resources/excel?view=graph-rest-1.0)
- [Python Requests Library](https://docs.python-requests.org/en/latest/)
- [ReportLab PDF Toolkit](https://www.reportlab.com/dev/docs/)

---
