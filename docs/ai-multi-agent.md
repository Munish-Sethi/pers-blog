# Building an Enterprise Multi-Agent AI System with Microsoft Teams Integration
## A Production-Ready Architecture Using Azure AI Foundry, Model Context Protocol, and Agent Orchestration

---

## Introduction

This article documents the architecture and implementation of a production-ready enterprise AI assistant built using a **multi-agent architecture**. The system combines three specialized AI agents, each with distinct capabilities:

1. **Foundry Agent** - RAG-based knowledge retrieval using Azure AI Foundry
2. **Local Agent** - Custom Python tools for operational tasks
3. **MCP Agent** - Data analysis via Model Context Protocol server

The key insight driving this architecture is that **no single agent can do everything well**. By decomposing capabilities across specialized agents and implementing intelligent routing, we achieve both flexibility and reliability at enterprise scale.

**This guide demonstrates how to build a multi-agent system that:**
- Routes user queries to specialized agents automatically
- Manages conversation memory across agent switches
- Integrates with Microsoft Teams for enterprise deployment
- Learns about users over time with AI-powered memory
- Executes custom Python tools, RAG queries, and data analysis seamlessly

**All code and implementation examples are available in the source repository:** [teams-multi-ai-agent](https://github.com/Munish-Sethi/teams-multi-ai-agent)

---

## Architecture Overview

```
                              ┌─────────────────┐
                              │ Microsoft Teams │
                              │   (End Users)   │
                              └────────┬────────┘
                                       │ Messages
                                       ▼
                    ┌─────────────────────────────────────┐
                    │     Azure Bot Service               │
                    │     (Bot Framework Integration)     │
                    └────────────────┬────────────────────┘
                                     │ HTTPS Webhook
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                    FastAPI Backend (Port 8000)                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     Teams Bot Handler                                │  │
│  │  • User Authentication (Entra ID extraction)                         │  │
│  │  • Thread Persistence Management                                     │  │
│  │  • Context Injection                                                 │  │
│  │  • AI Memory Provider (learns about users)                           │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                     │                                      │
│                                     ▼                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Hybrid Intent Router                              │  │
│  │  1. Keyword Matching (~5ms, 80% of queries)                          │  │
│  │  2. LLM Classification (~150ms, 20% ambiguous queries)               │  │
│  │  3. Priority: MCP → Local → Foundry → Default (Local)                │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                     │                                      │
│           ┌─────────────────────────┼─────────────────────────┐            │
│           ▼                         ▼                         ▼            │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐       │
│  │   MCP AGENT     │     │  LOCAL AGENT    │     │ FOUNDRY AGENT   │       │
│  │ (Data Analyst)  │     │  (Operations)   │     │ (Knowledge/RAG) │       │
│  ├─────────────────┤     ├─────────────────┤     ├─────────────────┤       │
│  │ MCPStreamable   │     │ Custom Python   │     │ AzureAIAgent    │       │
│  │ HTTPTool        │     │ Tools           │     │ Client          │       │
│  │                 │     │                 │     │                 │       │
│  │ • Data Catalog  │     │ • User Lookup   │     │ • File Search   │       │
│  │ • SQL Queries   │     │ • Password      │     │ • Vector Store  │       │
│  │ • File Queries  │     │   Reset         │     │ • RAG Retrieval │       │
│  │ • Reports       │     │ • Tickets       │     │ • Policies/Docs │       │
│  │                 │     │ • Phone Orders  │     │                 │       │
│  │                 │     │ • AI Memory     │     │                 │       │
│  └────────┬────────┘     └─────────────────┘     └─────────────────┘       │
└───────────┼────────────────────────────────────────────────────────────────┘
            │ HTTP (RFC 1918 private network)
            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MCP Server (Separate Container)                          │
│                    FastMCP Framework - Port 8001                            │
├─────────────────────────────────────────────────────────────────────────────┤
│  9 Data Analysis Tools:                                                     │
│  1. get_data_catalog      - List all datasets with metadata                 │
│  2. get_connection_info   - Check data source connectivity                  │
│  3. get_files_list        - Available CSV/Parquet files                     │
│  4. get_database_tables   - SQL Server tables with row counts               │
│  5. get_schema            - File schemas (Polars)                           │
│  6. get_schema_db         - Database table schemas                          │
│  7. execute_polars_sql    - Query CSV/Excel files                           │
│  8. execute_database_query - Query SQL Server                               │
│  9. get_user_info         - User context lookup                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## The Multi-Agent Paradigm

### Why Multiple Agents?

A single monolithic agent faces several challenges at enterprise scale:

1. **Token Limits**: Stuffing all capabilities into one agent's system prompt consumes context window
2. **Specialization**: Different tasks require different models, tools, and configurations
3. **Maintainability**: Modular agents are easier to test, debug, and update independently
4. **Cost Optimization**: Route simple queries to cheaper models, complex ones to capable models

### The Orchestrator Pattern

Our architecture uses an **orchestrator pattern** where a central handler:

1. Receives the user message
2. Determines intent via hybrid routing
3. Routes to the appropriate specialized agent
4. Manages thread persistence across agents
5. Returns the response to the user

```python
# Simplified orchestrator flow
async def handle_message(user_message: str, context: TurnContext):
    # 1. Extract user identity from Teams
    user_identifier = extract_entra_id(context)

    # 2. Route to appropriate agent
    agent_type = route_to_agent(user_message)  # "mcp" | "local" | "foundry"

    # 3. Load/create conversation thread
    thread = await load_or_create_thread(conversation_id)

    # 4. Execute with appropriate agent
    if agent_type == "mcp":
        response = await mcp_agent.run(user_message, thread=thread)
    elif agent_type == "foundry":
        response = await foundry_agent.run(user_message)  # Stateless
    else:
        response = await local_agent.run(user_message, thread=thread)

    # 5. Save thread and return response
    await save_thread(thread)
    return response
```

---

## Agent #1: Azure AI Foundry Agent (RAG/Knowledge Base)

### What is Azure AI Foundry?

Azure AI Foundry (formerly Azure AI Studio) provides a managed platform for building AI agents with:

- **Hosted Agents**: Pre-configured agent instances with unique Agent IDs
- **File Search**: Vector store for RAG over uploaded documents
- **Code Interpreter**: Execute code in a sandboxed environment
- **Function Calling**: Define custom tool schemas

### Integration Pattern

The Foundry Agent is integrated using the `AzureAIAgentClient` from the Microsoft Agent Framework SDK:

```python
from azure.identity import ClientSecretCredential
from agent_framework.azure import AzureAIAgentClient

# Service Principal authentication
credential = ClientSecretCredential(
    tenant_id=AZURE_TENANT_ID,
    client_id=AZURE_CLIENT_ID,
    client_secret=AZURE_CLIENT_SECRET
)

# Create agent client
foundry_client = AzureAIAgentClient(
    credential=credential,
    project_endpoint="https://your-project.services.ai.azure.com/...",
    agent_id="asst_xxxxxxxxxxxx",  # Pre-configured agent ID
    model_deployment_name="gpt-4.1"
)
```

### Use Cases for Foundry Agent

- **Policy Questions**: "What is the password policy?"
- **Procedure Lookups**: "How do I request new hardware?"
- **Documentation Search**: "Explain the approval process"

### Key Insight: Stateless by Design

The Foundry Agent is intentionally **stateless** - each query is independent. This works well for knowledge base queries where context from previous questions rarely matters.

---

## Agent #2: Local Agent (Custom Python Tools)

### Why a Local Agent?

While Azure AI Foundry is powerful, it has limitations for custom tool execution:

1. **No Direct Code Execution**: Foundry tools are schema-based, not Python functions
2. **No Database Access**: Can't directly connect to SQL Server or APIs
3. **No Real-Time Integration**: Can't call external services like SAP or ServiceDesk

### Implementation

The Local Agent uses `AzureOpenAIChatClient` with Python function tools:

```python
from agent_framework.azure import AzureOpenAIChatClient

agent = AzureOpenAIChatClient(
    endpoint=AZURE_OPENAI_ENDPOINT,
    deployment_name="gpt-4.1",
    api_key=AZURE_OPENAI_API_KEY,
    api_version="2024-05-01-preview"
).create_agent(
    instructions="""You are an IT helpdesk assistant...""",
    name="IT-Helpdesk-Local",
    tools=[
        get_user_info,        # SQL database lookup
        reset_sap_password,   # SAP RFC integration
        create_ticket,        # ServiceDesk Plus API
        check_ticket_status,  # ServiceDesk Plus API
        get_my_open_tickets,  # ServiceDesk Plus API
        request_phone_order   # Workflow trigger
    ]
)
```

### Tool Definition Pattern

Tools are defined as Python functions with type hints and docstrings:

```python
def reset_sap_password(
    sap_account_name: str,
    user_identifier: str,
    identifier_type: str = "entra_id"
) -> str:
    """
    Reset SAP password for user account.

    ALWAYS call this tool for password reset requests.
    The tool handles all permission checks internally.

    Args:
        sap_account_name: SAP account to reset
        user_identifier: Entra ID of requesting user
        identifier_type: Type of identifier (entra_id or email)

    Returns:
        Formatted result with new temporary password
    """
    # Implementation connects to SAP via RFC
    # Validates permissions, resets password, returns result
    ...
```

### Tool Execution Flow

1. LLM receives user message + tool definitions
2. LLM generates a function call with arguments
3. Agent Framework executes the Python function
4. Function result is injected back into conversation
5. LLM generates final response incorporating tool output

---

## Agent #3: MCP Agent (Data Analysis)

### What is Model Context Protocol (MCP)?

MCP is an open protocol (developed by Anthropic) that standardizes how AI applications connect to external data sources and tools. Key concepts:

- **MCP Server**: Hosts tools and exposes them via HTTP/SSE
- **MCP Client**: Consumes tools from one or more MCP servers
- **Tool Discovery**: Client can query server for available tools
- **Standardized Format**: JSON-RPC style requests/responses

For a comprehensive guide on building MCP servers for data analysis, see our **[Data Analysis with LLM via MCP Server series - Part 1](ai-claude-mcp-analytic-server-part1.md)**.

### Why MCP for Data Analysis?

Data analysis tools have unique requirements:

1. **Schema Discovery**: Need to explore available datasets
2. **Query Flexibility**: Execute arbitrary SQL against files/databases
3. **Separation of Concerns**: Data layer managed independently from bot

### Integration via MCPStreamableHTTPTool

```python
from agent_framework import MCPStreamableHTTPTool

# Create MCP tool that connects to remote server
mcp_tool = MCPStreamableHTTPTool(
    name="data-analyst",
    url="http://mcp-server:8001/mcp?function=it",
    description="Data analysis tools - employee data, reports, SQL queries"
)

# Create agent with MCP tools
mcp_agent = AzureOpenAIChatClient(...).create_agent(
    instructions="""You are a data analyst assistant.

    CRITICAL FIRST STEP:
    1. ALWAYS call get_data_catalog FIRST before any query
    2. This shows available datasets with query_tool field
    3. Use the appropriate execution tool based on query_tool
    """,
    name="Data-Analyst",
    tools=mcp_tool  # Single tool that exposes 9 MCP capabilities
)
```

### MCP Server Architecture

The MCP server runs as a separate container and exposes these tools:

| Tool                        | Purpose                                         |
|-----------------------------|-------------------------------------------------|
| `get_data_catalog`          | List all datasets with metadata (CALL FIRST)    |
| `get_files_list`            | List CSV/Parquet files                          |
| `get_database_tables`       | List SQL tables with row counts                 |
| `get_schema`                | Get file column schema                          |
| `get_schema_db`             | Get database table schema                       |
| `execute_polars_sql`        | Query files using Polars                        |
| `execute_database_query`    | Query SQL Server                                |

**Full implementation details available in:** [enterprise-mcp-analyst Repository](https://github.com/Munish-Sethi/enterprise-mcp-analyst)

### Network Architecture

The MCP server runs on a private RFC 1918 network:

```
┌─────────────────────┐          ┌─────────────────────┐
│  Bot Container      │   HTTP   │  MCP Container      │
│  (Port 8000)        │ ───────► │  (Port 8001)        │
│                     │          │                     │
│  10.27.6.4          │  No Auth │  10.27.6.5          │
│                     │          │                     │
└─────────────────────┘          └─────────────────────┘
```

**No authentication is needed** because both containers are on the same Azure virtual network with no public exposure.

---

## Hybrid Intent Routing: Keywords + LLM Classification

### The Problem with Pure Keyword Matching

Simple keyword matching fails for ambiguous queries:

| Query                           | Expected | Keyword Match   |
|---------------------------------|----------|-----------------|
| "How many employees in IT?"     | MCP      | ✅ "employees"  |
| "I need some numbers"           | MCP      | ❌ No keyword   |
| "Show me the data"              | MCP      | ✅ "data"       |
| "What's the current situation?" | ???      | ❌ Ambiguous    |

### The Hybrid Solution

We combine fast keyword matching with LLM fallback:

```python
def route_to_agent(user_message: str) -> str:
    message_lower = user_message.lower()

    # Step 1: Check MCP keywords (HIGHEST PRIORITY) - ~5ms
    mcp_keywords = ["data", "analyze", "employees", "bill", "report", ...]
    for keyword in mcp_keywords:
        if keyword in message_lower:
            return "mcp"

    # Step 2: Check operational keywords - ~5ms
    operational_keywords = ["reset password", "create ticket", "hello", ...]
    for keyword in operational_keywords:
        if keyword in message_lower:
            return "local"

    # Step 3: Check knowledge keywords - ~5ms
    knowledge_keywords = ["policy", "procedure", "how to", ...]
    for keyword in knowledge_keywords:
        if keyword in message_lower:
            return "foundry"

    # Step 4: No match - use LLM classification - ~150ms
    intent = classify_with_llm(user_message)

    if intent == "data_analysis":
        return "mcp"
    elif intent == "operational_task":
        return "local"
    elif intent == "knowledge_base":
        return "foundry"

    # Step 5: Default fallback
    return "local"
```

### LLM Intent Classifier

For ambiguous queries, we use GPT-4.1-mini (fast, cheap):

```python
class IntentClassifier:
    def __init__(self):
        self.system_prompt = """You are an intent classifier.
        Classify into exactly ONE category:

        1. data_analysis - Data, numbers, reports, employee info
        2. operational_task - Password resets, tickets, actions
        3. knowledge_base - Policies, procedures, how-to questions

        Respond with ONLY ONE WORD: data_analysis OR operational_task OR knowledge_base"""

    def classify(self, message: str) -> str:
        response = self.client.chat.completions.create(
            model="gpt-4.1-mini",
            messages=[
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": message}
            ],
            temperature=0.3,        # Consistent classification
            max_tokens=10,          # One word response
            timeout=5.0             # Quick timeout
        )
        return response.choices[0].message.content.strip().lower()
```

### Performance Metrics

| Routing Method     | Latency      | Accuracy | Cost                    |
|--------------------|--------------|----------|-------------------------|
| Keyword Matching   | ~5ms         | 80%      | Free                    |
| LLM Classification | ~150ms       | 99%      | ~$0.0001/query          |
| **Hybrid**         | **~15ms avg** | **93%**  | **~$0.02/100 queries**  |

---

## Thread Persistence & Conversation Memory

### The Challenge

Users expect continuity across messages:

```
User: "What is our December Azure bill?"
Bot: "The December 2025 Azure bill is $56,940.03"

User: "Compare that to November"  ← Bot needs to remember "December bill"
```

### Solution: Serialized Thread Storage

We serialize the entire conversation thread to Azure Blob Storage:

```python
class ThreadStorage:
    def __init__(self, conversation_id: str, user_identifier: str):
        self.base_path = f"/mnt/azure/helpdesk/threads/{conversation_id}"

    def save_thread(self, thread_id: str, thread_data: dict):
        file_path = f"{self.base_path}/thread_{thread_id}.json"
        with open(file_path, 'w') as f:
            json.dump(thread_data, f)

    def load_thread(self, thread_id: str) -> dict:
        file_path = f"{self.base_path}/thread_{thread_id}.json"
        with open(file_path, 'r') as f:
            return json.load(f)
```

### Thread Serialization with Agent Framework

The Microsoft Agent Framework provides built-in serialization:

```python
# After agent response
serialized = await thread.serialize()
thread_storage.save_thread(thread_id, serialized)

# Before next message
thread_data = thread_storage.load_thread(active_thread_id)

# Convert dicts back to ChatMessage objects
from agent_framework import ChatMessage
if 'chat_message_store_state' in thread_data:
    store = thread_data['chat_message_store_state']
    store['messages'] = [
        ChatMessage.from_dict(msg) if isinstance(msg, dict) else msg
        for msg in store['messages']
    ]

# Restore thread with history
thread = await agent.deserialize_thread(thread_data)
```

### Sliding Window: Cost Optimization

Long conversations can consume excessive tokens. We apply a sliding window:

```python
def apply_sliding_window(thread, max_messages: int = 20):
    """Keep only last N messages for LLM context, but save full history."""

    original_messages = thread._chat_message_store.messages
    original_count = len(original_messages)

    if original_count > max_messages:
        # Store full history for later restoration
        full_history = list(original_messages)

        # Send only recent context to LLM
        thread._chat_message_store.messages = original_messages[-max_messages:]

        # After LLM response, restore full history + new messages
        # ... (see full implementation)

    return thread
```

**Cost savings example:**
- Thread with 300 messages: ~60,000 tokens = ~$1.80/request
- After sliding window (20 messages): ~4,000 tokens = ~$0.12/request
- **93% cost reduction**

---

## Agent-Specific Context Filtering

### The Cross-Agent Hallucination Problem

When agents share conversation history, a dangerous issue emerges:

```
1. User: "What is December Azure bill?"
2. MCP Agent: [calls execute_database_query] → "$56,940.03"

3. User: "Reset my password"  ← Routes to LOCAL agent
4. LOCAL Agent sees: execute_database_query in history
5. LOCAL Agent doesn't have this tool
6. LOCAL Agent HALLUCINATES random tool calls! ❌
```

### Solution: Filter Before Sending to LLM

Before sending context to each agent, filter out tool calls from other agents:

```python
def filter_context_by_agent(thread, target_agent: str):
    """Remove cross-agent tool calls to prevent hallucinations."""

    MCP_TOOLS = {
        'get_data_catalog', 'execute_database_query',
        'execute_polars_sql', 'get_schema', ...
    }

    LOCAL_TOOLS = {
        'get_user_info', 'reset_sap_password',
        'create_ticket', 'check_ticket_status', ...
    }

    filtered_messages = []

    for msg in thread.messages:
        if msg.role == 'user':
            # ALWAYS keep user messages
            filtered_messages.append(msg)

        elif msg.role == 'assistant':
            # Check for cross-agent tool calls
            has_foreign_tools = False

            for content in msg.contents:
                if content.type == 'function_call':
                    tool_name = content.name

                    if target_agent == 'local' and tool_name in MCP_TOOLS:
                        has_foreign_tools = True
                    elif target_agent == 'mcp' and tool_name in LOCAL_TOOLS:
                        has_foreign_tools = True

            if not has_foreign_tools:
                filtered_messages.append(msg)

    thread.messages = filtered_messages
    return thread
```

### Execution Flow with Filtering

```
1. Load full thread (50 messages)
2. Apply sliding window (keep last 20)
3. Apply agent-specific filter (remove cross-agent tools)
4. Send clean context to LLM
5. Get response
6. Restore full history + add new messages
7. Save complete thread to storage
```

---

## The AI Memory System: Learning About Users

### Beyond Session Memory

Traditional chatbots only remember within a session. Our AI Memory system learns across all conversations:

```
Day 1: "Hi, I'm John from the Finance department"
Bot: [Learns: name="John", department="Finance"]

Day 2: "Reset my SAP password"
Bot: "Hi John! I'll reset your SAP password right away."
     [Knows user without asking]
```

### Implementation: ContextProvider Pattern

The Microsoft Agent Framework provides a `ContextProvider` interface:

```python
from agent_framework import ContextProvider, Context

class AIMemoryProvider(ContextProvider):
    """AI-powered long-term memory that learns about users."""

    def __init__(self, user_identifier: str, ai_client: AsyncAzureOpenAI):
        self.user_identifier = user_identifier
        self.ai_client = ai_client
        self.profile_file = f"/mnt/azure/helpdesk/memory/{user_identifier}/profile.json"
        self._load_profile()

    async def invoking(self, messages, **kwargs) -> Context:
        """Called BEFORE agent processes request. Inject user profile."""
        if self.user_profile:
            profile_text = "\n".join([f"- {k}: {v}" for k, v in self.user_profile.items()])

            return Context(instructions=f"""
[USER PROFILE - LONG-TERM MEMORY]:
{profile_text}

Reference this naturally when relevant. Greet the user by name!
""")
        return Context()

    async def invoked(self, request_messages, response_messages, **kwargs):
        """Called AFTER conversation. Extract new information."""
        user_message = extract_last_user_message(request_messages)

        # Use AI to extract facts worth remembering
        extraction_prompt = f"""
Analyze this message and extract personal info worth remembering:
"{user_message}"

Current profile: {self.user_profile}

Extract ONLY factual info about the user:
- Personal: name, department, role, location
- Technical: systems they use, common issues
- Preferences: communication style

Return as JSON: {{"key": "value"}}
If nothing to remember, return: {{}}
"""

        response = await self.ai_client.chat.completions.create(
            model="gpt-4.1",
            messages=[{"role": "user", "content": extraction_prompt}],
            temperature=0.1,  # Consistent extraction
            max_tokens=200
        )

        extracted = json.loads(response.choices[0].message.content)
        if extracted:
            self.user_profile.update(extracted)
            self._save_profile()
```

### What Gets Remembered

The AI decides what's important. Examples:

| User Says                      | AI Learns                                           |
|--------------------------------|-----------------------------------------------------|
| "I'm John Smith from Finance"  | `name: "John Smith", department: "Finance"`         |
| "I use SAP every day"          | `primary_systems: "SAP"`                            |
| "This laptop issue again"      | `recurring_issue: "laptop problems"`                |
| "Reset my password"            | `{}` (no personal info, just request)               |

---

## Microsoft Teams as the UI Layer

### Why Teams?

1. **Enterprise Integration**: Already deployed in most organizations
2. **Identity Built-in**: Entra ID (Azure AD) authentication automatic
3. **No App to Install**: Works in existing Teams client
4. **Mobile + Desktop**: Unified experience across devices

### Bot Framework Integration

```python
from botbuilder.core import ActivityHandler, TurnContext
from botbuilder.schema import Activity, ActivityTypes

class ITHelpdeskBot(ActivityHandler):

    async def on_message_activity(self, turn_context: TurnContext):
        # Extract message
        user_message = turn_context.activity.text

        # Extract Entra ID (automatically provided by Teams)
        entra_id = turn_context.activity.from_property.aad_object_id

        # Send typing indicator
        await turn_context.send_activity(Activity(type=ActivityTypes.typing))

        # Route and process (as shown earlier)
        response = await self.process_message(user_message, entra_id)

        # Send response (supports Markdown)
        await turn_context.send_activity(MessageFactory.text(response))
```

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. User sends message in Teams                                 │
│                        ↓                                        │
│  2. Teams adds Entra ID (aad_object_id) to activity             │
│                        ↓                                        │
│  3. Azure Bot Service routes to webhook                         │
│                        ↓                                        │
│  4. FastAPI receives with full user identity                    │
│                        ↓                                        │
│  5. Bot uses Entra ID for:                                      │
│     - Database lookup (user's department, email, etc.)          │
│     - Permission checks (can they reset others' passwords?)     │
│     - Thread storage (per-user conversation history)            │
│     - AI Memory (per-user learned preferences)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Putting It All Together

### Complete Request Flow

```
User sends "How many employees in IT?" via Teams

┌─────────────────────────────────────────────────────────────────┐
│ 1. AUTHENTICATION                                               │
│    - Extract Entra ID from Teams activity                       │
│    - Look up user in SQL database                               │
│    - Initialize AI Memory for this user                         │
└──────────────────────────┬──────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. INTENT ROUTING                                               │
│    - Check keywords: "employees" → MCP_KEYWORDS                 │
│    - Route decision: "mcp" (Data Analyst)                       │
└──────────────────────────┬──────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. THREAD MANAGEMENT                                            │
│    - Load conversation thread from Azure Blob                   │
│    - Apply sliding window (keep last 20 messages)               │
│    - Apply agent filter (remove LOCAL agent tool calls)         │
└──────────────────────────┬──────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. MCP AGENT EXECUTION                                          │
│    - Create MCP agent with data analysis tools                  │
│    - Agent calls: get_data_catalog → execute_database_query     │
│    - Query: SELECT COUNT(*) FROM employees WHERE dept = 'IT'    │
│    - Result: 42 employees                                       │
└──────────────────────────┬──────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. RESPONSE & PERSISTENCE                                       │
│    - Restore full thread history                                │
│    - Add new messages (user + assistant + tool calls)           │
│    - Serialize and save to Azure Blob                           │
│    - Log request for audit                                      │
└──────────────────────────┬──────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. TEAMS RESPONSE                                               │
│    - Send Markdown-formatted response                           │
│    - "There are **42 employees** in the IT department."         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Architectural Decisions

### 1. Shared Thread Storage (Option B: Filtered Context)

**Decision**: All agents share the same thread storage, but filter before sending to LLM.

**Why**:
- Users expect context to persist across agent switches
- "Compare this to November" works after MCP query
- Filtering prevents cross-agent hallucinations
- Full history preserved for audit/compliance

**Rejected Alternatives**:
- Option A (Separate Threads): Lost context across agent switches
- Option C (No Filtering): Caused LLM hallucinations

### 2. Hybrid Intent Routing

**Decision**: Keywords first, LLM fallback for ambiguous queries.

**Why**:
- Keywords handle 80% of queries instantly (~5ms)
- LLM provides 99% accuracy for edge cases (~150ms)
- Graceful degradation if LLM unavailable
- Cost-effective (~$0.02 per 100 ambiguous queries)

### 3. Foundry Agent for Knowledge, Local Agent for Operations

**Decision**: Separate RAG/knowledge capabilities from custom tool execution.

**Why**:
- Foundry excels at document retrieval (built-in vector store)
- Local agent excels at real-time integrations (SAP, ServiceDesk, SQL)
- Different tool paradigms (schema-based vs Python functions)
- Independent scaling and updates

### 4. MCP for Data Analysis

**Decision**: Separate MCP server for data queries.

**Why**:
- Data schema changes independently from bot logic
- Same MCP server can serve multiple clients (bot, Claude Desktop, etc.)
- SQL injection prevention in isolated container
- Easy to add new data sources without redeploying bot

---

## Lessons Learned

### 1. LLMs Will Hallucinate If They See Unavailable Tools

When a LOCAL agent sees MCP's `execute_database_query` in conversation history, it will try to call it even though it doesn't have access. **Always filter context before sending to each agent.**

### 2. Thread Serialization Requires Exact Import Paths

```python
# ✅ CORRECT - preserves conversation memory
from agent_framework import ChatMessage

# ❌ WRONG - silently breaks thread deserialization
from agent_framework.messages import ChatMessage
```

This caused hours of debugging. The import path affects how objects are serialized/deserialized.

### 3. Cached Thread History Can Poison Conversations

If the bot once generated a bad response (e.g., "You don't have permission"), that response stays in thread history. On subsequent messages, the LLM sees this pattern and repeats it. **Solution**: Clear thread storage when debugging, or implement thread expiration.

### 4. Tool Docstrings Are System Prompts

The LLM reads tool docstrings to decide when/how to call tools. Vague docstrings cause wrong tool calls. Be explicit:

```python
# ❌ Vague
def reset_password(account):
    """Reset user password."""

# ✅ Explicit
def reset_password(account):
    """
    Reset SAP password for account.

    ALWAYS call this tool for password requests.
    DO NOT check permissions - the tool handles this internally.
    Pass the account name EXACTLY as the user specifies.
    """
```

### 5. Emojis and Formatting Get Lost Without Strong Instructions

LLMs like to "clean up" responses. If your tool returns formatted output with emojis, the LLM may summarize or rephrase it. Add explicit instructions:

```
Tool output = YOUR output. No summarizing. No rephrasing.
Copy the tool response CHARACTER FOR CHARACTER.
Include EVERY emoji. Include EVERY markdown element.
```

---

## Conclusion

Building a production-ready multi-agent system requires careful consideration of:

1. **Agent Specialization**: Each agent has clear responsibilities
2. **Intelligent Routing**: Fast keywords + accurate LLM fallback
3. **Context Management**: Shared storage with agent-specific filtering
4. **Memory Systems**: Session threads + long-term AI memory
5. **Enterprise Integration**: Teams + Entra ID + Azure services

The result is a system that feels like a single intelligent assistant while leveraging the strengths of multiple specialized agents behind the scenes.

**For a deep dive into building the MCP data analysis component,** see our comprehensive guide: [Data Analysis with LLM via MCP Server - Part 1](ai-claude-mcp-analytic-server-part1.md)

**All implementation code and deployment details are available at:**
- **Multi-Agent System**: [teams-multi-ai-agent](https://github.com/Munish-Sethi/teams-multi-ai-agent)
- **MCP Data Server**: [enterprise-mcp-analyst](https://github.com/Munish-Sethi/enterprise-mcp-analyst)

---

## References and Credits

- [Microsoft Agent Framework SDK](https://github.com/microsoft/agent-framework)
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
- [Azure AI Foundry Documentation](https://learn.microsoft.com/azure/ai-studio/)
- [Bot Framework SDK for Python](https://github.com/microsoft/botbuilder-python)
- [FastMCP Framework](https://github.com/jlowin/fastmcp)
- [Polars DataFrame Library](https://pola.rs/)

---

*This article documents a production implementation. Architecture patterns and code examples are based on real-world enterprise deployment.*
