# Exposing OneStream Financial Data to an LLM Securely — Live CEO/CFO Analytics via MCP

## Introduction

This article is a standalone extension of the [four-part MCP Analytic Server series](ai-claude-mcp-analytic-server-part1.md). That series covered building a secure MCP server that lets Claude answer natural-language questions against organisational data. This article covers a specific and significant expansion: connecting the MCP server directly to OneStream, exposing live financial cube view data to an LLM so executives can interact with it conversationally.

At GD Energy Products, our CEO and CFO review financial performance regularly. The traditional workflow — opening OneStream dashboards, exporting to Excel, building PowerPoint slides, and sitting in review meetings — adds latency and interpretation overhead at every step. The premise of this project is simple: what if an executive could ask a question directly and get a live answer in seconds, with full drill-down capability, without opening a single dashboard or waiting on a report?

There is a second, less obvious benefit. OneStream contains business-meaningful metadata hierarchies — Customer trees, Product trees, Region trees, Basin trees — built and maintained by the FP&A team directly in OneStream. Our source system (SAP ECC) has flat transactional data. The rollup structures, the groupings, the business logic for how a customer rolls into a region rolls into a total — all of that lives in OneStream. By exposing cube view data via API, the LLM gets those pre-built, business-validated hierarchies automatically. Every row returned includes an `Indent` level (`0` = grand total, `1` = first-level groups, `2+` = sub-levels) so the LLM understands where each number sits in the hierarchy without any additional prompting.

The result is a live, conversational financial analytics interface that a CEO or CFO can use from Claude — connected to production OneStream data, secured via Azure OAuth, with per-user audit logging.

---

## Prerequisites

### 1. Existing MCP Analytic Server

This article builds directly on the GDEP MCP Analytic Server (port 8000, Azure OAuth, FastMCP framework) built in the four-part series. Complete Parts 1–4 before proceeding:

- [Part 1 — MCP Server with CSV/Parquet (stdio)](ai-claude-mcp-analytic-server-part1.md)
- [Part 2 — MCP Server with Database (stdio)](ai-claude-mcp-analytic-server-part2.md)
- [Part 3 — MCP Server with Files/Database (HTTPS)](ai-claude-mcp-analytic-server-part3.md)
- [Part 4 — Debugging MCP Servers (HTTPS) with VS Code](ai-claude-mcp-analytic-server-part4.md)

### 2. OneStream Access

- OneStream tenant with REST API enabled (`api-version=5.2.0`)
- Administrative access to create Security Groups, Users, and Cube Views in OneStream Designer
- Access to the COPA cube

### 3. Azure Key Vault

- An existing Azure Key Vault reachable from the MCP server (already in use from the series)
- Permissions to add new secrets

### 4. Python Environment

The MCP server already has these from the series. Verify they are present in `requirements.txt`:

```
requests
azure-keyvault-secrets
azure-identity
fastmcp
```


---

## Architecture Overview

The solution builds on the existing GDEP MCP Analytic Server. The MCP server acts as a secure intermediary between Claude and OneStream. **Claude never calls OneStream directly** — it calls MCP tools, which authenticate to OneStream using a service account Personal Access Token (PAT) stored in Azure Key Vault, execute cube view queries, and return structured results.

```
Claude (Teams) → Azure OAuth → MCP Server (port 8000, FastMCP)
                                      ↓
                               Azure Key Vault (PAT retrieval)
                                      ↓
                               OneStream REST API (DataProvider)
                                      ↓
                            MCP_API_Views Cube View Group
                               (12 purpose-built views)
```

**Key design decisions made upfront:**

- **Entity** is always hardcoded to `GDEP_Cons` (consolidated group). This is a CEO/CFO tool — no plant-level drill-down via MCP.
- **Currency** is always USD.
- The PAT is fetched from Azure Key Vault **on every call** so a rotated PAT is picked up instantly without restarting the server.
- Access is controlled via the existing `dbo.mcp_user_permissions` table with a new `object_name` per subject area (`os_copa_sales`).
- Port 8001 (the internal helpdesk server) has **zero access** to financial tools — hard-blocked in code regardless of any configuration.

---

## Step 1: OneStream Setup

### Creating a Non-SSO Service Account

The OneStream REST API requires a dedicated service account that authenticates with a username and password — not SSO. In OneStream, navigate to **System > Security > Users** and create a new user (we named ours `YourOSApiUser`). This user must be a **Standard** user, not an SSO user. SSO users cannot generate Personal Access Tokens.

### Assigning the Security Role

The service account needs read access to the cubes and cube views it will query. In OneStream:

1. Create a **Security Group** (we named ours `API Access`) with read-only access to the relevant cubes (in our case the COPA cube).
2. Assign this group to the service account.
3. When you create custom cube views for API use (covered below), assign those views to this security group so only the API user can see them — keeping your standard dashboard views clean and uncluttered.

### Generating a Personal Access Token

1. Log into OneStream as the service account (`YourOSApiUser`).
2. Navigate to the user profile menu (top right) > **Security > Personal Access Tokens**.
3. Generate a new PAT and copy the value immediately — you will not be able to retrieve it again.
4. Store this value in Azure Key Vault as secret `os-api-pat`.
5. Also store the application name (e.g. `OneStream Production`) as secret `os-application`.

The PAT serves as a Bearer token for all API calls. OneStream's REST API technically supports a 3-step auth flow (PAT → Logon → OpenApplication) but for the DataProvider endpoints (cube view queries and SQL queries), the PAT Bearer token alone is sufficient. You do not need to exchange it for a session token. This simplifies the MCP server code significantly.

---

## Step 2: Understanding the OneStream REST API

OneStream exposes two relevant endpoints for this use case.

### Cube View Endpoint

Executes a named cube view and returns its data as a JSON dataset:

```http
POST /Onestreamapi/api/DataProvider/GetAdoDataSetForCubeViewCommand?api-version=5.2.0
Authorization: Bearer <PAT>
Content-Type: application/json
```

```json
{
  "BaseWebServerUrl": "https://<tenant>.onestreamcloud.com/onestreamweb",
  "ApplicationName": "OneStream Production",
  "CubeViewName": "<view_name>",
  "DataTablePerCubeViewRow": false,
  "ResultDataTableName": "R",
  "CustomSubstVarsAsCommaSeparatedPairs": "<substitution_vars>",
  "CubeViewDataTableOptions": {
    "IncludeTitle": false
  }
}
```

The substitution variables string passes runtime parameters to the view:

```
GDParam_Entity=[GDEP_Cons],GDParam_Scenario=[COPA],GDParam_Time_Reports=[2026M4],GDParam_Year=[2026]
```

Time periods use OneStream's internal format: `2026M4` = April 2026, `2026M12` = December 2026.

### SQL Endpoint

Executes a SQL query against OneStream's internal metadata tables — useful for discovering cube view definitions, member names, and account codes:

```http
POST /Onestreamapi/api/DataProvider/GetAdoDataSetForSqlCommand?api-version=5.2.0
```

This endpoint was invaluable during development for discovering the correct account member names in the COPA cube. See the example query in Step 3 below.

---

## Step 3: Designing the COPA Sales Cube Views

### The First Major Pitfall: Existing Dashboard Views Are Not Callable

The natural first instinct is to call the existing cube views that power the OneStream dashboards. The Sales/Orders/Backlog dashboard has views like `CV_Left_Customer`, `CV1_CustomerTree_Sales_X`, and so on. We tried this — all returned 0 rows.

The reason is architectural. These dashboard views are **shell views** that use row sharing and column sharing from other dashboard-context views. `CV_Left_Customer` has no data of its own — its rows come from `CV1_CustomerTree_|!Param_SOB!|_X` (a dashboard parameter that switches between Sales, Orders, and Backlog) and its columns come from another context view. These context variables only exist inside the OneStream dashboard engine. Via the REST API there is no dashboard session, so these variables never resolve and the view returns nothing.

**The solution:** create purpose-built cube views specifically for API consumption. These views are self-contained, use only substitution variables that can be passed via API, and are stored in a dedicated group visible only to the API service account.

In OneStream Designer, create a new **Cube View Group** called `MCP_API_Views` and set both the Access Group and Maintenance Group to your `API Access` security group. This keeps the views invisible to regular dashboard users and clearly separated from operational views.

### Discovering Account Member Names

Before designing any view, use the SQL endpoint to discover the correct account member names in the COPA cube:

```sql
SELECT Name, Description, DimId
FROM Member
WHERE Description LIKE '%Margin%'
   OR Description LIKE '%Quantity%'
```

This returned `F42099` (Quantity Average), `F55099` (Std Margin) — allowing us to verify the exact codes before building the views.

### COPA Sales View: Point of View Tab

Walk-through for `MCP_COPA_ByCustomer` (the representative example — the same pattern applies to all other dimensions):

| Setting | Value |
|---|---|
| Cube | COPA |
| Entity | `\|!GDParam_Entity!|` (default `GDEP_Cons`) |
| Consolidation | USD |
| Scenario | `\|!GDParam_Scenario!|` (default `COPA`) |
| Time | `\|!GDParam_Time_Reports!|` |
| View | Periodic |
| Account | `A45000` (Net Sales) |
| Flow, Origin, IC | Top |
| UD1–UD8 | Top, **except** the dimension used in Rows (must be blank) |

> **Critical rule:** whichever dimension you put in the Rows tab must be left blank in the POV. If you set UD5 (Customer) in both POV and Rows, OneStream returns an error. For `ByCustomer`, set UD5 to blank. For `ByRegion`, set UD7 to blank. And so on.

### COPA Sales View: Columns Tab

We need three groups of columns: Net Sales (YTD by month), Quantity (YTD by month), and Standard Margin % (both YTD and periodic).

> **The naive approach** — adding Account as a row dimension alongside Customer — produces a cross-join that returns blank results when Account is also in the POV. The correct approach is to use OneStream's **multidimensional colon-delimited member filter syntax** to pin the account at the column level.

**Net Sales (COPA_YTD) — Member Expansion 1:**

```
A#A45000:T#|!GDParam_Year!|M1:Name(Sales Jan),
A#A45000:T#|!GDParam_Year!|M2:Name(Sales Feb),
A#A45000:T#|!GDParam_Year!|M3:Name(Sales Mar),
A#A45000:T#|!GDParam_Year!|M4:Name(Sales Apr),
A#A45000:T#|!GDParam_Year!|M5:Name(Sales May),
A#A45000:T#|!GDParam_Year!|M6:Name(Sales Jun),
A#A45000:T#|!GDParam_Year!|M7:Name(Sales Jul),
A#A45000:T#|!GDParam_Year!|M8:Name(Sales Aug),
A#A45000:T#|!GDParam_Year!|M9:Name(Sales Sep),
A#A45000:T#|!GDParam_Year!|M10:Name(Sales Oct),
A#A45000:T#|!GDParam_Year!|M11:Name(Sales Nov),
A#A45000:T#|!GDParam_Year!|M12:Name(Sales Dec)
```

Nested Member Expansion 2: `V#YTD`

The colon syntax (`A#A45000:T#...`) pins the account to `A45000` for every time member in this column group. The `:Name()` suffix gives each column a unique, readable header that survives the API response — without this, all 12 months across all column groups would be named `Jan 2026`, `Feb 2026` etc. and would collide in the flattened output.

**Quantity (Quantity_YTD):** same structure, replace `A#A45000` with `A#F42099`, prefix column names with `Qty`. Nested: `V#YTD`.

**Standard Margin % YTD (StdMargin_Pct):** replace with `A#F55099`, prefix `Mgn`. Nested: `V#YTD`.

**Standard Margin % Periodic (StdMargin_Periodic):** same account `A#F55099`, prefix `MgnP`. Nested: `V#Periodic`.

> **Why two margin columns?** YTD margin (`Mgn`) is a blended cumulative figure. If a CEO asks "what was our margin in April specifically?" the answer requires the periodic figure, not the YTD. Subtracting YTD March margin from YTD April margin is mathematically invalid — margin percentage is a ratio, not an additive value. We return both and let the LLM use the right one based on the question.

### COPA Sales View: Rows Tab

For `ByCustomer`, add one row:

| Setting | Value |
|---|---|
| Dimension | UD5 |
| Member Filter | `U5#Customer.Tree` |
| Suppress Zero Rows | True |

> **The `.Tree` expansion is critical.** We initially used `.ChildrenInclusive` (too shallow) and `.DescendantsInclusive` (flattened all indent levels to 0). Only `.Tree` returns the full hierarchy with correct indent levels at every level — essential for the LLM to understand rollup structure without double counting.

The result: a single view that returns the full customer hierarchy as rows, with 50 data columns (12 Sales YTD + 12 Qty YTD + 12 Mgn YTD + 12 MgnP Periodic + Label + Indent), validated against the corresponding dashboard grand total.

### All Four Sales Views

Create three additional views following the identical pattern, changing only the row dimension and its POV setting:

| View Name | Row Dimension | POV Setting | Member Filter |
|---|---|---|---|
| `MCP_COPA_ByCustomer` | UD5 | UD5 = blank | `U5#Customer.Tree` |
| `MCP_COPA_ByRegion` | UD7 | UD7 = blank | `U7#Top.Tree` |
| `MCP_COPA_ByProduct` | UD1 | UD1 = blank | `U1#Top.Tree` |
| `MCP_COPA_ByBasin` | UD6 | UD6 = blank | `U6#Top.Tree` |

---

## Step 4: Designing the Orders and Backlog Views

Orders and Backlog require additional discovery work because the account codes are in a different dimension than Net Sales.

We initially tried account `DOrdExt` for Orders. It exists in the Member table but belongs to `DimId=1` (the Finance cube account dimension) — not the COPA cube. The correct accounts for COPA are:

| Subject | Value Account | Quantity Account |
|---|---|---|
| Orders | `OrdExt` | `QtyNetOrd` |
| Backlog | `DBacklog` | `QtyBacklog` |

### Three Key Differences from Sales Views

**1. POV Account must be explicitly set.** For Sales, the POV Account is `A45000`, which anchors the data intersection. For Orders and Backlog, set the POV Account to the subject account (`OrdExt` or `DBacklog`) — not blank and not Top. We discovered this by comparing the working Sales view XML against the non-working Orders view XML side by side.

**2. POV View must be `Periodic`, not `YTD`.** Orders and Backlog data in the COPA cube is stored as periodic monthly values, not cumulative YTD. `V#YTD` returns 0 rows for these accounts.

**3. POV UD2 must be blank.** The existing dashboard Orders views use a plant-level filter via UD2. At the `GDEP_Cons` consolidation level, UD2 must be left blank for consolidated data to flow through.

### Orders Column Structure

Column structure for Orders views is simpler — no margin columns:

```
A#OrdExt:T#|!GDParam_Year!|M1:Name(Ord Jan),...  Nested: V#Periodic
A#QtyNetOrd:T#|!GDParam_Year!|M1:Name(Qty Jan),... Nested: V#Periodic
```

### Complete View Inventory

Create four Orders views and four Backlog views following the same pattern:

| View Name | Data Type | Accounts |
|---|---|---|
| `MCP_COPA_Orders_ByCustomer` | Orders | `OrdExt`, `QtyNetOrd` |
| `MCP_COPA_Orders_ByRegion` | Orders | `OrdExt`, `QtyNetOrd` |
| `MCP_COPA_Orders_ByProduct` | Orders | `OrdExt`, `QtyNetOrd` |
| `MCP_COPA_Orders_ByBasin` | Orders | `OrdExt`, `QtyNetOrd` |
| `MCP_COPA_Backlog_ByCustomer` | Backlog | `DBacklog`, `QtyBacklog` |
| `MCP_COPA_Backlog_ByRegion` | Backlog | `DBacklog`, `QtyBacklog` |
| `MCP_COPA_Backlog_ByProduct` | Backlog | `DBacklog`, `QtyBacklog` |
| `MCP_COPA_Backlog_ByBasin` | Backlog | `DBacklog`, `QtyBacklog` |

**Total: 12 purpose-built cube views in the `MCP_API_Views` group.**

---

## Step 5: Programmatic Validation

Before writing any MCP server code, validate all 12 views using a standalone Python test harness that calls the OneStream API directly. The test script uses the same Azure Key Vault helper as the MCP server to fetch the PAT, calls each view with April 2026 COPA parameters, and checks the grand total (`Indent=0` row).

```python
import requests

def call_cv(pat, app_name, cv_name, subst_vars):
    server = "<your-tenant>.onestreamcloud.com"
    headers = {
        "Authorization": f"Bearer {pat}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    body = {
        "BaseWebServerUrl":                     f"https://{server}/onestreamweb",
        "ApplicationName":                      app_name,
        "CubeViewName":                         cv_name,
        "DataTablePerCubeViewRow":              False,
        "ResultDataTableName":                  "R",
        "CustomSubstVarsAsCommaSeparatedPairs": subst_vars,
        "CubeViewDataTableOptions":             {"IncludeTitle": False}
    }
    r = requests.post(
        f"https://{server}/Onestreamapi/api/DataProvider/GetAdoDataSetForCubeViewCommand",
        headers=headers,
        params={"api-version": "5.2.0"},
        json=body,
        timeout=120
    )
    if r.status_code == 200:
        return r.json().get("R", [])
    raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")

subst = (
    "GDParam_Entity=[GDEP_Cons],"
    "GDParam_Consolidation=[USD],"
    "GDParam_Scenario=[COPA],"
    "GDParam_Time_Reports=[2026M4],"
    "GDParam_Year=[2026]"
)

for view, os_name, col in [
    ("Sales_ByCustomer",   "MCP_COPA_ByCustomer",          "Sales Apr"),
    ("Orders_ByCustomer",  "MCP_COPA_Orders_ByCustomer",   "Ord Apr"),
    ("Backlog_ByCustomer", "MCP_COPA_Backlog_ByCustomer",  "Bkl Apr"),
]:
    rows = call_cv(pat, app_name, os_name, subst)
    # flatten rows and find Indent=0 grand total ...
    print(f"{view}: Grand Total = {total:,.0f}")
```

**Validation results (April 2026):**

```
Sales_ByCustomer:   Grand Total = <your_sales_total>
Orders_ByCustomer:  Grand Total = <your_orders_total>
Backlog_ByCustomer: Grand Total = <your_backlog_total>
```

We then opened the OneStream Sales/Orders/Backlog dashboard set to `Entity=GDEP_Cons`, `Time=Apr 2026`, `Scenario=COPA` and compared:

| Metric | Dashboard | API | Result |
|---|---|---|---|
| Sales YTD total | matches | matches | ✅ Match |
| Orders Periodic April | matches | matches | ✅ Match |
| Backlog Periodic April | matches | matches | ✅ Match |

All 12 views were validated across all 4 dimensions with consistent grand totals. **This dashboard screenshot comparison step is important** — it proves not just that the API returns data, but that it returns the same data a human analyst would see.

---

## Step 6: The MCP Server Code

The MCP server builds on the FastMCP + Azure OAuth foundation from the existing series. The OneStream integration adds helper functions and two new tools.

### Helper Functions

```python
def _os_get_pat() -> str:
    return get_azure_kv_secret("os-api-pat")

def _os_get_app_name() -> str:
    return get_azure_kv_secret("os-application")

def _os_server() -> str:
    return "<your-tenant>.onestreamcloud.com"

def _os_to_period(period: str):
    """'Apr 2026' → ('2026M4', '2026')"""
    dt = datetime.strptime(period, "%b %Y")
    return f"{dt.year}M{dt.month}", str(dt.year)

def _os_call_cv(cv_name: str, subst_vars: str) -> list:
    pat      = _os_get_pat()
    app_name = _os_get_app_name()
    server   = _os_server()
    base_url = f"https://{server}/Onestreamapi/api"
    web_url  = f"https://{server}/onestreamweb"
    headers = {
        "Authorization": f"Bearer {pat}",
        "Content-Type":  "application/json",
        "Accept":        "application/json",
    }
    body = {
        "BaseWebServerUrl":                     web_url,
        "ApplicationName":                      app_name,
        "CubeViewName":                         cv_name,
        "DataTablePerCubeViewRow":              False,
        "ResultDataTableName":                  "R",
        "CustomSubstVarsAsCommaSeparatedPairs": subst_vars,
        "CubeViewDataTableOptions":             {"IncludeTitle": False},
    }
    r = requests.post(
        f"{base_url}/DataProvider/GetAdoDataSetForCubeViewCommand",
        headers=headers,
        params={"api-version": "5.2.0"},
        json=body,
        timeout=120,
        verify=True,
    )
    if r.status_code == 200:
        return r.json().get("R", [])
    raise RuntimeError(f"OneStream API returned HTTP {r.status_code}: {r.text[:300]}")
```

### The Flatten Function

Converts the raw API response (keyed by `ColNHdr0NameAndDesc` and `ColNValue`) into clean dictionaries. The `:Name()` suffixes set in OneStream Designer populate the `Hdr0NameAndDesc` fields, giving distinct column names across all 50 columns:

```python
def _os_flatten(rows: list) -> list:
    if not rows:
        return []
    sample = rows[0]
    col_indices = sorted(set(
        int(k[3:k.index("H")])
        for k in sample
        if k.startswith("Col") and "Hdr0NameAndDesc" in k
    ))
    col_headers = {
        i: (sample.get(f"Col{i}Hdr0NameAndDesc") or f"Col{i}").strip()
        for i in col_indices
    }
    flat = []
    for row in rows:
        rec = {
            "Label":  (row.get("RowHdr0NameAndDesc") or "").strip(),
            "Indent": row.get("RowHdr0Indent", 0),
        }
        for i in col_indices:
            val = row.get(f"Col{i}Value")
            rec[col_headers[i]] = float(val) if val is not None else None
        flat.append(rec)
    return flat
```

> **Do not round values in the flatten function.** The LLM handles formatting — rounding Net Sales to nearest dollar, displaying Margin % as a percentage by multiplying by 100. Early versions of this code rounded everything to the nearest dollar, which silently zeroed out all margin % values (e.g. `0.42` became `0`) — a subtle bug that only surfaced during LLM response testing.

### The View Catalogue

```python
_OS_COPA_VIEWS = {
    "Sales_ByCustomer": {
        "os_view_name": "MCP_COPA_ByCustomer",
        "description":  "COPA Net Sales, Quantity, and Standard Margin % by Customer",
        "dimension":    "Customer (UD5)",
        "data_type":    "Sales",
        "status":       "active",
    },
    "Sales_ByRegion": {
        "os_view_name": "MCP_COPA_ByRegion",
        "description":  "COPA Net Sales, Quantity, and Standard Margin % by Region",
        "dimension":    "Region (UD7)",
        "data_type":    "Sales",
        "status":       "active",
    },
    "Sales_ByProduct": {
        "os_view_name": "MCP_COPA_ByProduct",
        "description":  "COPA Net Sales, Quantity, and Standard Margin % by Product",
        "dimension":    "Product (UD1)",
        "data_type":    "Sales",
        "status":       "active",
    },
    "Sales_ByBasin": {
        "os_view_name": "MCP_COPA_ByBasin",
        "description":  "COPA Net Sales, Quantity, and Standard Margin % by Basin",
        "dimension":    "Basin (UD6)",
        "data_type":    "Sales",
        "status":       "active",
    },
    "Orders_ByCustomer": {
        "os_view_name": "MCP_COPA_Orders_ByCustomer",
        "description":  "COPA Orders and Quantity by Customer — periodic monthly",
        "dimension":    "Customer (UD5)",
        "data_type":    "Orders",
        "status":       "active",
    },
    # Orders_ByRegion, Orders_ByProduct, Orders_ByBasin follow the same pattern
    # Backlog_ByCustomer, Backlog_ByRegion, Backlog_ByProduct, Backlog_ByBasin follow the same pattern
}
```

### The MCP Tools

Two tools are exposed: a catalogue tool (so the LLM always knows what is available) and a data retrieval tool.

```python
@mcp.tool()
def get_os_copa_catalog() -> List[Dict[str, Any]]:
    """
    List available OneStream COPA cube views queryable via get_os_copa_sales().
    Always call this first. Returns view names, descriptions, dimensions, and data types.
    Available: Sales_ByX (4), Orders_ByX (4), Backlog_ByX (4).
    """
    if HELPDESK_MODE:
        return [{"error": "OneStream tools not available on helpdesk server."}]
    if get_current_business_function() != "fin":
        return [{"error": "This tool is only available for the fin business function."}]
    denied = check_hr_fin_access("get_os_copa_catalog", "os_copa_sales")
    if denied:
        return denied
    return [
        {
            "view":        name,
            "description": meta["description"],
            "dimension":   meta["dimension"],
            "data_type":   meta["data_type"],
            "status":      meta["status"],
        }
        for name, meta in _OS_COPA_VIEWS.items()
        if meta["status"] == "active"
    ]
```

```python
@mcp.tool()
def get_os_copa_sales(
    view: str     = Field(description="View name e.g. 'Sales_ByCustomer'. Call get_os_copa_catalog() first."),
    period: str   = Field(description="Period in 'Mon YYYY' format e.g. 'Apr 2026'."),
    scenario: str = Field(default="COPA", description="Scenario: COPA (default), Actual, Budget, Forecast."),
) -> List[Dict[str, Any]]:
    """
    Retrieve COPA data from OneStream for the requested view, period and scenario.
    Sales views: 50 cols (Sales Jan-Dec YTD, Qty Jan-Dec YTD, Mgn Jan-Dec YTD%, MgnP Jan-Dec Periodic%).
    Orders/Backlog views: 26 cols (value Jan-Dec Periodic, Qty Jan-Dec Periodic).
    Indent=0 is always the grand total. Do NOT sum all rows — that double counts.
    """
    if HELPDESK_MODE:
        return [{"error": "OneStream tools not available on helpdesk server."}]
    if get_current_business_function() != "fin":
        return [{"error": "This tool is only available for the fin business function."}]
    denied = check_hr_fin_access("get_os_copa_sales", "os_copa_sales")
    if denied:
        return denied

    if view not in _OS_COPA_VIEWS:
        return [{"error": f"Unknown view '{view}'. Valid: {list(_OS_COPA_VIEWS.keys())}"}]

    try:
        period_os, year = _os_to_period(period)
    except ValueError:
        return [{"error": f"Invalid period '{period}'. Use 'Mon YYYY' e.g. 'Apr 2026'."}]

    scenario = str(scenario).strip() if scenario else "COPA"
    if scenario not in ["COPA", "Actual", "Budget", "Forecast"]:
        return [{"error": f"Invalid scenario '{scenario}'."}]

    cv_name = _OS_COPA_VIEWS[view]["os_view_name"]
    subst = (
        f"GDParam_Entity=[GDEP_Cons],"
        f"GDParam_Consolidation=[USD],"
        f"GDParam_Scenario=[{scenario}],"
        f"GDParam_Time_Reports=[{period_os}],"
        f"GDParam_Year=[{year}]"
    )

    try:
        log_user_activity("get_os_copa_sales", get_current_user_info(),
                          detail=f"{view} {period} {scenario}")
    except Exception:
        pass

    try:
        raw  = _os_call_cv(cv_name, subst)
        flat = _os_flatten(raw)
        return flat
    except Exception as e:
        logger.error(f"get_os_copa_sales error: {e}", exc_info=True)
        return [{"error": f"OneStream API error: {str(e)}"}]
```

---

## Step 7: Security Model

Access to the OneStream tools is controlled at three layers.

**Layer 1 — Business function isolation.** The MCP server routes requests by URL parameter (`?function=fin`). These tools check `get_current_business_function()` and return an error if the caller is not on the `fin` endpoint. An IT or HR user connecting to their respective endpoint cannot reach financial data.

**Layer 2 — Per-subject-area permissions.** The existing `check_hr_fin_access()` function checks `dbo.mcp_user_permissions` for an explicit grant:

```sql
INSERT INTO dbo.mcp_user_permissions
    (user_email, business_function, object_name, granted)
VALUES
    ('user@company.com', 'fin', 'os_copa_sales', 1);
```

The `object_name` `os_copa_sales` covers all 12 COPA views (Sales, Orders, Backlog). Future subject areas (P&L, Cash Flow, Balance Sheet) get their own `object_name`, allowing per-subject-area access control independent of COPA.

**Layer 3 — Helpdesk server hard-block.** The helpdesk server (port 8001, no auth, VNET only) sets `HELPDESK_MODE=True`. Both OS tools check this flag at entry and return an error immediately. This is not a soft check — it is the first line of code in each tool, before any other logic runs.

**Audit logging** writes to a per-user log file (`/mnt/azure/mcp/logs/{email}.log`) on every successful tool call, capturing timestamp, tool name, user name, and query parameters. This gives administrators a complete record of who queried what data and when.

---

## Step 8: LLM Project Instructions

The MCP tools return structured data, but the LLM needs precise instructions to interpret it correctly. This is as important as the server code itself. We use Claude Teams as an organisation with a dedicated **Claude Project** for financial analytics connected via OAuth to the MCP server.

### Key instructions that prevent common LLM mistakes:

**On column structure:**
Sales columns (`Sales Jan` through `Sales Dec`) are YTD cumulative. To derive a specific month's value, subtract the prior month: April Sales = `Sales Apr` minus `Sales Mar`. January is always periodic since there is no prior month. Orders and Backlog columns (`Ord Jan`, `Bkl Jan`) are already periodic monthly figures — read them directly, no subtraction needed.

**On margin percentage:**
`Mgn` columns are decimals between 0 and 1. Always multiply by 100 to display as a percentage (e.g. `0.42` = 42.00%). Never subtract `Mgn` columns to derive periodic margin — it is mathematically invalid. Use `MgnP` columns (periodic margin) for single-month margin questions. Use `Mgn` columns for YTD margin and state this clearly.

**On hierarchy:**
`Indent=0` is always the grand total. Never sum all rows — that double counts because parent rows include their children. Use `Indent=0` for top-line numbers. Use higher indent rows for drill-down.

**On data sourcing:**
All values come directly from OneStream production via live API call. No caching, no stale data, no exports. For questions about specific accounting treatment, refer to the FP&A team.

**On the connector:**
The user must be connected to the GDEP Fin connector to access financial data. If not connected, no data is available.

---

## Troubleshooting and Tips

- **View returns 0 rows (Sales):** Verify `V#YTD` is the nested View dimension. Confirm the POV Account is set to the correct account code and not left blank.
- **View returns 0 rows (Orders/Backlog):** Switch the nested View dimension from `V#YTD` to `V#Periodic`. Orders and Backlog data is stored as periodic only — `V#YTD` returns nothing for these accounts.
- **All dashboard views return 0 rows via API:** Do not reuse dashboard views. Create purpose-built views in `MCP_API_Views` as described in Step 3. Dashboard views use context variables that do not exist outside the dashboard engine.
- **Columns collide or have duplicate headers:** Ensure every column expansion entry uses the `:Name()` suffix with a unique prefix per column group (e.g. `Sales Jan`, `Qty Jan`, `Mgn Jan`, `MgnP Jan`). Without `:Name()`, all 12 months across all column groups share the same month labels and collide in the flattened output.
- **Margin % shows as 0 after flatten:** Do not round in `_os_flatten()`. Margin % values are decimals (e.g. `0.42`). Rounding to the nearest dollar silently zeros them out. Let the LLM format the output.
- **LLM produces doubled totals:** The LLM must be instructed (in the Project instructions) never to sum all rows. Parent rows in the hierarchy already include their children. Only `Indent=0` is the safe grand total.
- **401 Unauthorized from OneStream API:** Check that the PAT in Azure Key Vault is current. The PAT is fetched on every call — rotate it in OneStream, update the secret in Key Vault, and the next call picks it up automatically without a server restart.
- **403 Forbidden from OneStream API:** Verify the service account (`YourOSApiUser`) is a member of the `API Access` security group and that admin consent is current for the cube.

---

## References

- [GDEP MCP Analytic Server — Part 1 (CSV/Parquet, stdio)](ai-claude-mcp-analytic-server-part1.md)
- [GDEP MCP Analytic Server — Part 2 (Database, stdio)](ai-claude-mcp-analytic-server-part2.md)
- [GDEP MCP Analytic Server — Part 3 (Files/Database, HTTPS)](ai-claude-mcp-analytic-server-part3.md)
- [GDEP MCP Analytic Server — Part 4 (Debugging with VS Code)](ai-claude-mcp-analytic-server-part4.md)
- [MCP Analyst — GitHub Repository](https://github.com/Munish-Sethi/enterprise-mcp-analyst)
- [OneStream REST API Documentation](https://developer.onestream.com/)
- [OneStream DataProvider Endpoints — api-version 5.2.0](https://developer.onestream.com/)
- [FastMCP Framework Documentation](https://github.com/jlowin/fastmcp)
- [Azure Key Vault Secrets — Python SDK](https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-python)

---

## Summary

- Create a dedicated **non-SSO service account** in OneStream with a PAT stored in Azure Key Vault — fetched on every MCP call so key rotation requires no server restart
- **Do not reuse dashboard cube views** via the API — they are shell views that rely on dashboard-session context variables that do not exist in REST calls. Build purpose-built views in a dedicated `MCP_API_Views` group
- Use **OneStream's substitution variable system** (`|!GDParam_Entity!|`, `|!GDParam_Time_Reports!|` etc.) to parameterise time and scenario at runtime
- Use the **multidimensional colon-delimited column filter syntax** (`A#A45000:T#2026M1:Name(Sales Jan)`) to return multiple metrics (Sales, Quantity, Margin YTD, Margin Periodic) in a single API call with unique, collision-free column headers
- Use `.Tree` row expansion — not `.ChildrenInclusive` or `.DescendantsInclusive` — to get the full member hierarchy with correct `Indent` levels at every level
- For Orders and Backlog views, set the POV Account explicitly, use `V#Periodic` (not `V#YTD`), and leave UD2 blank at the consolidated level
- **Validate all views programmatically** against the OneStream dashboard before writing MCP server code — confirm grand totals match to the dollar
- Do not round values in `_os_flatten()` — margin % values are decimals; rounding silently zeroes them out
- Apply three-layer security: business function isolation → per-subject-area permissions table → helpdesk server hard-block
- Invest equal effort in the **Claude Project instructions** as in the server code — the LLM's ability to interpret YTD vs periodic, margin % decimals, and hierarchy rollups correctly depends entirely on these instructions
