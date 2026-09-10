---
description: Why an on-premises SAP ECC system's direct SQL access makes it easier to connect an LLM/MCP server than S/4HANA Cloud's OData-only Virtual Data Model, with a real 8-hour dashboard example.
---

# SAP + AI: Did Moving to SaaS Quietly Cost Us Our Ability to Use AI on Our Own ERP Data?

## Introduction

Software vendors have spent the last decade telling customers to get off on-premises systems and onto SaaS. Lower maintenance burden, automatic upgrades, someone else's ops team on call at 3 a.m. — the pitch was good, and most of us took it. We took it too, everywhere except one system: an SAP ECC EHP8 instance our organization still runs on-premises today.

Then large language models happened, and something unexpected fell out of that decision. The on-prem SAP system — the "legacy" one, the one every vendor roadmap says to migrate off of — turned out to be the easiest ERP in our landscape to connect to an LLM. Not because ECC is technically superior. Because it still has something SaaS quietly took away: a SQL connection.

This article is about that trade-off, made concrete with a real example: a production dashboard that went from a business user's own natural-language exploration in Claude Desktop to a deployed internal tool in about eight hours, with no developer writing a single query from scratch. It also covers what the equivalent path looks like if you're on S/4HANA — public cloud, private cloud, or on-prem — because the architecture pattern is the same everywhere; only the connector changes.

**This is a companion piece, not a rebuild.** The [MCP Analytic Server series](ai-claude-mcp-analytic-server-part1.md) (Parts 1–4) already covers how to actually build the MCP server itself — stdio vs. HTTPS, OAuth via Azure Entra ID, multi-tenant business-function routing, containerized deployment behind TLS offload, and a full VS Code debugging workflow. The [OneStream financial analytics article](ai-claude-mcp-onestream-mcp-financial-analytics.md) covers the same server pattern pointed at a SaaS platform's REST API instead of a database. If you want the "how do I stand up an MCP server" mechanics, those are the articles to read — this one assumes that server already exists (Part 3's HTTPS/OAuth architecture, specifically) and focuses on something those articles didn't: what changes when the tool behind it is a read-only SQL connection into SAP ECC EHP8, and why that specific connector has turned out to be disproportionately valuable.

---

## The SaaS Bargain, Revisited

The traditional pitch for moving off on-prem ERP was never really about the database. It was about everything *around* the database — patching, upgrades, hardware refresh cycles, disaster recovery, security perimeter. All real, all worth paying for.

What rarely made it into the pitch deck: SaaS ERP vendors don't just take over the operations burden. They also take away the thing that made ad-hoc reporting possible in the first place — a live SQL connection to the tables themselves. That trade was invisible for years, but not because the need for ad-hoc queries was low. Companies pulled reports directly from transaction systems constantly, and built (or bought) entire data warehouses on top of that access precisely because the need was real and ongoing. The real bottleneck was never demand — it was that an ERP like SAP ECC has thousands of tables, and knowing what's stored where, and the business logic layered on top of it (effective-dated rows, status flags, the difference between a "confirmed" quantity and a genuinely worked one), took years to learn. That expertise lived in a small number of people — a BASIS team, a handful of senior analysts, an external consultant — which meant direct table access existed, but the ability to *use* it well was scarce and expensive. Losing that access when moving to SaaS felt cheap, because most of an organization was never in a position to exercise it directly anyway; they went through the expert, or through whatever the expert had already built.

LLMs changed that equation, not by creating a new need but by collapsing the scarce resource. The entire value of a natural-language interface over ERP data is that a business user can ask a question nobody anticipated: "which work centers had the biggest efficiency drop last month, and does it correlate with anything on the attendance side?" A pre-built report can't answer that unless someone already thought to build it, and reaching a human SAP expert to write a new one still means a ticket and a wait. An LLM that already understands the data model — the table names, the field mnemonics, the way SAP's own T-codes join underneath — paired with a live SQL connection, can answer it directly, on the first try, in seconds. What used to require years of accumulated schema knowledge is now something the LLM already knows on day one.

So the SaaS bargain, restated for the AI era: **you traded ops burden for direct access to a data model that used to require years of expertise to use well — and didn't know what that access would be worth until an LLM showed up already knowing the model.**

---

## Why On-Prem Has an Architectural Head Start (and What You Give Up in the Cloud)

The mechanics of the trade-off are worth stating precisely, because "cloud is harder" isn't a complaint about SaaS vendors being difficult — it's a direct, confirmed, and honestly reasonable consequence of how S/4HANA Cloud is designed. SAP's own documentation is explicit about it: with S/4HANA Cloud Public Edition, **RFC and database connections are not available, and neither is direct access to the tables that make up the internal SAP data model.** In their place is the Virtual Data Model — CDS views, exposed as OData services, most of which support read-only access by design.

That's not a gap SAP forgot to close. It's a deliberate governance boundary, and it exists for reasons that predate LLMs entirely (multi-tenancy, upgrade independence, a hardened API surface instead of a moving physical schema underneath it). But it has a real cost for exactly the use case this article is about:

| | On-prem ECC EHP8 (or S/4HANA private edition with RFC/DB access) | S/4HANA Cloud (any edition without direct DB access) |
|---|---|---|
| **Time to first working query** | Minutes — grant a read-only SQL login, point an MCP tool at it | Days to weeks — model a CDS view (or locate a released one), publish it as OData, configure a Communication Arrangement, get a service URL |
| **A genuinely new question from the business** | The LLM writes SQL against the schema it already has access to | If the needed field or join isn't already exposed in an existing view, **someone has to build that view first** — the LLM can't see what was never modeled |
| **Where the "thinking" happens** | At runtime — the LLM reasons over the live schema, guided by a data catalog | At design time — a developer has to anticipate the shape of the question before it's ever asked |
| **Flexibility ceiling** | Bounded by how well the LLM can reason over the schema and catalog you give it | Bounded by how many views you're willing to model and maintain ahead of time |

That middle row is the whole argument. Ad-hoc SQL access lets the LLM *be* the query planner. A pre-built CDS/OData layer means a human already had to be the query planner, ahead of time, for every shape of question someone might someday ask. The entire promise of natural-language analytics — answering the question nobody thought to ask in advance — survives on-prem intact and gets clipped on S/4HANA Cloud in direct proportion to how many views you're willing to build and keep current.

None of this means S/4HANA customers are locked out. It means the "instant, zero-modeling" version of this pattern is specific to systems where a read-only SQL account is still possible — and today, that's on-prem ECC, and (with RFC generally more available) S/4HANA private edition/RISE, more than S/4HANA public edition/GROW.

## If you're on S/4HANA — you're not out of options

The good news: the industry has converged hard on a workable answer for the cloud case, and it follows the exact same shape described below for on-prem — an MCP server, an LLM, and a catalog-driven tool-selection layer — with one piece swapped out.

- **Check the SAP Business Accelerator Hub first** (`api.sap.com`). SAP publishes a large catalog of released OData V2/V4 APIs across Finance, Logistics, HR, and more. If a standard API already covers what you need, there's no CDS modeling to do at all — point your MCP tool at the released service and go.
- **If nothing standard fits, model a custom CDS view** via the Custom CDS Views app (no ABAP required for straightforward cases) or full developer extensibility, set it to expose externally, and publish it through a Communication Arrangement. This *is* the modeling cost from the table above — real, but one-time per subject area, not per question.
- **Generic OData→MCP bridges already exist and are open source.** Projects like [`sap-odata-mcp-server`](https://github.com/GutjahrAI/sap-odata-mcp-server) (works against any SAP system with OData/Gateway enabled — ECC or S/4HANA, cloud or on-prem, no RFC SDK required) and several BTP-based bridges turn any released or custom OData service into MCP tools automatically, with schema discovery built in. You are very likely not the first person to need the specific API you're after.
- **SAP itself is building toward this natively.** SAP and Anthropic have integrated Claude into Joule, SAP's own AI assistant, via MCP — spanning S/4HANA, SuccessFactors, and Ariba. If your organization is already invested in Joule, that path may arrive with less custom engineering than building your own bridge.
- **If you run SAP Datasphere**, it's worth treating as a third front door distinct from either raw ECC or bare OData: Datasphere sits in front of S/4HANA as a data fabric/virtualization layer, and MCP servers already exist that target Datasphere's own API directly — useful if your organization has already invested in Datasphere for other reasons.

Worth being honest about what this list actually is, though: every option on it that isn't a pre-released standard API is still someone modeling a purpose-built view before the LLM can touch it — which is precisely the cost on-prem SQL access lets you skip. This isn't hypothetical. It's the same shape of work as the [OneStream article](ai-claude-mcp-onestream-mcp-financial-analytics.md)'s 12 purpose-built cube views — built specifically so the LLM had a clean, self-contained dataset to query, because the existing dashboard views couldn't be called directly via API. That build was real, proven to work well once done, and not overly complex — a few days of view design, not a multi-month project. But it was still a build, done ahead of the first question, by someone who understood the cube. A CDS view for S/4HANA is the same trade: a one-time, per-subject-area modeling cost that has to happen before the LLM has anything to query, not instead of it.

The architectural point stands regardless of which of these you pick: **the MCP server, the OAuth layer, the catalog-driven tool selection, and the LLM don't change.** Only the "data connector" tool — SQL-on-raw-tables vs. OData-on-a-published-view — changes underneath them. That's the same lesson the [OneStream article](ai-claude-mcp-onestream-mcp-financial-analytics.md) already demonstrated for a SaaS FP&A platform: build the connector once per source, and the rest of the stack is reusable.

---

## Where This Fits Next to the Data Warehouse, Not Instead of It

None of this is an argument to skip building a data warehouse, a data lake, or a BI semantic layer. Most companies of any size already have one, for good reason, and this article isn't suggesting otherwise. The point worth making is narrower: those platforms and this approach solve different problems, on different timelines, and it's worth being precise about which one an LLM is actually good at.

A data warehouse (and the OLAP/MOLAP/ROLAP cube structures typically built on top of it) exists to answer *known* questions, fast, at scale, consistently, for a wide audience — that's what the modeling, the star schemas, the pre-aggregations, the semantic layer are all for. Building that abstraction is deliberately slow and deliberately durable: someone has to decide what a "sale" means, what grain a fact table lives at, how a dimension rolls up, before anyone can ask a question against it at all. That's a feature of the design, not a flaw — it's exactly what makes the answers fast and consistent once the modeling is done.

An LLM sitting on top of a live OLTP database is solving the opposite problem: an *unknown* question, asked once, today, by one person, who needs an answer now rather than in the next sprint or the next data-model review cycle. And this is where the "why on-prem/OLTP" argument connects back to how these models actually got trained: an LLM's exposure to structured data overwhelmingly comes from transactional systems — ERPs, OLTP application schemas, normalized relational databases with foreign keys and natural business-object shapes (an order, a confirmation, a purchase order line). That's the shape of data an LLM has seen an enormous amount of, in an enormous number of contexts, which is exactly why it can walk into an unfamiliar OLTP schema and reason about it competently on the first attempt.

A star schema, a cube, or a purpose-built semantic layer is a different shape entirely — an abstraction layer specifically designed for human BI tool consumption and fast aggregation, not a naturally-occurring pattern an LLM has seen nearly as much of in training. That doesn't mean an LLM can't reason over a warehouse or a cube — it can, especially with a good semantic description or a catalog layer to lean on — but it's working with an artificial structure invented for a specific consumption pattern, not the more universal shape of "here is an entity, here is how it relates to other entities" that OLTP schemas share across almost every industry and vendor.

Put simply: **the data warehouse is where you go for the question you already knew to ask, answered the same way every time, for a thousand people. An LLM against the live OLTP source is where you go for the question nobody scoped yet, answered once, for the person asking it, right now.** They are complementary tools solving different problems on different timelines — not competitors, and not a reason to reconsider the data warehouse investment already made.

---

## Why This Works So Well for a Business Analyst, Specifically

The short version of the architecture is this: **giving Claude Desktop secure, read-only SQL access to the on-prem SAP ECC EHP8 database, via an MCP server, lets a business user prototype and validate a report against real production data — in their own words, with no SQL and no waiting on IT. Handing that validated result to Claude Code then turns it into a published, permanent dashboard that a much wider audience can use without ever touching an "LLM tool" themselves.** Everything below is what makes that first half — the business user's half — actually work in practice, not just in theory.

**The LLM already knows SAP better than most analysts do.** This is easy to undersell. SAP's data model is famously opaque — four-character table and field mnemonics (`AFRU`, `WERKS`, `VORNR`) inherited from decades-old naming conventions, spread across hundreds of interlinked tables. A business analyst does not need to know any of that. What they do know is the T-code they use every day — CO14, CO02, MB52, whatever it is for their function — and the LLM has extensive training exposure to how SAP's standard T-codes are structured, what tables and fields sit behind them, and how they typically join. That means a request phrased around a familiar T-code screen, not a table name, is usually enough for the LLM to land on the right dataset and the right join path on the first or second attempt — a kind of translation an analyst previously needed a technical consultant to do for them.

**The real quality bar isn't "does the query run," it's "does it match what people already believe."** Every function in an organization already has some manual process for these numbers today — a T-code run by hand, exported to Excel, pivoted, emailed around. That manual report is a ground truth nobody disputes, because people have been checking their own work against it for years. The single most valuable thing about doing this validation conversationally, in Claude Desktop, is that an analyst can put the LLM-generated numbers side by side with that trusted manual report and ask, in plain language, "why doesn't this match" — and get a real answer, immediately, instead of filing a ticket and waiting. That loop — generate, compare against the manual report, adjust, repeat — is what turns "a plausible SQL query" into "a number the business will actually stand behind."

The result of combining T-code fluency with direct reconciliation against existing manual reports has been, plainly, phenomenal: a report that used to take a developer one to two weeks to scope, build, and get signed off is now something a business user validates themselves, conversationally, and hands off as a finished specification the same day.

---

## The Real Example: A Dashboard Built in a Business User's Own Words

Here's what that architectural head start looks like in practice, end to end, on a real internal operations dashboard. Plant names and specific KPI figures below are masked; the collaboration mechanic and the technical decisions are exactly as they happened.

### Step 1 — Self-service discovery in Claude Desktop, against live SAP

The business stakeholder (a plant operations leader, referred to here as "the requester") has Claude Desktop configured with a custom MCP server that has **direct, read-only SQL access** to the on-prem SAP ECC EHP8 database. No IT ticket, no report-writer queue, no waiting for a developer's sprint capacity. The requester asked Claude, in plain language, for the numbers they actually manage against day to day — plant-level labor efficiency, hours by shift, top time-sink production orders, quality metrics — and iterated on the *shape* of the answer directly with the LLM until the numbers matched what they already knew to be true from the floor.

This step matters more than it looks like on paper. The requester was not writing SQL. They were validating business meaning: does "Actual Hours" mean what I think it means, does this reconcile against the number I already track by hand, is this plant filter doing what I expect. Exactly as described above, that validation leaned on the LLM's own grounding in how the relevant SAP T-codes and confirmation data are structured, checked directly against the manual, Excel-based report this function already trusted before any of this existed. That comparison surfaced real discrepancies — reconciling gaps between what SAP considers "confirmed" and what the shop floor considers a genuine, worked confirmation — that would otherwise have taken a developer days of independent SAP investigation to find. That validation loop, run by the person who actually owns the metric, is the single most valuable part of the whole process — and it happened entirely outside of engineering, before a single line of production code existed.

### Step 2 — Handoff via a single Markdown file

Once the requester was satisfied the numbers were right, Claude Desktop's own conversation summarization produced a portable Markdown brief: the validated SQL, the business logic behind each figure, the filters that mattered, open questions still to resolve. That file — not a verbal description, not a vague feature request — was the handoff artifact.

This is worth calling out explicitly: the brief functioned as a contract between two different AI-assisted workflows. The business user's LLM (Claude Desktop) had already done the hard part — translating "what does the plant manager actually mean by efficiency" into working SQL against real table structures. The engineer's LLM (Claude Code, in this repository) never had to re-derive that from scratch. It started from validated logic, not a blank page.

### Step 3 — Production build in Claude Code, same day

From that Markdown brief, the production dashboard was built directly in this codebase, following the project's own established conventions for a new dashboard: a dedicated Python module for query logic and HTML rendering, new Flask routes, a navigation menu entry, and the shared house style (a fixed color theme, consistent error-handling instrumentation, per-page usage logging). None of that scaffolding had to be invented for this dashboard — it's the same shape every dashboard in this system follows, which is most of why the turnaround was measured in hours rather than days.

One design decision is worth walking through specifically, because it's the kind of judgment call that separates "porting a prototype" from "engineering a production system": **whether the dashboard should query SAP live on every page load, or read from a periodically refreshed snapshot.**

The project's standing rule is a simple performance gate: time the validated queries against production SAP first. Under roughly ten seconds combined, serve live on every request — simplest possible architecture, always-current data, nothing to keep in sync. Over that threshold, stop and choose a deliberate fallback instead of quietly shipping a slow page: a nightly extract to a flat file, a nightly structured snapshot, or an in-memory cache with a refresh interval. For this dashboard, the validated queries came back comfortably under the threshold, so it ships as live SQL on every request — no intermediate cache, no staleness to reason about, and the data a user sees is exactly what's in SAP at that moment.

That threshold decision isn't a detail to skip past. It's the difference between a dashboard that quietly becomes unusable as data volume grows and one that was engineered, from day one, to fail loudly and get a deliberate answer instead.

### What this collaboration model actually proves

Strip away the specific dashboard and the pattern generalizes cleanly:

1. A subject-matter expert validates business logic conversationally, against live data and against the manual report they already trust, with zero SQL literacy required.
2. The validated logic transfers to engineering as a durable artifact — a file, not a memory — so nothing gets lost or reinterpreted in translation.
3. Engineering's job shrinks to "wrap this already-correct logic in the house's production conventions" rather than "figure out what the business actually wants and whether the numbers are right."
4. The output is a published artifact — a dashboard, a report, a downloadable file — that the rest of the organization consumes exactly like any other internal tool. Nobody who views the finished result needs a Claude Desktop seat, an MCP connection, or any familiarity with "LLM tools" at all. The AI does the discovery and validation work once; everyone else just gets the answer.

That compression — from a business question to a validated, production-deployed answer in the space of a single working day — is the actual headline here. The AI-to-AI handoff is what makes it possible; the read-only SQL connection to SAP ECC is what makes the first half of that handoff a matter of minutes instead of a multi-week CDS-modeling exercise.

---

## Closing Thought

None of this is an argument against S/4HANA or SaaS ERP generally — the operational case for moving off on-prem infrastructure is as strong as it ever was, and this article isn't the venue to relitigate it. It's an argument for going into that migration with eyes open about one specific, under-discussed cost: the natural-language, ask-anything layer that LLMs make possible is measurably easier to build against a system that still allows a read-only SQL connection than one that requires every question to be modeled in advance.

If you're already on S/4HANA, that cost isn't a dead end — it's a known, well-trodden path (OData, CDS views, the SAP Business Accelerator Hub, or a bridge someone already open-sourced), just a path with more upfront modeling than a SQL grant. If you're still on-prem, or on a private edition with RFC/DB access intact, it's worth recognizing that as a genuine, if temporary, advantage — and using it, before the next platform migration takes it away.

---

## References

* [MCP Analytic Server series, Parts 1–4](ai-claude-mcp-analytic-server-part1.md) — the MCP server architecture this dashboard's SQL connector pattern is built on
* [OneStream Financial Analytics via MCP](ai-claude-mcp-onestream-mcp-financial-analytics.md) — the same architecture pointed at a SaaS platform's REST API instead of a database
* [SAP Business Accelerator Hub](https://api.sap.com/) — catalog of released S/4HANA OData APIs, check here before modeling a custom CDS view
* [SAP S/4HANA Cloud — Virtual Data Model and CDS Views](https://help.sap.com/docs/SAP_S4HANA_CLOUD/c0c54048d35849128be8e872df5bea6d/8573b810511948c8a99c0672abc159aa.html) — background on why direct table access isn't available in S/4HANA Cloud
* [`sap-odata-mcp-server`](https://github.com/GutjahrAI/sap-odata-mcp-server) and similar open-source OData→MCP bridges — generic connectors for any SAP system with OData/Gateway enabled
