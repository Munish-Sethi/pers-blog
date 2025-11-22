# Secure, On-Premises Data Analysis with LLM and a Custom MCP Server
## Part 1: CSV/Parquet files 

### 📚 **Series Navigation**
- **Part 1: CSV/Parquet files** *(Current)*
- [Part 2: CSV/Parquet & Database](ai-claude-mcp-analytic-server-part2.md)
- [Part 3: HTTPS-Based MCP Server with Azure OAuth](ai-claude-mcp-analytic-server-part3.md)
- [Part 4: Debugging MCP Servers (Https) with VS Code](ai-claude-mcp-analytic-server-part4.md)

*Inspired by and adapted from [mcp-analyst](https://github.com/unravel-team/mcp-analyst). This guide documents a customized, production-ready approach for secure, LLM-powered analytics on enterprise CSV/Parquet data, including new tools and deployment strategies for real-world business needs.*

## Introduction

Many organizations accumulate large numbers of CSV and Parquet files—sometimes related, sometimes not. These files are often daily or periodic extracts from a variety of systems, created for business leaders (like the CIO) who need insights but lack the time or tools to analyze them manually. For example, you might have daily extracts of:

- Office 365 license assignments
- OneDrive storage usage
- Account properties (e.g., password last set, last login)
- Device inventories from Entra ID
- HR or SAP exports
- And much more

While these files can be loaded into Excel for pivots or imported into a database, this process is time-consuming and often impractical for busy executives. This solution enables natural language queries directly on your CSV/Parquet files—no manual analysis or report building required.

**This guide shows how to empower business users to analyze all their data, securely, using a local MCP (Model Context Protocol) server and Claude Desktop.**

---

## Full Code: `src/analyst.py` (with Customizations)

The following code is based on [mcp-analyst](https://github.com/unravel-team/mcp-analyst) but has been extended for real-world enterprise use. Notably, it adds the `get_data_catalog` tool for rich business context, SAP CSV delimiter handling, and is designed for packaging as a Windows executable.

Below is the complete, up-to-date code for the MCP server. This code exposes tools for file listing, schema discovery, business context, and SQL query execution. It uses the high-performance Polars library for data processing and is ready for packaging as a Windows executable for easy deployment.

```python
import argparse
from typing import List, Dict, Any, Optional
from pydantic import Field
from mcp.server.fastmcp import FastMCP
from glob import glob
import polars as pl
import json
import os

parser = argparse.ArgumentParser()
parser.add_argument("--file_location", type=str, default="data/*.csv")
args = parser.parse_args()

mcp = FastMCP("analyst", dependencies=["polars"])

@mcp.tool()
def get_files_list() -> str:
    """
    Get the list of files that are source of data
    """
    files_list = glob(args.file_location)
    return "\n".join(files_list)

@mcp.tool()
def get_data_catalog() -> str:
    """
    Get the data catalog with descriptions of all available datasets.
    
    Use this tool to understand:
    - What each CSV file contains and its business purpose
    - Column meanings, data types, and business rules
    - Data relationships and join keys between files
    - Common query patterns and best practices
    
    This catalog provides business context. Always combine with get_schema() 
    to see the actual current columns in each file.
    
    DATA CATALOG STRUCTURE:
    The data_catalog.json file follows this schema:
    
    {
      "version": "X.X",                    // Catalog version number
      "last_updated": "YYYY-MM-DD",        // Last modification date
      "datasets": {
        "dataset_key": {                   // Lowercase key (not filename)
          "filename": "Actual_File.csv",   // Real filename (case-sensitive)
          "category": "Category_Name",     // From categories section
          "description": "...",            // Business purpose
          "source_system": "...",          // Origin system(s)
          "delimiter": "," or ";",         // CSV delimiter
          "update_frequency": "...",       // Optional: refresh schedule
          
          "columns": {                     // Column documentation
            "_note": "...",                // ALWAYS start with _note explaining schema approach
            
            // Then document ONLY the important/non-obvious columns:
            "critical_column_name": {
              "description": "...",        // What this column means
              "data_type": "...",          // string|integer|boolean|date
              "required": true|false,      // Is it always populated?
              "importance": "CRITICAL",    // Mark important columns
              "possible_values": [...],    // Optional: enum values
              "constant_value": "...",     // Optional: if always same
              "format": "...",             // Optional: date formats etc
              "usage_note": "...",         // Optional: how to use it
              "source": "..."              // Optional: for prefixed columns (adds_, entra_, etc.)
            }
            // Leave out self-descriptive columns - LLM will discover via get_schema()
          },
          
          "business_rules": [...],         // Important constraints
          "common_queries": [...],         // Example questions
          "device_types_included": [...],  // Optional: for inventories
          
          "joins": {                       // Optional: join definitions
            "join_name": {
              "target_dataset": "...",
              "join_condition": "...",
              "description": "..."
            }
          },
          
          "related_datasets": [...],       // Related file keys
          "usage_tip": "...",              // Consumption guidance
          "comparison_note": "..."         // Optional: vs other files
        }
      },
      
      "categories": {                      // Category definitions
        "Category_Name": {
          "description": "..."
        }
      }
    }
    
    IMPORTANT CONVENTIONS:
    - Dataset keys are lowercase with underscores (e.g., "idp_hr")
    - Filenames preserve original casing (e.g., "IDP_HR.csv")
    - **Columns section philosophy**: Document only important/non-obvious columns
      * ALWAYS start with "_note" explaining the schema approach
      * Document critical columns (joins, filters, business rules)
      * Skip self-descriptive columns - LLM discovers them via get_schema()
      * This reduces maintenance and focuses LLM attention on what matters
    - Always include "usage_tip" directing users to call get_schema()
    - Column prefixes (adds_, entra_, hr_) indicate source systems
    - "importance": "CRITICAL" marks key columns for joins/filters
    - Delimiter usually "," but ";" for SAP files (sap_* prefix)
    
    Returns comprehensive documentation for all datasets in JSON format.
    """
    
    # Use the same directory logic as the CSV files
    file_pattern = args.file_location
    data_dir = os.path.dirname(file_pattern)
    catalog_path = os.path.join(data_dir, "data_catalog.json")
    
    if os.path.exists(catalog_path):
        with open(catalog_path, 'r', encoding='utf-8') as f:
            catalog = json.load(f)
        return json.dumps(catalog, indent=2)
    else:
        return json.dumps({
            "error": "Data catalog not found",
            "path_checked": catalog_path,
            "note": "Ensure data_catalog.json is in the same folder as CSV files",
            "schema_help": "See get_data_catalog() docstring for data_catalog.json structure"
        })

        return pl.concat(dfs)
    elif file_type == "parquet":
        dfs = pl.read_parquet(file_locations)
        return dfs
    else:
        raise ValueError(f"Unsupported file type: {file_type}")

@mcp.tool()
def get_schema(
    file_location: str,
    file_type: str = Field(
        description="The type of the file to be read. Supported types are csv and parquet",
        default="csv",
    ),
) -> List[Dict[str, Any]]:
    """
    Get the schema of a single data file from the given file location
    """
    df = read_file(file_location, file_type)
    schema = df.schema
    schema_dict = {}
    for key, value in schema.items():
        schema_dict[key] = str(value)
    return [schema_dict]

# ... (Polars SQL function lists omitted for brevity)

@mcp.tool()
def execute_polars_sql(
    file_locations: List[str],
    query: str = Field(
        description="The polars sql query to be executed.",
    ),
    file_type: str = Field(
        description="The type of the file to be read. Supported types are csv and parquet",
        default="csv",
    ),
) -> List[Dict[str, Any]]:
    """
    Reads the data from the given file locations. Executes the given polars sql query and returns the result.
    """
    df = read_file_list(file_locations, file_type)
    op_df = df.sql(query)
    output_records = op_df.to_dicts()
    return output_records

def main():
    mcp.run()

if __name__ == "__main__":
    main()
```

---

## Code Walkthrough

### 1. File Listing (`get_files_list`)

Lists all available CSV/Parquet files for the LLM to consider. Only files in the specified directory are accessible.

---

### 2. Data Catalog (`get_data_catalog`)

**This is the most important customization in this solution.**

- **Purpose:** Supplies the LLM with business context, column definitions, relationships, and usage tips for each dataset, as defined in `data/data_catalog.json`.
- **How it works:**
    - The tool reads the JSON catalog and returns it as a string.
    - The catalog documents not just columns, but also business rules, join keys, and common queries.
    - This enables the LLM to:
        - Understand which columns are critical for joins or filters
        - Know which datasets are related (e.g., HR and IDP)
        - Avoid common mistakes (e.g., duplicate records, wrong filters)
        - Provide more accurate, context-aware answers
- **Why not just use `get_schema`?**
    - `get_schema` only shows column names and types. It cannot explain business meaning, relationships, or best practices.
    - The catalog is especially valuable for large, complex datasets and when onboarding new users or LLMs.
- **Security:** Only metadata is exposed, not actual data.

---

### 3. Schema Discovery (`get_schema`)

Lets the LLM see the actual columns and types in each file. Handles files with millions of rows efficiently using Polars.

---

### 4. Data Reading (SAP Exception)

SAP systems often export CSVs with `;` instead of `,`—this logic ensures correct parsing for SAP files.

---

### 5. SQL Query Execution (`execute_polars_sql`)

Executes LLM-generated Polars SQL queries on one or more files. Handles large datasets (millions of rows) with high performance.

---

## Data Catalog Example (`data/data_catalog.json`)

```json
{
  "version": "1.1",
  "last_updated": "2025-10-19",
  "datasets": {
    "idp_hr": {
      "filename": "idp_hr.csv",
      "category": "Identity_Management",
      "description": "Master identity dataset merging ADDS, Entra ID, and HR system attributes...",
      "columns": {
        "_note": "Most columns are self-descriptive with prefixes indicating source system (adds_, entra_, hr_, onedrive_). Critical columns documented below.",
        "entra_id": {
          "description": "Entra user GUID. JOIN KEY from entra_user_devices.csv (user_id column).",
          "data_type": "string",
          "importance": "CRITICAL - Primary key for joins"
        }
      },
      "business_rules": [
        "One row per person - all ADDS, Entra, and HR attributes merged"
      ],
      "common_queries": [
        "Users in ADDS but not Entra (source_adds_entra = 'adds')"
      ],
      "usage_tip": "This is the PRIMARY user lookup table. Use column prefixes to understand data source. Use get_schema() to explore all columns."
    }
  }
}
```

---

## Security and Privacy
- **Data never leaves the network:** All computation happens locally; only query results are sent to the user.
- **No cloud LLM risk:** Unlike SaaS analytics or cloud LLMs, your sensitive data is never uploaded.
- **Fine-grained access:** Only files in the specified directory are accessible.

---


## Deployment and Usage: Packaging as a Windows Executable

One of the key requirements for enterprise adoption is **zero Python installation on user PCs**. To achieve this:

1. **Package the MCP server as a single Windows executable** using PyInstaller:
        ```sh
        pyinstaller --onefile --name cio-mcp_server src\analyst.py
        ```
        - This bundles Python, all dependencies, and your code into a single `.exe` file.
        - No Python, pip, or library installs are needed on the user's machine.
2. **Deploy the executable and all CSV/Parquet files (plus `data_catalog.json`) on a secure server share.**
3. **Users only need Claude Desktop and access to the server share.**
4. **Configure Claude Desktop to use the MCP server executable as a local tool.**
5. **All computation and data access remain on-premises.**

---


## Lessons Learned and Best Practices

- **LLMs can often infer schema, but the data catalog is essential for complex, cross-file queries and business logic.**
- **Polars handled millions of rows with ease**—far better than Excel or Power BI for ad hoc queries.
- **SAP CSV delimiter handling is critical:** Many SAP exports use `;` instead of `,`. This is handled automatically in the code.
- **Even with well-defined semantic models, neither Power BI's LLM tools nor Fabric matched the flexibility and accuracy of this approach.**
- **Business users can answer their own questions—no more waiting for IT to build new reports.**
- **Security:** No data leaves the network. Only query results are returned to the user.

---


## Conclusion

By combining a local MCP server (customized from [mcp-analyst](https://github.com/unravel-team/mcp-analyst)), Claude Desktop, and a well-maintained data catalog, you can deliver secure, flexible, and powerful analytics on enterprise CSV/Parquet data. Business users can ask any question, across any dataset, without moving data or waiting for IT. The addition of the `get_data_catalog` tool is a game-changer for context-aware analytics, enabling the LLM to reason about business logic, relationships, and best practices.

---

## References and Credits

- [mcp-analyst GitHub repository](https://github.com/unravel-team/mcp-analyst) — Original codebase and inspiration for this solution.
- [Polars DataFrame library](https://pola.rs/) — High-performance data processing in Python.
- [Claude Desktop](https://claude.ai/) — LLM client for natural language analytics.
- [PyInstaller](https://pyinstaller.org/) — For packaging Python code as a Windows executable.

*For more details, see the full code in `src/analyst.py` and the data catalog in `data/data_catalog.json`.*
