# Secure, On-Premises Data Analysis with LLM and a Custom MCP Server
## Part 4: Debugging MCP Servers with VS Code and Cloudflare Tunnels

### 📚 **Series Navigation**
- [Part 1: CSV/Parquet files](ai-claude-mcp-analytic-server-part1.md)
- [Part 2: CSV/Parquet & Database](ai-claude-mcp-analytic-server-part2.md)
- [Part 3: HTTPS-Based MCP Server with Azure OAuth](ai-claude-mcp-analytic-server-part3.md)
- **Part 4: Debugging MCP Servers (Https) with VS Code** *(Current)*

---

## Introduction

Debugging MCP servers presents unique challenges compared to traditional applications. MCP servers typically run as background processes or containerized services, making it difficult to attach debuggers, inspect variables, and step through code during development. Additionally, OAuth-based authentication adds another layer of complexity—your MCP server must be accessible via a public HTTPS URL for OAuth callbacks to work, even during local development.

This guide demonstrates a powerful debugging workflow that combines:
- **VS Code's Python debugger** for breakpoints and variable inspection
- **Cloudflare Tunnels** for exposing your local server with a temporary HTTPS URL
- **Dynamic OAuth configuration** to route authentication through your local debug session
- **Claude Desktop integration** to test real-world MCP interactions

**Why this approach matters:**
- Debug production-like OAuth flows locally without deploying to Azure
- Set breakpoints and inspect variables as LLM queries execute in real-time
- Rapidly iterate on tool logic without container rebuilds
- Troubleshoot authentication issues with full request/response visibility
- Test multi-tenant routing and business logic before production deployment

**Prerequisites:**
- VS Code with Python extension and Docker support
- Python 3.9+ with MCP server dependencies
- Azure Entra ID App Registration (from Part 3)
- Claude Desktop (paid tier for HTTPS connectors)
- Docker Desktop (if using containerized development)
- Basic understanding of OAuth 2.0 flows

**Note:** This guide assumes you are comfortable with VS Code and Docker Desktop. We won't cover basic container operations or VS Code setup.

---

## The Debugging Challenge: Why Standard Approaches Don't Work

### Traditional Debugging vs. MCP Server Debugging

**Traditional Python debugging:**
```bash
# Simple CLI application
python my_script.py
# Set breakpoint, run, debug ✓
```

**MCP server debugging challenges:**
1. **Background process:** MCP servers run as HTTP services, not interactive scripts
2. **OAuth callbacks:** Require public HTTPS URLs (e.g., `https://mcp.company.com/oauth/callback`)
3. **Client integration:** Must test with actual MCP clients (Claude Desktop, API consumers)
4. **Async operations:** FastMCP uses async/await, complicating stack traces
5. **Multi-tenant routing:** Business function context extracted from query strings
6. **External dependencies:** Database connections, Azure Key Vault, file systems

### Why Localhost Isn't Enough

You might think you could debug with:
```bash
python src/analyst.py
# Server runs on http://localhost:8000
```

**Problems with localhost-only debugging:**

1. **OAuth redirect mismatch:**
   ```
   Azure Entra ID redirect URI: https://mcp.company.com/oauth/callback
   Your local server:           http://localhost:8000/oauth/callback
   Result: OAuth flow fails with "redirect_uri_mismatch" error
   ```

2. **No HTTPS support:**
   - Claude Desktop (paid tier) requires HTTPS for custom connectors
   - OAuth providers reject non-HTTPS redirect URIs in production configurations
   - TLS certificate management is complex for local development

3. **Client can't reach your machine:**
   - Claude Desktop running on your laptop needs to reach the MCP server
   - `localhost` only works if both are on the same machine
   - Testing from mobile devices or remote machines is impossible

4. **Can't test production-like scenarios:**
   - FortiGate TLS offloading
   - Azure Container Instance networking
   - Multi-tenant URL routing (`?function=it` vs `?function=hr`)

---

## Solution: Cloudflare Tunnels as a Debug Bridge

Cloudflare Tunnels (`cloudflared`) creates a secure, temporary HTTPS tunnel from the public internet to your local development machine. This allows you to:

✅ **Expose `localhost:8000` as `https://random-name.trycloudflare.com`**  
✅ **Use this HTTPS URL in OAuth redirect URIs** (Azure Entra ID accepts it)  
✅ **Connect Claude Desktop to your local debug session** with full HTTPS support  
✅ **Set breakpoints and inspect code** as real OAuth flows and MCP queries execute  
✅ **No port forwarding, VPN, or complex networking required**

### How Cloudflare Tunnels Work

```
┌─────────────────┐
│  Claude Desktop │
│   (your laptop) │
└────────┬────────┘
         │ HTTPS request to:
         │ https://come-mart-anime-bring.trycloudflare.com/mcp?function=fin
         ↓
┌─────────────────────────┐
│  Cloudflare Edge Network│
│  (trycloudflare.com)    │
└────────┬────────────────┘
         │ Encrypted tunnel
         ↓
┌─────────────────────────┐
│  cloudflared (local)    │
│  Running in VS Code     │
│  terminal               │
└────────┬────────────────┘
         │ HTTP to localhost:8000
         ↓
┌─────────────────────────┐
│  Your MCP Server        │
│  (Python debugger       │
│   attached in VS Code)  │
└─────────────────────────┘
```

**Key benefits:**
- **Automatic HTTPS:** Cloudflare provides valid TLS certificate
- **Unique URL:** Each tunnel gets a random subdomain (e.g., `come-mart-anime-bring.trycloudflare.com`)
- **No configuration:** Works through firewalls, NAT, and corporate networks
- **Free and temporary:** Perfect for debugging sessions (tunnels expire after a few hours)
- **Full request/response access:** See all HTTP traffic in VS Code debugger

---

## Step-by-Step Debugging Workflow

### Step 1: Open Your MCP Server Project in VS Code

**1.1. Launch VS Code and open your MCP server project:**

If you're using a container-based development environment (which we recommend), attach to your running container in VS Code. If working directly on your host machine:

```bash
cd /path/to/your/mcp-server-project
code .
```

**1.2. Verify your project structure:**

```
mcp-server-project/
├── src/
│   └── analyst.py          # Main MCP server code
├── data/
│   ├── it/
│   │   ├── data_catalog.json
│   │   └── *.csv files
│   ├── hr/
│   └── fin/
├── requirements.txt
└── .vscode/
    └── launch.json         # Debug configuration (create in Step 7)
```

---

### Step 2: Install and Start Cloudflare Tunnel

**2.1. Check if `cloudflared` is already installed:**

Open a terminal in VS Code (`Terminal` → `New Terminal`) and run:

```bash
cloudflared --version
```

If you see output like `cloudflared version 2024.10.1`, skip to Step 2.3.

**2.2. Install `cloudflared` (if not present):**

**For Linux (including Docker containers):**
```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
```

**For macOS:**
```bash
brew install cloudflared
```

**For Windows:**
1. Download from: https://github.com/cloudflare/cloudflared/releases/latest
2. Extract `cloudflared.exe` to a directory in your PATH (e.g., `C:\Windows\System32`)
3. Verify installation:
   ```cmd
   cloudflared --version
   ```

**2.3. Start the Cloudflare Tunnel:**

In your VS Code terminal, run:

```bash
cloudflared tunnel --url http://localhost:8000
```

**Expected output:**
```
2025-11-18T15:52:49Z INF Requesting new quick Tunnel on trycloudflare.com...
2025-11-18T15:52:52Z INF +--------------------------------------------------------------------------------------------+
2025-11-18T15:52:52Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2025-11-18T15:52:52Z INF |  https://come-mart-anime-bring.trycloudflare.com                                           |
2025-11-18T15:52:52Z INF +--------------------------------------------------------------------------------------------+
2025-11-18T15:52:52Z INF Starting HTTP/2 server at http://localhost:8000
```

**🔑 Key Information to Copy:**
- **Tunnel URL:** `https://come-mart-anime-bring.trycloudflare.com`
- This URL changes every time you start a new tunnel
- The tunnel remains active as long as the terminal process is running
- Keep this terminal window open throughout your debugging session

**Why cloudflared requires `http://localhost:8000`:**

The key concept here is **TLS offloading**. Your Python MCP server runs as a simple HTTP service (no SSL/TLS complexity), and Cloudflare Tunnel handles all HTTPS encryption at the edge. This is identical to how FortiGate works in production—your application code stays simple while network infrastructure handles security.

Think of it as a secure pipe: HTTPS traffic enters the Cloudflare edge, travels encrypted through the tunnel to your machine, then connects to your local HTTP server. From your MCP server's perspective, it's just receiving plain HTTP requests, but the outside world sees HTTPS.

---

### Step 3: Copy Your Temporary Tunnel URL

**3.1. Identify the tunnel URL from the terminal output:**

Look for the line that starts with `https://` in the `cloudflared` output. Example:

```
2025-11-18T15:52:52Z INF |  https://come-mart-anime-bring.trycloudflare.com  |
```

**3.2. Copy the full HTTPS URL:**

In this example: `https://come-mart-anime-bring.trycloudflare.com`

**⚠️ Important Notes:**
- **Do not include trailing slashes** when copying the URL
- **The URL is unique to this tunnel session** and will be different each time
- **The URL is temporary** and typically expires after 24 hours or when you stop `cloudflared`
- **Write it down or keep the terminal visible**—you'll need this URL in Steps 4, 5, and 6

---

### Step 4: Update Azure OAuth Provider Configuration in Code

Now we configure your MCP server to use the Cloudflare Tunnel URL for OAuth callbacks instead of the production URL.

**4.1. Locate the OAuth configuration in your code:**

Open `src/analyst.py` in VS Code and find the Azure OAuth configuration section (typically near the top of the file, after imports and logging setup):

```python
# Azure OAuth Configuration
logger.info("Configuring Azure OAuth Provider")
try:
    azure_auth = AzureProvider(
        client_id=AZURE_CONFIDENTIAL_APP_ID,
        client_secret=AZURE_CONFIDENTIAL_SECRET,
        tenant_id="00b1a755-0b06-4d05-9a59-259ebf7f9e00",
        base_url="https://mcp.gdenergyproducts.com",  # ← Production URL
        required_scopes=["access_as_user"],
        additional_authorize_scopes=["User.Read", "offline_access"]
    )
```

**4.2. Replace the `base_url` with your tunnel URL:**

Change the `base_url` parameter to your Cloudflare Tunnel URL from Step 3:

```python
# Azure OAuth Configuration (DEBUG MODE)
logger.info("Configuring Azure OAuth Provider")
try:
    azure_auth = AzureProvider(
        client_id=AZURE_CONFIDENTIAL_APP_ID,
        client_secret=AZURE_CONFIDENTIAL_SECRET,
        tenant_id="00b1a755-0b06-4d05-9a59-259ebf7f9e00",
        base_url="https://come-mart-anime-bring.trycloudflare.com",  # ← Your tunnel URL
        required_scopes=["access_as_user"],
        additional_authorize_scopes=["User.Read", "offline_access"]
    )
    logger.info("Azure OAuth Provider configured successfully")
```

**⚠️ Critical:** Replace `https://come-mart-anime-bring.trycloudflare.com` with **your actual tunnel URL** from Step 3.

**4.3. Why this change is necessary:**

The `base_url` parameter tells the OAuth library where to redirect users after authentication. Here's the OAuth flow with your tunnel URL:

1. User clicks "Connect" in Claude Desktop
2. Browser opens Azure Entra ID login page: `https://login.microsoftonline.com/...`
3. User authenticates successfully
4. Azure redirects to: `https://come-mart-anime-bring.trycloudflare.com/oauth/callback?code=ABC123...`
5. Cloudflare Tunnel forwards to: `http://localhost:8000/oauth/callback?code=ABC123...`
6. Your MCP server (running in VS Code debugger) receives the callback
7. **Your breakpoint hits**—you can now inspect the OAuth code exchange in real-time!

**4.4. Save the file:**

Press `Ctrl+S` (Windows/Linux) or `Cmd+S` (Mac) to save `analyst.py`.

---

### Step 5: Update Claude Desktop MCP Server Configuration

Claude Desktop needs to know where to find your MCP server during debugging. We'll update its configuration to point to your Cloudflare Tunnel URL.

**5.1. Locate the Claude Desktop MCP configuration file:**

**File location by operating system:**
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
  - Full path typically: `C:\Users\YourUsername\AppData\Roaming\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

**5.2. Open the configuration file:**

From VS Code:
```bash
# Windows
code "%APPDATA%\Claude\claude_desktop_config.json"

# macOS/Linux
code ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**5.3. Find your MCP server configuration:**

The file contains a `mcpServers` object. Look for your server (e.g., `gdep-mcp-analyst-server`):

```json
{
  "mcpServers": {
    "gdep-mcp-analyst-server": {
      "url": "https://mcp.gdenergyproducts.com/mcp?function=fin",
      "type": "http"
    }
  }
}
```

**5.4. Update the URL to your Cloudflare Tunnel:**

Replace the production URL with your tunnel URL from Step 3:

```json
{
  "mcpServers": {
    "gdep-mcp-analyst-server": {
      "url": "https://come-mart-anime-bring.trycloudflare.com/mcp?function=fin",
      "type": "http"
    }
  }
}
```

**🔑 Key Points:**
- **Keep the query string:** `?function=fin` (or `it`, `hr` depending on what you're testing)
- **Keep `type: "http"`** (even though it's HTTPS—this tells Claude Desktop it's an HTTP-based MCP server, not stdio)
- **Replace only the domain** with your Cloudflare Tunnel URL
- **Don't add `/oauth/callback`** to the URL—Claude Desktop handles routing internally

**5.5. Save the file:**

Save and close. Verify the JSON is valid (no syntax errors).

**Example with multiple business functions for testing:**

If you want to test different business functions in the same debugging session:

```json
{
  "mcpServers": {
    "gdep-mcp-analyst-it": {
      "url": "https://come-mart-anime-bring.trycloudflare.com/mcp?function=it",
      "type": "http"
    },
    "gdep-mcp-analyst-hr": {
      "url": "https://come-mart-anime-bring.trycloudflare.com/mcp?function=hr",
      "type": "http"
    },
    "gdep-mcp-analyst-fin": {
      "url": "https://come-mart-anime-bring.trycloudflare.com/mcp?function=fin",
      "type": "http"
    }
  }
}
```

---

### Step 6: Register OAuth Callback URL in Azure Entra ID

Azure Entra ID must know that your Cloudflare Tunnel URL is an authorized redirect destination. Without this step, authentication will fail with a "redirect_uri_mismatch" error.

**6.1. Navigate to Azure Portal:**

1. Open: https://portal.azure.com
2. Sign in with an account that has permissions to modify App Registrations

**6.2. Locate your MCP App Registration:**

1. Search for **"App registrations"** in the top search bar
2. Click **App registrations** from results
3. Find and click your MCP server app (e.g., `MCP-Analyst-Server`)

**6.3. Open Authentication settings:**

1. In the left sidebar, click **Authentication** (under "Manage")
2. You should see existing redirect URIs for production:
   ```
   https://mcp.gdenergyproducts.com/oauth/callback
   https://claude.ai/api/mcp/auth_callback
   ```

**6.4. Add your Cloudflare Tunnel callback URL:**

1. Scroll to the **Web** platform section
2. Click **Add URI**
3. Enter your tunnel URL with `/oauth/callback` appended:
   ```
   https://come-mart-anime-bring.trycloudflare.com/oauth/callback
   ```
4. **Important:** Use your actual tunnel URL from Step 3

**6.5. Verify your redirect URI list:**

After adding, you should see:
```
Web - Redirect URIs:
✓ https://mcp.gdenergyproducts.com/oauth/callback
✓ https://claude.ai/api/mcp/auth_callback
✓ https://come-mart-anime-bring.trycloudflare.com/oauth/callback
```

**Why three redirect URIs?**
1. **Production URL:** For deployed MCP server in Azure Container Instance
2. **Claude Desktop proxy:** Required for Claude Desktop to act as OAuth intermediary
3. **Debug tunnel URL:** Allows local debugging with OAuth authentication

**6.6. Save the configuration:**

1. Click **Save** at the top of the Authentication page
2. Wait for confirmation: "Successfully updated MCP-Analyst-Server"

**6.7. Verify OAuth version is set to 2.0:**

While in the App Registration:

1. Click **Manifest** in the left sidebar
2. Find the line: `"accessTokenAcceptedVersion"`
3. Verify it's set to: `"accessTokenAcceptedVersion": 2`
4. If it's `null` or `1`, change to `2` and click **Save**

**Why this matters:** OAuth 2.0 tokens include the required claims (`preferred_username`, `oid`, `name`) that your MCP server expects. OAuth 1.0 tokens use different formats and will cause authentication failures.

**6.8. Cleanup after debugging:**

After your debugging session ends, remove the temporary tunnel URL:
1. Return to **Authentication** in Azure Portal
2. Find: `https://come-mart-anime-bring.trycloudflare.com/oauth/callback`
3. Click the trash icon to delete it
4. Click **Save**

This prevents "orphaned" redirect URIs that no longer work.

---

### Step 7: Configure VS Code Debugger and Set Breakpoints

**7.1. Create VS Code launch configuration:**

Create `.vscode/launch.json` in your project root:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Debug MCP Server",
            "type": "debugpy",
            "request": "launch",
            "program": "${workspaceFolder}/src/analyst.py",
            "console": "integratedTerminal",
            "justMyCode": false,
            "env": {
                "PYTHONUNBUFFERED": "1",
                "MCP_DEBUG": "true"
            },
            "args": [],
            "cwd": "${workspaceFolder}"
        }
    ]
}
```

**Configuration notes:**
- **`justMyCode: false`** allows stepping into library code (FastMCP, Polars)
- **`PYTHONUNBUFFERED: "1"`** ensures immediate log output
- **`MCP_DEBUG: "true"`** optional flag for debug-specific behavior in your code

**7.2. Set strategic breakpoints:**

Click in the left margin next to line numbers to set breakpoints. Recommended locations:

**A. OAuth Configuration (verify tunnel URL):**
```python
azure_auth = AzureProvider(
    client_id=AZURE_CONFIDENTIAL_APP_ID,
    client_secret=AZURE_CONFIDENTIAL_SECRET,
    tenant_id="00b1a755-0b06-4d05-9a59-259ebf7f9e00",
    base_url="https://come-mart-anime-bring.trycloudflare.com",  # ← Breakpoint here
    required_scopes=["access_as_user"],
    additional_authorize_scopes=["User.Read", "offline_access"]
)
```

**B. Business Function Extraction (verify routing):**
```python
async def dispatch(self, request: Request, call_next):
    function_via_query_string = request.query_params.get("function")  # ← Breakpoint here
    
    if function_via_query_string in {"it", "hr", "fin"}:
        business_function = function_via_query_string  # ← Breakpoint here
```

**C. User Context (inspect OAuth token):**
```python
def get_current_user_info() -> dict:
    token = get_access_token()  # ← Breakpoint here
    
    return {
        "email": token.claims.get("preferred_username"),
        "name": token.claims.get("name"),
        "oid": token.claims.get("oid")
    }  # ← Breakpoint here
```

**D. Data Catalog Loading:**
```python
@mcp.tool()
def get_data_catalog() -> str:
    business_function = get_current_business_function()  # ← Breakpoint here
    catalog_path = f"/mnt/azure/mcp/{business_function}/data_catalog.json"
    logger.debug(f"Looking for catalog file: {catalog_path}")  # ← Breakpoint here
```

**E. Query Execution:**
```python
@mcp.tool()
def execute_polars_sql(file_locations: List[str], query: str, file_type: str = "csv"):
    logger.info(f"Query: {query}")  # ← Breakpoint here
    df = read_file_list(file_locations, file_type)  # ← Breakpoint here
    op_df = df.sql(query)  # ← Breakpoint here
```

---

### Step 8: Start the MCP Server in Debug Mode

**8.1. Ensure Cloudflare Tunnel is still running:**

Check the terminal from Step 2. You should still see:
```
2025-11-18T15:52:52Z INF Starting HTTP/2 server at http://localhost:8000
```

If stopped, restart: `cloudflared tunnel --url http://localhost:8000`

**8.2. Start debugging:**

1. Press `F5` or click the green play button in the Debug panel
2. Select **"Debug MCP Server"** configuration

**8.3. Verify server starts successfully:**

The Debug Console should show:
```
======================== GDEP MCP Server Starting ========================
Configuring Azure OAuth Provider
Azure OAuth Provider configured successfully
FastMCP instance initialized successfully
Server configuration:
  - Host: 0.0.0.0
  - Port: 8000
  - Functions supported: IT, HR, FIN
===========================================================================
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

**8.4. Test tunnel connectivity:**

In a separate terminal:
```bash
curl https://come-mart-anime-bring.trycloudflare.com/mcp
```

Expected response (MCP server is running):
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32600,
    "message": "Invalid Request"
  }
}
```

This "Invalid Request" is correct—it means the server is responding, but we sent a plain HTTP GET instead of a proper MCP protocol message.

**8.5. Debug toolbar reference:**

| Button | Keyboard | Function |
|--------|----------|----------|
| ▶ Continue | `F5` | Resume until next breakpoint |
| ⏸ Pause | `F6` | Pause execution |
| ⤵ Step Over | `F10` | Execute line, don't enter functions |
| ⤴ Step Into | `F11` | Enter function to debug inside |
| ⤴ Step Out | `Shift+F11` | Exit function, return to caller |
| ↻ Restart | `Ctrl+Shift+F5` | Restart (reload code changes) |
| ■ Stop | `Shift+F5` | Stop debugger |

---

### Step 9: Connect Claude Desktop and Test with Real Queries

**9.1. Restart Claude Desktop:**

Claude Desktop only reads configuration at startup:

- **Windows:** Close completely, then restart
- **macOS:** Press `Cmd+Q`, then reopen
- **Linux:** Kill process, then restart

**9.2. Initiate OAuth authentication:**

1. Open Claude Desktop
2. Click on your MCP server connection
3. Browser opens Azure Entra ID login page
4. **Watch VS Code**—breakpoint should hit in OAuth configuration!
5. Sign in with your credentials
6. Azure redirects through tunnel to your local debugger
7. Inspect token claims in Debug Console:

```python
# In Debug Console when breakpoint hits
token.claims

# Output:
{
  'preferred_username': 'john.doe@company.com',
  'name': 'John Doe',
  'oid': '12345678-1234-1234-1234-123456789012',
  'scp': 'access_as_user User.Read'
}
```

Press `F5` to continue. Browser closes, Claude Desktop shows 🟢 Connected.

**9.3. Send test queries:**

In Claude Desktop, ask questions that trigger your MCP tools:

**For IT function (`?function=it`):**
```
How many devices do we have in our inventory?
```

**For HR function (`?function=hr`):**
```
Show me the number of active employees
```

**For Finance function (`?function=fin`):**
```
What's our total budget allocation for this quarter?
```

**9.4. Observe breakpoints hitting in sequence:**

As Claude processes your query:

**A. Business Function Extraction:**
```
🔴 Breakpoint hit: BusinessFunctionExtractionMiddleware.dispatch()
Variables panel shows:
  - request.query_params = {"function": "it"}
  - business_function = "it"
```

Press `F5` to continue.

**B. Data Catalog Retrieval:**
```
🔴 Breakpoint hit: get_data_catalog()
Variables panel shows:
  - business_function = "it"
  - catalog_path = "/mnt/azure/mcp/it/data_catalog.json"
```

Inspect in Debug Console:
```python
import os
os.path.exists(catalog_path)  # Verify file exists

with open(catalog_path, 'r') as f:
    import json
    catalog = json.load(f)
    print(f"Datasets: {list(catalog.get('datasets', {}).keys())}")
```

Press `F5` to continue.

**C. Query Execution:**
```
🔴 Breakpoint hit: execute_polars_sql()
Variables panel shows:
  - query = "SELECT COUNT(*) as device_count FROM self WHERE DeviceType = 'Laptop'"
  - file_locations = ["/mnt/azure/mcp/it/device_inventory.csv"]
```

Inspect the query Claude generated:
```python
# In Debug Console
print(f"Query:\n{query}")

# Load data and test query
df = read_file_list(file_locations, file_type)
print(f"Data shape: {df.shape}")
print(f"Columns: {df.columns}")

# Execute query
result = df.sql(query)
print(f"Result:\n{result}")
```

Press `F5` to continue.

**9.5. Verify results in Claude Desktop:**

Claude Desktop displays:
```
Results show up in Claude Desktop:
```

---

## Conclusion

This debugging workflow transforms MCP server development from a deployment-test-debug cycle into an interactive, real-time debugging experience. By combining Cloudflare Tunnels for HTTPS access, VS Code's powerful debugger, and direct Claude Desktop integration, you can inspect OAuth flows, trace business function routing, and validate query generation as it happens—all without leaving your local development environment. This approach dramatically accelerates development velocity, enables rapid iteration on complex authentication and data access logic, and provides the visibility needed to troubleshoot issues that would be nearly impossible to diagnose in production. Master this workflow once, and you'll spend less time deploying and more time building.