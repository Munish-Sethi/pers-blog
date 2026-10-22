---
description: Part 2 - step-by-step build of an Azure AI Foundry help desk agent - Entra app roles, OAuth identity passthrough to an MCP server, SAP reset tools, Logic Apps and Copilot publishing.
---

# From a Custom Multi-Agent Bot to Azure AI Foundry: An Enterprise IT Help Desk Agent
## Part 2: Step-by-Step Build

---

### 📚 **Series Navigation**
- Background: [Building an Enterprise Multi-Agent AI System with Microsoft Teams](ai-multi-agent.md)
- [Part 1: Architecture, Components and Why I Moved](ai-foundry-agent-part1.md)
- **Part 2: Step-by-Step Build** *(Current)*

*This is Part 2 of a two-part series. [Part 1](ai-foundry-agent-part1.md) explains the architecture and why I replaced my custom multi-agent Teams bot with an Azure AI Foundry agent. This part walks through the build in the order I did it. It describes every setting and decision, but deliberately contains no commands, subscription IDs, application IDs or tenant-specific values — wherever one would appear, it is described by its shape instead.*

---

## Overview

The build has four layers, and the order matters because each one depends on the one before it:

| Layer | Steps | Result |
|---|---|---|
| Identity | 1–2 | An app registration with roles that every token carries |
| AI platform | 3 | A Foundry project with a model deployment sized for real use |
| Tools | 4–10 | An authenticated MCP endpoint, proven locally, with safe tools and two Logic Apps |
| Agent and users | 11–16 | Knowledge, instructions, monitoring, publishing, troubleshooting and go-live |

**Prerequisites:**

- An existing MCP server you control (mine is the one from the [MCP Analytic Server series](ai-claude-mcp-analytic-server-part1.md)), deployed as a container with HTTPS in front of it
- Permission to create app registrations and grant admin consent in Entra ID
- An Azure subscription where you can create Azure AI Foundry, Azure AI Search, Logic Apps and Application Insights resources
- The back-end systems your tools call — in my case SAP ECC over RFC (see [Setup PyRFC in your Container](sap-rfc-python-container.md)), the ServiceDesk Plus API and an HR/identity view in SQL Server
- A Key Vault for every secret
- A Teams service account for the Logic Apps' Teams connection (it sends the cards)

---

## Step 1: Plan Names and a Single Resource Group

Before creating anything I agreed on names for every resource and created **one dedicated resource group** for everything the agent needs: the Foundry resource and project, the model deployment, the AI Search service, the Logic Apps and the monitoring resources.

**Why:** cost, access and clean-up all become one scope. A budget on the resource group *is* the agent's budget, and anyone reviewing the solution sees all of it in one place.

Two names deserve extra thought because they are hard to change later:

- **The MCP tool connection in Foundry** — each user's consent is tied to the connection name; renaming it means every user consents again.
- **The published agent's name** — it becomes the app name users see in Teams and Copilot.

---

## Step 2: Create the Entra App Registration and App Roles

One app registration represents the MCP server. Every token the server accepts is issued *for* this app, and every permission is defined on it.

### 2.1 Register the app and expose an API

- Single tenant.
- **Expose an API** with an application ID URI, and add one delegated scope (I named it `access_as_user`) that only an administrator can consent to.
- Set the app to issue **v2 tokens** so the issuer and claims are predictable for validation.

### 2.2 Create the app roles

| Role value | Allowed member types | Purpose |
|---|---|---|
| `MCP.User` | Users/Groups | Data analysis tools on the existing `/mcp` endpoint |
| `HelpDesk.User` | Users/Groups | Self-service help desk tools |
| `HelpDesk.PowerUser` | Users/Groups | Help desk staff: act on behalf of other users |
| `HelpDesk.Workflow` | **Applications only** | Logic App managed identities calling back into the server |

The code treats `HelpDesk.PowerUser` as including everything `HelpDesk.User` can do, so a power user does not also have to be in an employee group.

### 2.3 Assign roles to groups, then require assignment

1. In **Enterprise applications**, assign each role to its groups (employee groups → `HelpDesk.User`, help desk support group → `HelpDesk.PowerUser`, analyst groups → `MCP.User`).
2. Only then set **Assignment required = Yes**. Doing it in the other order locks everyone out for a moment.

Two details that caught me:

- **Only direct group members receive a role.** Nested groups do not pass it on, so check the groups you assign are flat.
- **Administrator accounts.** If an admin account ends up in an employee group it gets a help desk role. I keep admin accounts out of those groups and plan a Conditional Access policy as a second line of defense.

### 2.4 Secrets — one per consumer

The same app has two confidential clients: the server's own sign-in proxy (for Claude) and the Foundry connection. Each gets **its own client secret**, stored in Key Vault with its **expiry date set on the Key Vault secret** and a calendar reminder before it. Rotating one never breaks the other.

### 2.5 Redirect URIs and admin consent

Redirect URIs are added only when they are known: the server's own callback for the sign-in proxy, and later the URL Foundry generates for its connection (Step 6). Finally, **grant admin consent** for the scope so employees are never asked to approve permissions themselves.

---

## Step 3: Create the Foundry Project and Deploy the Model

### 3.1 Resource and project

Create an Azure AI Foundry resource and a project inside the resource group from Step 1, in a region where the model you want is available.

### 3.2 Choose and deploy the model

My selection criteria:

- **Generally available** only — no previews for something employees depend on.
- **Furthest retirement date** among the candidates.
- **Built for tool orchestration** — the help desk is mostly "pick the right tool, fill its parameters, explain the result", not deep reasoning.

Deploy it as **Data Zone Standard (US)** if, like mine, the prompts contain personal data that should be processed in the US. The price difference to Global was about 10%.

### 3.3 Size the rate limit

The deployment's **tokens-per-minute (TPM)** value is a *rate limit*, not a cost — you still pay only per token used. I started at 50K TPM and my routing tests hit `exceeded token rate limit` once conversations grew. Before go-live I raised it to 250K, within the region's quota. Check the quota page for the region first; the limit you can set is capped by it.

---

## Step 4: Add a Help Desk Endpoint to the MCP Server

### 4.1 A separate endpoint per audience

The existing server keeps `/mcp` for the data analysis tools (Claude Desktop and claude.ai). A new endpoint, `/helpdesk/mcp`, exposes **only** the help desk tools. Both run in the same container and share code, but the agent can never see a data analysis tool, and Claude users can never see a help desk tool.

### 4.2 Validate the token on every request

The help desk endpoint validates Entra v2 tokens directly: issuer (your tenant), audience (the app from Step 2), the delegated scope, signature and expiry. Then it reads the user's object ID and roles from the token and refuses guests using the account-type claim.

### 4.3 Design rules for every tool

These rules are what make it safe to let a language model call business systems:

1. **Identity comes from the token, never from the model.** No tool takes a "user" parameter. A shared helper resolves the caller from the token's object ID against the HR/identity view.
2. **No model approves or executes a sensitive action.** The model collects intent; deterministic code decides.
3. **Passwords never pass through the chat, the model or the logs.**
4. **Every action is audited** — who, what, when, result.
5. **External systems fail closed** — timeouts, limited retries, a fixed friendly message, never raw exception text.
6. **Secrets live in Key Vault**; the only bootstrap credential is a secure environment variable on the container.

### 4.4 Register the full tool list early

I registered every planned tool on day one, with unfinished ones as **stubs** returning a friendly "not available yet". That let me write the agent instructions and test *routing* — do different phrasings reach the right tool? — before the tools existed. A role-aware **capabilities tool** tells each user what *they* can do, so the list never has to be maintained in the instructions.

### 4.5 Configuration by deployment, not image

Every switch is an environment variable set by the deployment, never baked into the image — one image runs everywhere. The most important ones are **write switches**: the SAP reset, ticket creation and phone requests each do nothing unless their switch is exactly `true`. Development and test environments leave them off, so no test can change anything by accident.

### 4.6 Return tool results once

By default my MCP library returned each tool result twice — as text and as a structured copy — and Foundry passed both to the model. Returning text only (and declaring no output schema) cut the token count of every tool reply. It is worth checking in your first trace.

---

## Step 5: Prove Identity Passthrough Locally

Before deploying anything, I ran the new endpoint in my development container behind a temporary HTTPS tunnel and connected a test Foundry agent to it. One tool mattered: **"who am I"** — it returns the caller's name and roles from the token.

What this proved before any real tool was written:

- Foundry really sends the user's token, as a bearer token, to a custom MCP server
- The audience, scope and roles arrive as expected
- Guest and no-role accounts are refused by the server, not just by Entra

Log the **shape** of the incoming authorization header while testing — never the token itself.

---

## Step 6: Connect Foundry to the MCP Server

In the Foundry project, add an **MCP tool** to the agent with a **custom OAuth** connection. Managed OAuth with a Microsoft audience is blocked for custom MCP servers, so custom OAuth with your own app registration is the supported path.

The connection needs:

| Field | Value (shape) |
|---|---|
| Client ID / secret | The app from Step 2 and its Foundry-only secret |
| Authorization URL | Your tenant's v2 `authorize` endpoint |
| Token and refresh URL | Your tenant's v2 `token` endpoint |
| Scopes | `api://<your app>/access_as_user offline_access` — `offline_access` is required for refresh tokens |
| Server URL | `https://<your host>/helpdesk/mcp` |

After saving, Foundry shows a **redirect URL**. Add it to the app registration as a Web redirect URI. Each user then signs in once per connection; Foundry keeps their token and refreshes it.

In the tool settings, list the allowed tools and set them to run **without approval prompts** — the safety comes from the tools' own two-step design, not from the user clicking "approve" on a raw tool call.

---

## Step 7: Build the SAP Password Reset Safely

I built this against **SAP production**, so the sequence was designed so that a mistake could not reset the wrong account.

### 7.1 Read-only first

The first tool, *request reset*, only reads the SAP user (`BAPI_USER_GET_DETAIL`) and runs every check. It was built and tested — including every refusal — before any write code existed.

### 7.2 Checks, in order, before anything changes

| Check | Refusal |
|---|---|
| Caller has an SAP login (self-service) | "You don't have an SAP login linked to your account" |
| Account exists | Not found |
| Account is a **Dialog** user | Service and technical accounts are never reset |
| Not locked by an administrator or centrally | Protects leavers from being reactivated |
| Account has an owner in the directory | Nobody to deliver the password to |
| Caller may act on this account | Only power users may reset someone else's |

Each refusal has a fixed message and a reason code in the audit log.

### 7.3 Two tools and a one-time confirmation

*Request reset* returns a summary of exactly what will happen (account, unlock yes/no, validity change) and a **one-time confirmation code** bound to the caller, the account and the mode, valid for five minutes and usable once. The agent shows the summary — never the code — and asks the user to reply *yes*. *Confirm reset* takes the code, re-reads SAP, re-runs every check and only then changes the password. The model cannot invent a valid code or reuse one.

### 7.4 What the reset does

One reset sets a new **initial** password (the user must change it at first logon), clears a wrong-password lock and extends the validity date if it is about to expire — never shortening it.

### 7.5 Owner-only delivery

The new password goes **only to the account owner**, in a private Teams message (Step 8). When a power user resets someone else's account, the power user sees every detail except the password. This is what makes it safe for help desk staff to reset even administrator accounts: whoever requests the reset never learns the password.

### 7.6 Guard rails while testing

- The write switch from Step 4 stays off except during a supervised test.
- A **test-account allowlist** limits writes to one named account while it is set.
- Automated tests use a fake SAP; the real write test was run by hand, once, on my own account.

---

## Step 8: Build the SAP Password Delivery Logic App

A Consumption Logic App with one HTTP trigger delivers the password card.

### 8.1 Secure the trigger

- **OAuth authorization policy** on the Logic App: accepts only tokens issued by your tenant for a dedicated "MCP server → Logic Apps" app registration (checked by audience and the calling app's ID).
- **Trigger condition** that the request carries a bearer token — so the SAS-signed URL alone can no longer start it.
- **Regenerate the trigger's access keys** after setting this up and never store the SAS signature anywhere; the server keeps only the URL without the signature.
- **Secure inputs and outputs** on the trigger and on the Teams action, so run history never shows the password.

### 8.2 The card

An Adaptive Card posted by the Flow bot in a private chat with the account owner: account, who requested it, when, unlocked yes/no, valid until — and the password in a **hidden block** behind a *Show / hide password* button, plus "IT will never ask you for your password".

### 8.3 Report the result synchronously

The Logic App answers **200 delivered** or **502 not delivered** and fails the run in the second case. The server tells the user the truth: "reset, but the message could not be delivered — ask again in a few minutes" instead of pretending it worked.

### 8.4 Keep the definition in git

I export the code view into the repository with placeholders instead of subscription IDs. The Logic App can then be rebuilt from git rather than from memory.

---

## Step 9: Add the Service Desk Tools

- **List my tickets** and **ticket status** — available to everyone; the requester is always the token user, and a status lookup for someone else's ticket returns "not found".
- **Create a ticket** — power users only at first, with the field values the service desk team already uses, behind its own write switch.
- No fallback "default requester": if the user cannot be resolved, the tool says the service desk is unavailable.

---

## Step 10: Build Phone Requests

Phone requests show the full pattern: rules in the server, waiting in a Logic App.

### 10.1 Rules in the server

| Requester | For whom | Manager approval |
|---|---|---|
| Any employee | Themselves | Yes |
| Manager | Direct reports | Skipped — the manager is the approver |
| Power user | Anyone | Yes (the target's manager) |

Leaver requests can only be raised by managers and power users. An open request for the same person and type blocks a duplicate, and a repeated submit within minutes returns the existing request instead of a second one.

### 10.2 The server is the only writer

Each request is a JSON record on the file share the container already mounts: who, for whom, type, model, and a history entry per step. The allowed phone models are a small JSON file on the same share, editable without a redeploy.

### 10.3 The Logic App waits and reports back

On *start*, the Logic App answers immediately, posts the approval card to the manager and **waits** (up to the Consumption limit of 90 days). After approval it posts a *Done* card to the phone administrator and waits again. Every answer is sent to a **callback endpoint** on the server, which updates the record and replies whether the workflow should continue — a request cancelled in the meantime stops the run.

### 10.4 Callbacks with a managed identity

The Logic App's **system-assigned managed identity** is granted the `HelpDesk.Workflow` app role from Step 2. Its token proves "this is the workflow", with no secret stored anywhere. The server accepts callbacks only from tokens carrying that role.

### 10.5 Never save it from the designer

The designer does not display the card bodies on the *Post adaptive card and wait for a response* actions, and saving from the designer can strip them. I change the JSON in git and paste it into **code view** only.

---

## Step 11: Add the Policy Knowledge

### 11.1 Why Azure AI Search

I planned to upload the policy PDFs to the agent's **File search** tool. In the tool picker it was disabled — *"This tool doesn't work with the model you selected."* The **SharePoint tool** was not an option either: it needs Microsoft 365 Copilot licensing and is not supported once the agent is published to Teams. That left an **Azure AI Search** index I control.

### 11.2 Build the index

- One Basic-tier AI Search service in the agent's resource group (the preferred region had no capacity that day — it is fine for it to live in a neighbouring region).
- Each document is copied under a short, consistent upload name and listed in a manifest in git: upload name, title with policy number, original file name, library and SharePoint URL.
- A loader extracts text, chunks it, embeds it and upserts it into the index — merge-or-upload, never recreate — and runs a verification query per document afterwards.

### 11.3 Link answers to the real document

The agent cites the indexed document, and the instructions contain a list mapping each upload name to its **SharePoint URL**, so every answer ends with a link to the authoritative copy. When a policy is added, the index, the manifest and the link list change together.

---

## Step 12: Write and Version the Instructions

- **Git is the source of truth.** The instructions live in a Markdown file with a fenced instruction block, a change log and a routing test list.
- **Paste only the fenced block.** Once I pasted the entire file by mistake; every request carried several thousand extra tokens until the next version.
- **Every save is a version.** I record the Foundry version number in the change log row, so git and Foundry can always be matched — and rolling back is choosing an older version.
- **Scope is explicit.** The agent helps with its tools, the policy documents and common workplace IT troubleshooting; everything else is politely declined.
- **Routing tests after every change.** A list of varied phrasings per capability, plus off-topic prompts, each with the expected tool. New chat every few questions, so history does not distort the results.

---

## Step 13: Turn On Monitoring

### 13.1 Tracing

Create **Application Insights** backed by a **Log Analytics workspace** and connect it to the Foundry project. Each agent run then appears as a trace with every model call, tool call, argument, result and token count.

Two practical notes:

- Viewing traces needs Azure **monitoring permissions** on the Application Insights resource — an Entra admin role is not enough on its own. Grant the project's managed identity *Monitoring Reader* as well, as the portal suggests.
- In Log Analytics, agent runs are stored in the **AppDependencies** table, named after the agent and its version.

### 13.2 Alert and budget

- A **log alert** on failed agent runs (three or more in 15 minutes, evaluated every 5 minutes) sending email through an action group.
- A **budget** on the resource group with alerts at 80% of actual and 100% of forecast spend.

---

## Step 14: Publish to Teams and Microsoft 365 Copilot

1. In Foundry, publish the agent as an **Agent Application**. This creates the bot and a Teams app package covering Teams, Microsoft 365 and Copilot. The bot name is generated and cannot be overridden — the display name and icons can.
2. In the Teams admin center, set the app's **availability** to the groups that should see it. I started with the help desk power user group plus one non-power tester, and switched to the employee groups at go-live — the same groups that hold `HelpDesk.User`.
3. Make sure the **Workflows** app (which delivers the Logic Apps' cards) is available to everyone. It does not need to be installed in advance — it opens a chat the first time it posts a card.
4. Tell users to open the agent in **Microsoft 365 Copilot Chat** and use *New chat* for each new question (Part 1 explains why).

Tenants that have moved to app-centric management configure availability on the app itself; the older permission policies no longer apply.

---

## Step 15: Troubleshoot With Traces

When something feels slow or wrong, the trace list answers most questions:

| Symptom | What to look at | What it meant for me |
|---|---|---|
| Slow answers, growing over time | **Tokens (In)** for the same question | History growth: ~7,500 fresh vs ~30,000 in a day-old Teams chat |
| `exceeded token rate limit` | Tokens (In) × requests per minute vs the TPM limit | Long conversations hit the limit; raise TPM and start new chats |
| Wrong answer | Which tool was called, with which arguments | Wrong tool = instructions/model; wrong data from the right tool = code |
| Tool failure | The tool step's output and the server log at the same time | Server-side problems show up in the server log, not the model |

The same question asked in a fresh conversation is the best baseline to compare against.

---

## Step 16: Go-Live Checklist

| Item | Check |
|---|---|
| Write switches | SAP reset, ticket creation and phone requests set to `true` in the production deployment |
| Test overrides | Test-account allowlist and test approver/admin overrides **removed** |
| Phone administrator | Set to the real person |
| Model list | Phone models file reviewed by the phone administrator |
| Secrets | Expiry dates set in Key Vault, renewal reminder in the calendar |
| Instructions | Active version matches the change log in git |
| Monitoring | Failed-run alert and budget active |
| Availability | Employee groups added; test individuals removed |
| UAT | Every capability tested in Copilot Chat by a regular employee, including one without a Copilot license |
| Communication | Soft release: no announcement; help desk staff briefed |

---

## Lessons Learned

1. **Prove identity first.** A one-tool "who am I" endpoint answered the hardest question — does the user's token really reach my server? — before any real work was done.
2. **Stubs make routing testable early.** Testing phrasings against stub tools found instruction problems while they were still cheap to fix.
3. **Build destructive tools read-only first, with a switch.** Every refusal path was proven before the write path existed, and the switch meant no test could ever change production by accident.
4. **The tool picker is the real compatibility list.** File search not supporting my model and the SharePoint tool not supporting Teams only became clear in the portal — check before designing around a tool.
5. **Keep everything rebuildable from git.** Instructions, Logic App definitions and the knowledge manifest all live in the repository; the portals are deployment targets, not the source of truth.

---

## Summary

| Step | What | Key decision |
|---|---|---|
| 1 | Names and one resource group | One scope for cost, access and clean-up |
| 2 | App registration and roles | Authorization by app role, assigned to groups |
| 3 | Foundry project and model | GA model, US Data Zone, TPM sized from tests |
| 4 | Help desk endpoint | Separate endpoint; identity from the token only |
| 5 | Local proof | "Who am I" before any real tool |
| 6 | Foundry connection | Custom OAuth identity passthrough |
| 7 | SAP reset | Read-only first, two-step confirmation, owner-only delivery |
| 8 | Password Logic App | Bearer-only trigger, secure inputs, hidden password card |
| 9 | Service desk tools | Own tickets only; create for power users |
| 10 | Phone requests | Server is the single writer; managed-identity callbacks |
| 11 | Policy knowledge | Azure AI Search with SharePoint links |
| 12 | Instructions | Git source, versioned, routing-tested |
| 13 | Monitoring | Traces, failed-run alert, budget |
| 14 | Publishing | Copilot Chat as the entry point |
| 15 | Troubleshooting | Compare tokens against a fresh conversation |
| 16 | Go-live | Switches on, test overrides off, soft release |

---

## References

* [Part 1: Architecture, Components and Why I Moved](ai-foundry-agent-part1.md)
* [Building an Enterprise Multi-Agent AI System with Microsoft Teams](ai-multi-agent.md) — the custom architecture this series replaces
* [Data Analysis with LLM via MCP Server — Part 3](ai-claude-mcp-analytic-server-part3.md) — the HTTPS/OAuth MCP server the help desk endpoint is added to
* [Setup PyRFC in your Container](sap-rfc-python-container.md) and [Calling SAP RFC Function Modules from Python](sap-rfc-python.md)
* [Microsoft Learn — Set up authentication for MCP tools in Foundry Agent Service](https://learn.microsoft.com/azure/foundry/agents/how-to/mcp-authentication)
* [Microsoft Learn — Troubleshoot publishing agents to Microsoft Copilot and Microsoft Teams](https://learn.microsoft.com/en-us/azure/foundry/agents/how-to/troubleshoot-publish-copilot)
* [Model Context Protocol](https://modelcontextprotocol.io/)

---

*This article documents a production implementation. Names, identifiers and tenant-specific values have been removed or generalized.*
