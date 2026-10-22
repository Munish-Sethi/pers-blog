---
description: Part 1 - why I replaced a custom multi-agent Teams bot with an Azure AI Foundry agent, an authenticated MCP server and Logic Apps, and why Microsoft 365 Copilot Chat became the entry point.
---

# From a Custom Multi-Agent Bot to Azure AI Foundry: An Enterprise IT Help Desk Agent
## Part 1: Architecture, Components and Why I Moved

---

### 📚 **Series Navigation**
- Background: [Building an Enterprise Multi-Agent AI System with Microsoft Teams](ai-multi-agent.md)
- **Part 1: Architecture, Components and Why I Moved** *(Current)*
- [Part 2: Step-by-Step Build](ai-foundry-agent-part2.md)

*In [Building an Enterprise Multi-Agent AI System with Microsoft Teams](ai-multi-agent.md) I documented a help desk assistant I built myself: a Bot Framework backend, a hybrid intent router, three specialized agents, my own thread storage and an AI memory layer. It worked. This two-part series documents what replaced it — the same help desk capabilities, rebuilt on Microsoft-managed services with almost all of the custom orchestration code removed. Part 1 is the architecture and the reasoning; [Part 2](ai-foundry-agent-part2.md) is the step-by-step build.*

---

## Introduction

The multi-agent article closed on the idea that a production assistant needs specialization, routing, context management, memory and enterprise integration. All of that is still true. What changed in a year is **who has to build it**.

When I built the first version, Azure AI Foundry could host a knowledge agent, but anything operational — resetting an SAP password, creating a ticket, starting a phone request — had to live in my own code, behind my own router, in my own bot. Today a single Foundry agent can call my tools over the **Model Context Protocol (MCP)** *as the signed-in user*, Foundry keeps the conversation, Azure AI Search serves the policy documents, and the agent is published to **Microsoft Teams and Microsoft 365 Copilot** from the Foundry portal.

The goal of the rebuild was simple: **keep the business logic, delete the plumbing.** Every rule that matters (who may reset whose password, which phone a manager may order, when an approval expires) stays in my code, where it can be tested. Everything that is undifferentiated — hosting a bot, routing intents, persisting threads, rendering a chat UI — moves to the platform.

**The help desk agent handles:**

- **SAP password reset** — for yourself, or for someone else if you are a help desk power user; the new password is delivered privately in Teams, never through the chat
- **Service desk tickets** — "my open tickets", ticket status, create a ticket
- **Phone requests** — new hire, replacement or leaver, with manager approval and a phone-admin hand-off in Teams
- **IT policy questions** — answered from the company's own policy PDFs, with a link to the source
- **"What do you know about me?"** — the user's own profile, accounts and roles

---

## Then vs. Now

Every section of the original article maps to something that no longer needs custom code:

| What the multi-agent article built | What replaced it |
|---|---|
| Azure Bot Service + FastAPI webhook + Teams bot handler | **Agent Application** published from Azure AI Foundry to Teams and Microsoft 365 Copilot |
| Hybrid intent router (keywords + LLM classifier) | **One Foundry agent** that chooses tools from their descriptions and its instructions |
| Local agent with Python tools | **MCP tools** on my existing MCP server, behind a dedicated authenticated endpoint |
| Foundry RAG agent with its own vector store | **Azure AI Search** index attached to the same agent |
| Thread persistence + sliding window | **Foundry conversations** (managed by the platform — see *The Problem I Hit*) |
| Agent-specific context filtering | Not needed — one agent, one context |
| AI memory system | Not needed — profile data comes from a tool, on demand |
| Entra ID extracted by the bot | **OAuth identity passthrough** — the user's own token reaches my server |
| Hard-coded list of power users | **Entra app roles** assigned through groups |

What stayed custom is deliberately small: the MCP tools (the business rules) and two Logic Apps (Teams cards and waits).

---

## Architecture Overview

```
        ┌──────────────────────────────┐    ┌──────────────────────────┐
        │ Microsoft 365 Copilot Chat   │    │ Microsoft Teams          │
        │ (primary entry point)        │    │ (same app, not promoted) │
        └──────────────┬───────────────┘    └────────────┬─────────────┘
                       └───────────────┬─────────────────┘
                                       ▼
        ┌─────────────────────────────────────────────────────────────┐
        │ Azure AI Foundry project                                     │
        │  ┌───────────────────────────────────────────────────────┐  │
        │  │ Help desk agent (versioned instructions)              │  │
        │  │  • Model deployment (US Data Zone)                    │  │
        │  │  • Tool: Azure AI Search  ──► policy PDFs index       │  │
        │  │  • Tool: MCP connection (custom OAuth, per-user)      │  │
        │  └───────────────────────────┬───────────────────────────┘  │
        │  Tracing ──► Application Insights / Log Analytics           │
        └──────────────────────────────┼──────────────────────────────┘
                                       │ HTTPS + the user's Entra token
                                       ▼
        ┌─────────────────────────────────────────────────────────────┐
        │ MCP server (container)                                      │
        │  /helpdesk/mcp  ← help desk tools only (this series)        │
        │  /mcp           ← data analysis tools (Claude, MCP series)  │
        │  • validates token: tenant, audience, scope, app roles      │
        │  • identity = token, never a tool argument                  │
        └───┬──────────────┬──────────────┬───────────────┬───────────┘
            ▼              ▼              ▼               ▼
      SAP ECC (RFC)   ServiceDesk    HR / identity    Logic Apps
      BAPIs           Plus API       data (SQL)       (Teams cards, waits)
                                                          │
                                                          │ managed identity
                                                          ▼ callbacks
                                                     MCP server
```

Two things are worth noticing in the diagram. First, **the model never sees a password or makes a decision** — it collects intent and calls tools; the tools decide. Second, **the same MCP server** from the [MCP Analytic Server series](ai-claude-mcp-analytic-server-part1.md) hosts the help desk tools on a second endpoint, so there is one container, one deployment and one set of network routes to SAP and SQL.

---

## The Components

### 1. Microsoft Entra ID: one app registration, four app roles

A single app registration represents the MCP server. It is the audience of every token the server accepts, and it is where access is defined.

**Why app roles instead of group checks in code:** the token already carries the `roles` claim, so the server never has to call Microsoft Graph to ask "is this user in group X?". Access changes are made in Entra by an administrator, not by redeploying code.

| App role | Assigned to | Grants |
|---|---|---|
| **MCP.User** | Analyst groups | The data analysis tools on `/mcp` (Claude Desktop / claude.ai) |
| **HelpDesk.User** | All-employee groups (salaried, hourly, external staff) | Profile, tickets, own SAP reset, phone requests |
| **HelpDesk.PowerUser** | Help desk support group | Everything above, plus resetting *other* users' SAP passwords |
| **HelpDesk.Workflow** | Logic App managed identities (applications only) | Calling back into the server with approval results |

One level deeper:

- **Assignment required = Yes.** A user without a role cannot get a token for the app at all — the first line of defense is Entra, not my code.
- **Groups, not people.** Roles are assigned to groups; only *direct* members receive the role (nested groups do not inherit).
- **Guests excluded.** By group membership, and by the server checking the token's account-type claim.
- **One client secret per consumer.** Foundry's connection and the server's own sign-in proxy use separate secrets on the same app, so either can be rotated or revoked independently. Secrets live in Key Vault with expiry dates set.
- **Admin consent granted once** for the delegated scope, so employees are not asked to approve permissions.

### 2. Azure AI Foundry: project, model deployment and a versioned agent

All help desk AI resources sit in one dedicated resource group: the Foundry resource and project, the model deployment, the AI Search service and the monitoring resources. That makes cost tracking a single filter in Cost Management.

- **Model deployment:** a GA model positioned for multi-step tool orchestration, deployed as **US Data Zone** so prompts — which contain employee names, ticket and account details — are processed in the US. The deployment's **tokens-per-minute (TPM)** limit is a rate limit, not a cost; I raised it before go-live after routing tests hit it.
- **The agent** is a *prompt agent*: instructions + model + tools. Every save creates a **new version**, and the published application serves the version marked Active — so a bad change is one click to roll back.
- **Instructions are kept in git** as the source of truth and pasted into Foundry. Only the instruction block is pasted; an early version that accidentally included the whole Markdown file (change log and test lists) added several thousand tokens to *every* request.

### 3. The MCP server: an authenticated endpoint per audience

The existing MCP server gained a second endpoint, `/helpdesk/mcp`, that exposes **only** help desk tools — none of the data analysis tools are reachable from the agent.

The connection from Foundry uses **custom OAuth identity passthrough**: each user signs in once, Foundry stores their token, and every tool call arrives with that user's own Entra token. The server validates tenant, audience, scope and roles, and then:

- **Identity comes only from the token.** No tool has a "user" parameter; the model cannot ask for someone else's data by naming them.
- **Sensitive actions are two-step.** A SAP reset first returns a summary of exactly what will happen; only an explicit "yes" within five minutes executes it, using a one-time confirmation bound to that user, that account and that action. The code itself is never shown to the user.
- **Write switches.** Every action that changes something (SAP reset, ticket creation, phone requests) is off unless a deployment setting turns it on — tests can never write by accident.
- **Repeat-safe.** A repeated "submit" within minutes returns the existing request instead of creating a duplicate.
- **Results are returned once, as text.** By default the MCP library returned each result twice (text plus a structured copy); removing the duplicate cut the tokens of every tool reply.

### 4. Azure AI Search: policies with a source link

The company's IT policies and how-to guides (PDFs) are indexed in an Azure AI Search index attached to the agent as a knowledge tool. Answers cite the document, and the instructions map each document to its SharePoint URL so the user gets a link to the authoritative copy, not a summary they have to trust.

### 5. Logic Apps: Teams cards and waiting, nothing else

Two Consumption Logic Apps do the things an MCP server should not: post Teams cards and wait days for a human to click.

- **SAP password delivery.** The server resets the password, then hands the temporary password to a Logic App that posts it to the user in a private Teams card (hidden behind *Show password*). The password never passes through the chat, the model or the logs; the Logic App's inputs and outputs are marked secure so run history does not show it either.
- **Phone requests.** Approval card to the manager, wait; "done" card to the phone administrator, wait; each answer is sent back to the server, which decides what happens next.

The rule is **the server owns every decision; the Logic App only waits and reports.** Calls into a Logic App carry an Entra bearer token checked by an OAuth authorization policy; calls back use the Logic App's managed identity with the `HelpDesk.Workflow` app role.

### 6. Publishing: one app for Teams, Microsoft 365 and Copilot

From the Foundry portal the agent is published as an **Agent Application**, which produces one Teams app covering Teams, Microsoft 365 and Copilot. Availability is managed in the Teams admin center by group — the same employee groups that hold `HelpDesk.User` — so who can *see* the agent and who can *use* the tools stay aligned.

### 7. Observability and cost

- **Application Insights + Log Analytics** connected to the Foundry project: every run is a trace showing the model calls, tool calls, arguments, results and token counts. This is what answers the eternal question *"is it the model or the code?"* — a wrong tool choice is the model; wrong data from the right tool is the code.
- **A log alert** on failed agent runs (several failures within 15 minutes) and a **monthly budget** on the resource group with an alert at 80% actual and 100% forecast.
- **Cost per answer** with a fresh conversation is about **two cents** at US Data Zone list prices — the model is pay-as-you-go, and the Foundry project, agent and idle time cost nothing.

---

## The Problem I Hit: Teams Never Starts a New Conversation

Everything worked in testing. Then a simple "show my profile" in Teams started taking far longer than the same question in the Foundry playground, and occasionally hit the model's rate limit.

The traces explained it. A published agent keeps **one conversation per user per Teams chat — forever**. Every new message re-sends the entire history of that chat to the model:

| Where the same question was asked | Input tokens |
|---|---|
| Fresh conversation (playground, Copilot "New chat") | ~7,500 |
| A Teams chat after a day of testing | ~30,000 |

It grows by roughly a thousand tokens per exchange, so the cost and latency of every answer depend on how long a user has been chatting — not on the question.

There is a certain irony here. The [multi-agent article](ai-multi-agent.md) spent a whole section on thread persistence with a **sliding window** precisely to stop this from happening. The managed platform keeps the whole history, with no window.

This is a **documented limitation**, not a misconfiguration. Microsoft's troubleshooting guide for published agents says that in Teams the user must send the agent `/foundry_new_preview` to reset the conversation, and that *"Teams doesn't currently provide another way to start a new session."* There is no setting for conversation length or idle reset, and the published application does not expose an administrative API to clear users' conversations.

No employee will ever discover — or remember — a command called `/foundry_new_preview`.

---

## The Solution: Microsoft 365 Copilot Chat as the Front Door

The same published app also appears in **Microsoft 365 Copilot Chat**, and Copilot has something Teams does not: a **New chat** button that really does start a new conversation. Measured with the same question: first message ~7,500 tokens, a follow-up in the same chat ~8,500, and *New chat* back to ~7,500 with a new conversation ID.

The obvious concern was licensing. Microsoft's guidance for published Foundry agents states that users don't need a Microsoft 365 Copilot license to access custom engine agents in Copilot Chat, and my tests agreed: an account with only the free Copilot Chat experience could add the agent and get answers, and an employee with a frontline (F3) license and no Copilot license added it and used its tools end to end.

So the decision was:

- **Copilot Chat is the entry point** I point users to.
- **The Teams app still exists** (it is the same app), but I do not promote adding it as a Teams chat.
- **Soft release** — enabled for the employee groups without an announcement, so usage grows gradually while I watch the traces and the budget.

---

## Key Architectural Decisions

### 1. One agent with tools, not multiple agents

**Chosen:** a single Foundry agent with MCP tools and a search tool.
**Rejected:** recreating the router and specialist agents.
**Why:** current models choose between a dozen well-described tools reliably; one agent means one context, no cross-agent hallucinations and no routing code to maintain. Routing quality is checked with a written routing test list, re-run after every instruction change.

### 2. Reuse the existing MCP server, add an endpoint

**Chosen:** a second, help-desk-only endpoint on the server from the MCP series.
**Rejected:** a separate service for help desk tools.
**Why:** same network routes to SAP and SQL, same deployment pipeline, same logging — and the endpoint boundary guarantees the agent can never reach the data analysis tools.

### 3. Custom OAuth identity passthrough, not a service account

**Chosen:** every tool call carries the user's own token.
**Rejected:** the agent calling tools with one application identity and passing the user's name as a parameter.
**Why:** a model can be talked into passing someone else's name; it cannot forge a token. Authorization becomes an Entra role check instead of an instruction I hope the model follows.

### 4. Logic Apps for humans-in-the-loop

**Chosen:** Logic Apps for Teams cards and multi-day waits, with all rules in the server.
**Rejected:** approval logic inside the Logic App designer.
**Why:** rules in code are unit-tested and versioned in git; the Logic App is reduced to a transport that can be rebuilt from its exported definition.

### 5. Copilot Chat over a Teams chat

**Chosen:** Copilot Chat as the entry point.
**Rejected:** building my own Teams bridge again to control conversation length.
**Why:** that would bring back exactly the custom code this project removed. A platform button is cheaper than a platform workaround.

---

## Lessons Learned

1. **Read the traces before blaming the model.** "Slow" turned out to be history growth plus a rate limit — both visible in token counts, neither a model problem.
2. **Measure tokens per request early.** Duplicate tool results and an over-long instruction paste each added cost to every single call; both were invisible until I looked.
3. **Managed platforms move the trade-offs, they don't remove them.** I gave up control over conversation length in exchange for not running a bot. That trade was worth it, but only because Copilot Chat offered a way out.
4. **Put authorization in Entra.** App roles assigned to groups made "who can do what" an administrator task and removed every hard-coded list from the code.
5. **Keep the human-in-the-loop dumb.** The less logic lives in the Logic App designer, the safer it is to rebuild.

---

## Open Issues

- **Conversation reset in Teams.** Until Microsoft adds an idle reset, a length limit or an administrative reset for published agents, Teams users must type `/foundry_new_preview`. I will revisit promoting Teams if that changes.
- **First sign-in.** On some users' first use the sign-in card reports an error, yet clicking **Resume** continues and the agent works. Admin consent is already granted; I am collecting correlation IDs to trace it in the Entra sign-in logs.

---

## Next Steps

[Part 2](ai-foundry-agent-part2.md) walks through the build in order:

- Creating the app registration, roles and group assignments
- Deploying the model and sizing its rate limit
- Connecting Foundry to the MCP server with OAuth identity passthrough
- Designing safe tools (two-step actions, write switches, repeat protection)
- Building the SAP password and phone request Logic Apps
- Indexing the policy documents and writing versioned instructions
- Publishing to Teams and Copilot, monitoring, and the go-live checklist

---

## References

* [Building an Enterprise Multi-Agent AI System with Microsoft Teams](ai-multi-agent.md) — the custom architecture this series replaces
* [Data Analysis with LLM via MCP Server — Part 1](ai-claude-mcp-analytic-server-part1.md) — the MCP server the help desk endpoint is added to
* [Setup PyRFC in your Container](sap-rfc-python-container.md) — the SAP RFC connector behind the password reset
* [Microsoft Learn — Set up authentication for MCP tools in Foundry Agent Service](https://learn.microsoft.com/azure/foundry/agents/how-to/mcp-authentication)
* [Microsoft Learn — Troubleshoot publishing agents to Microsoft Copilot and Microsoft Teams](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/troubleshoot-publish-copilot)
* [Model Context Protocol](https://modelcontextprotocol.io/)

---

*This article documents a production implementation. Names, identifiers and tenant-specific values have been removed or generalized.*
