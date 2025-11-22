# Secure, On-Premises Data Analysis with LLM and a Custom MCP Server
## Part 2: CSV/Parquet & Database 

### 📚 **Series Navigation**
- [Part 1: CSV/Parquet](ai-claude-mcp-analytic-server-part1.md)
- **Part 2: CSV/Parquet & Database** *(Current)*
- [Part 3: HTTPS-Based MCP Server with Azure OAuth](ai-claude-mcp-analytic-server-part3.md)
- [Part 4: Debugging MCP Servers (Https) with VS Code](ai-claude-mcp-analytic-server-part4.md)


*This is Part 2 of the series. Part 1 focused on CSV/Parquet file analytics. Here, we extend the solution to support hybrid queries across both files and SQL Server databases, enabling even richer business intelligence and operational reporting.*

## Introduction

As organizations mature, data is increasingly distributed across both flat files (CSV, Parquet) and enterprise databases (SQL Server). Business leaders need answers from all these sources—sometimes in combination. This article shows how to extend your MCP server to support:

- Hybrid queries across CSV/Parquet files and SQL Server databases
- Dynamic connection management and authentication
- Catalog-driven tool selection for each dataset
- Unified schema discovery and query execution

**This guide demonstrates how to empower users to query both files and databases using natural language, with all data remaining on-premises.**

---

## Solution Architecture: Hybrid Data Access

1. **MCP server** now supports both file and database sources, with connection info and catalog-driven logic.
2. **Claude Desktop** interacts with the MCP server, automatically selecting the right tool for each dataset.
3. **User asks questions** (e.g., "Show me terminated employees from HR database and their device inventory from CSV files").
4. **MCP server tools** provide file lists, database table lists, schema, and business context.
5. **LLM generates Polars SQL or T-SQL queries** based on the source type.
6. **MCP server executes the query** on the correct source(s), returning results to the user.

---

## The Role of the Data Catalog JSON

The `data/data_catalog.json` file is the key to business context and technical guidance for the LLM. It:
- Lists all available datasets, with a `source_type` field (`file` or `database`)
- Provides business descriptions, columns, rules, and relationships
- Tells the LLM which tool to use for each dataset

### Example: File-based Dataset
```json
"accounts_to_be_deleted": {
  "source_type": "file",
  "filename": "accounts_to_be_deleted.csv",
  "category": "IT_Operations",
  "description": "Active Directory accounts eligible for deletion. Contains employees terminated more than 90 days ago.",
  "common_queries": ["How many accounts are pending deletion?", "Accounts terminated in a specific date range"],
  "related_datasets": ["identity_master"],
  "usage_tip": "Use get_schema() to see all columns."
}
```
- LLM sees `source_type: file` and knows to use `execute_polars_sql()`
- Query example: `SELECT COUNT(*) FROM self WHERE hr_TerminationDate < '2025-07-01'`

### Example: Database-based Dataset
```json
"adp_employee_daily_snapshot": {
  "source_type": "database",
  "database_schema": "mcp",
  "database_table": "vw_ADP_Employee_Daily_Snapshot",
  "category": "HR_Analytics",
  "description": "Denormalized daily snapshot of HR system data from ADP. This is the same data as hr_data.csv but stored in SQL Server for better performance on large queries.",
  "common_queries": ["Employee tenure calculations using Hire_Date"],
  "related_datasets": ["user_license_assignments"],
  "usage_tip": "Use get_schema_db(schema_name='mcp', table_name='vw_ADP_Employee_Daily_Snapshot') to see all available columns."
}
```
- LLM sees `source_type: database` and knows to use `execute_database_query()`
- Query example: `SELECT COUNT(*) FROM mcp.vw_ADP_Employee_Daily_Snapshot WHERE Position_Status = 'Active'`

---

## Full Code: `src/analyst.py` (Hybrid Version)

Below is the complete code for the MCP server, with detailed explanations for all relevant sections, especially those handling database connectivity and hybrid logic.

```python
from typing import List, Dict, Any, Optional
from pydantic import Field
from mcp.server.fastmcp import FastMCP
from glob import glob
import argparse
import os
import pyodbc
import polars as pl

parser = argparse.ArgumentParser()
parser.add_argument("--file_location", type=str, default="data/*.csv")
parser.add_argument("--sql_server", type=str, default=None,
          help="SQL Server instance (e.g., localhost or server.domain.com)")
parser.add_argument("--sql_database", type=str, default=None,
          help="SQL Server database name")
parser.add_argument("--sql_auth", type=str, default="windows",
          choices=["windows", "sql"],
          help="Authentication type: 'windows' or 'sql'")
parser.add_argument("--sql_username", type=str, default=None,
          help="SQL Server username (only for SQL auth)")
parser.add_argument("--sql_password", type=str, default=None,
          help="SQL Server password (only for SQL auth)")
parser.add_argument("--catalog_path", type=str, default="data/data_catalog.json")
args = parser.parse_args()

mcp = FastMCP("analystwithsql", dependencies=["polars", "pyodbc"])

# Connection management
_connection = None
_connection_string = None

def build_connection_string() -> str:
  """Build SQL Server connection string based on arguments"""
  if not args.sql_server or not args.sql_database:
    return None
  drivers = [
    "ODBC Driver 18 for SQL Server",
    "ODBC Driver 17 for SQL Server",
    "SQL Server Native Client 11.0",
    "SQL Server"
  ]
  available_driver = None
  try:
    installed_drivers = [d for d in pyodbc.drivers()]
    for driver in drivers:
      if driver in installed_drivers:
        available_driver = driver
        break
  except:
    available_driver = "SQL Server"  # Fallback
  if args.sql_auth == "windows":
    conn_str = (
      f"Driver={{{available_driver}}};"
      f"Server={args.sql_server};"
      f"Database={args.sql_database};"
      f"Trusted_Connection=yes;"
    )
  else:
    if not args.sql_username or not args.sql_password:
      return None
    conn_str = (
      f"Driver={{{available_driver}}};"
      f"Server={args.sql_server};"
      f"Database={args.sql_database};"
      f"UID={args.sql_username};"
      f"PWD={args.sql_password};"
    )
  if "ODBC Driver 17" in available_driver or "ODBC Driver 18" in available_driver:
    conn_str += "Encrypt=yes;TrustServerCertificate=yes;"
  return conn_str

def get_db_connection():
  """Get or create database connection with connection pooling"""
  global _connection, _connection_string
  if _connection_string is None:
    _connection_string = build_connection_string()
  if _connection_string is None:
    return None
  try:
    if _connection is not None:
      _connection.cursor().execute("SELECT 1")
  except:
    _connection = None
  if _connection is None:
    _connection = pyodbc.connect(_connection_string)
  return _connection

def is_database_configured() -> bool:
  """Check if database connection is configured"""
  return args.sql_server is not None and args.sql_database is not None

@mcp.tool()
def get_connection_info() -> Dict[str, Any]:
  """
  Get information about configured data sources and connection status.
  """
  info = {
    "file_sources": {
      "enabled": True,
      "pattern": args.file_location,
      "available_files": glob(args.file_location)
    },
    "database_sources": {
      "enabled": is_database_configured(),
      "server": args.sql_server,
      "database": args.sql_database,
      "auth_type": args.sql_auth if is_database_configured() else None
    }
  }
  if is_database_configured():
    try:
      conn = get_db_connection()
      cursor = conn.cursor()
      cursor.execute("SELECT @@VERSION")
      info["database_sources"]["status"] = "connected"
      info["database_sources"]["server_version"] = cursor.fetchone()[0]
    except Exception as e:
      info["database_sources"]["status"] = f"error: {e}"
  return info

@mcp.tool()
def get_data_catalog() -> str:
  """
  Get the comprehensive data catalog with descriptions of all available datasets.
  """
  if os.path.exists(args.catalog_path):
    with open(args.catalog_path, "r") as f:
      return f.read()
  else:
    return "Catalog file not found."

@mcp.tool()
def get_files_list() -> str:
  """
  Get the list of CSV/Parquet files available in the file system.
  """
  files_list = glob(args.file_location)
  if not files_list:
    return "No files found."
  return "\n".join(files_list)

@mcp.tool()
def get_database_tables() -> str:
  """
  Get the list of database tables available in SQL Server.
  """
  if not is_database_configured():
    return "Database not configured."
  try:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE'")
    tables = cursor.fetchall()
    result = []
    for schema, table in tables:
      result.append(f"{schema}.{table}")
    return "\n".join(result)
  except Exception as e:
    return f"Error: {e}"

@mcp.tool()
def get_schema(file_location: str, file_type: str = "csv") -> List[Dict[str, Any]]:
  """
  Get the technical schema of a CSV or Parquet file.
  """
  try:
    df = pl.read_csv(file_location) if file_type == "csv" else pl.read_parquet(file_location)
    return [{col: str(df[col].dtype) for col in df.columns}]
  except Exception as e:
    return [{"error": str(e)}]

@mcp.tool()
def get_schema_db(schema_name: str, table_name: str) -> List[Dict[str, Any]]:
  """
  Get the technical schema of a SQL Server database table.
  """
  if not is_database_configured():
    return [{"error": "Database not configured."}]
  try:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(f"SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?", (schema_name, table_name))
    columns = cursor.fetchall()
    return [{col[0]: {"data_type": col[1], "nullable": col[2]} for col in columns}]
  except Exception as e:
    return [{"error": str(e)}]

@mcp.tool()
def execute_polars_sql(file_locations: List[str], query: str, file_type: str = "csv") -> List[Dict[str, Any]]:
  """
  Execute a Polars SQL query on one or more files.
  """
  # Implementation omitted for brevity
  pass

@mcp.tool()
def execute_database_query(query: str, max_rows: int = 1000) -> List[Dict[str, Any]]:
  """
  Execute a T-SQL query on the configured SQL Server database.
  """
  if not is_database_configured():
    return [{"error": "Database not configured."}]
  try:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(query)
    columns = [desc[0] for desc in cursor.description]
    rows = cursor.fetchmany(max_rows)
    return [dict(zip(columns, row)) for row in rows]
  except Exception as e:
    return [{"error": str(e)}]

def main():
  """Main entry point for the MCP server"""
  mcp.run()

if __name__ == "__main__":
  main()
```

---

## Code Walkthrough: Database Connectivity and Hybrid Logic

### 1. Connection Management
- `build_connection_string()`: Dynamically builds the ODBC connection string for SQL Server, supporting both Windows and SQL authentication.
- `get_db_connection()`: Manages connection pooling and reconnects if needed.
- `is_database_configured()`: Checks if database parameters are set.

### 2. Data Catalog Tool
- `get_data_catalog()`: Returns the full JSON catalog, giving the LLM all business and technical context for every dataset.

### 3. File and Database Listing
- `get_files_list()`: Lists available CSV/Parquet files.
- `get_database_tables()`: Lists available SQL Server tables.

### 4. Schema Discovery
- `get_schema()`: Returns column names and types for files.
- `get_schema_db()`: Returns column names and types for database tables.

### 5. Query Execution
- `execute_polars_sql()`: Executes Polars SQL queries on files (implementation omitted for brevity).
- `execute_database_query()`: Executes T-SQL queries on the database, returning results as dictionaries.

---

## How the LLM Uses Context to Select the Right Tool


The LLM (Claude Desktop or any compatible client) relies on the data catalog JSON to make intelligent decisions about which tool to use for each user query. Here’s how the process works in detail:

### 1. Catalog-Driven Context Discovery
- The LLM first calls the MCP tool `get_data_catalog()`, which returns the full contents of `data/data_catalog.json`.
- This JSON file contains a dictionary of all datasets, each with metadata fields such as:
  - `source_type`: Indicates if the data is in a file (`file`) or a database (`database`).
  - `filename` (for files) or `database_schema`/`database_table` (for databases): Specifies the location or table name.
  - `category`, `description`, `columns`, `business_rules`, `common_queries`, `related_datasets`, and `usage_tip`: Provide business and technical context.

### 2. Context Extraction and Tool Selection
- The LLM parses the catalog to identify which dataset(s) are relevant to the user’s question.
- For each relevant dataset, it checks the `source_type` field:
  - If `source_type` is `file`, the LLM knows to use the `execute_polars_sql()` tool for querying, and can call `get_schema()` for column details.
  - If `source_type` is `database`, the LLM uses the `execute_database_query()` tool, and can call `get_schema_db()` for table schema.
- The LLM also uses other fields:
  - `business_rules` help the LLM understand how to filter or interpret the data (e.g., only include terminated employees older than 90 days).
  - `common_queries` provide examples that guide the LLM in generating correct SQL or Polars SQL syntax.
  - `related_datasets` inform the LLM about possible joins or multi-source queries.

### 3. Example Workflow
Suppose a user asks: "How many accounts are pending deletion?"
- The LLM calls `get_data_catalog()` and finds the `accounts_to_be_deleted` dataset.
- It sees `source_type: file` and `filename: accounts_to_be_deleted.csv`.
- It uses `execute_polars_sql(file_locations=["data/accounts_to_be_deleted.csv"], query="SELECT COUNT(*) FROM self WHERE hr_TerminationDate < '2025-07-01'")`.

For a database example, if the user asks: "How many active employees are in the HR system?"
- The LLM finds the `adp_employee_daily_snapshot` dataset, sees `source_type: database`, and extracts `database_schema: mcp`, `database_table: vw_ADP_Employee_Daily_Snapshot`.
- It uses `execute_database_query(query="SELECT COUNT(*) FROM mcp.vw_ADP_Employee_Daily_Snapshot WHERE Position_Status = 'Active'")`.

### 4. Why This Matters
- The JSON catalog acts as both a business glossary and a technical map, ensuring the LLM never guesses or misuses a tool.
- It enforces correct tool selection, query syntax, and business logic, making analytics reliable and secure.
- The LLM can answer complex questions, join datasets, and respect business rules—all by following the context provided in the catalog.

---

## Security and Privacy
- **All data remains on-premises:** No data leaves your network.
- **Connection info and authentication are managed securely.**
- **Catalog-driven logic prevents accidental data leakage or misuse.**

---

## Deployment and Usage
- Package as a Windows executable using PyInstaller (now includes pyodbc dependency):
  ```sh
  pyinstaller --onefile --name cio-mcp_server src/analyst.py
  ```
- Deploy alongside your data folder and update `data_catalog.json` to include database tables.
- Configure Claude Desktop as in Part 1.

---

## Lessons Learned and Best Practices
- **Hybrid access enables richer analytics and reporting.**
- **Catalog-driven tool selection is critical for reliability and security.**
- **Unified schema discovery simplifies query generation for LLMs.**
- **Connection info tool helps with troubleshooting and onboarding.**

---

## Conclusion

With hybrid file and database support, your MCP server becomes a true enterprise analytics gateway. Business users can ask questions spanning all data sources, with natural language and instant results. This approach future-proofs your analytics stack and empowers users to self-serve securely.

---

## References and Credits
- [mcp-analyst GitHub repository](https://github.com/unravel-team/mcp-analyst) — Original codebase and inspiration for this solution.
- [Polars DataFrame library](https://pola.rs/) — High-performance data processing in Python.
- [Claude Desktop](https://claude.ai/) — LLM client for natural language analytics.
- [PyInstaller](https://pyinstaller.org/) — For packaging Python code as a Windows executable.
- [pyodbc](https://github.com/mkleehammer/pyodbc) — For SQL Server connectivity.

*For more details, see the full code in `src/analyst.py` and the data catalog in `data/data_catalog.json`.*
