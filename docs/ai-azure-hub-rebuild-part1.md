---
description: "Part 1 - rebuilding a production Azure network hub as Bicep code with Claude Code: why we did it, the guardrails for letting an AI agent touch production, and the rehearsal plan."
---

# Rebuilding a Production Azure Hub with an AI Agent
## Part 1: Why We Did It, and How Far I Trusted the AI

---

### 📚 **Series Navigation**
- **Part 1: Why We Did It, and How Far I Trusted the AI** *(Current)*
- [Part 2: Rehearsal, Cutover Night and What I Would Do Again](ai-azure-hub-rebuild-part2.md)

*This two-part series documents rebuilding our production Azure network hub (SD-WAN edge, firewall pair and point-to-site VPN) as infrastructure as code, and cutting production over to it in one overnight window, working together with an AI coding agent that had real access to the subscription. Part 1 is the problem, the guardrails and the approach; [Part 2](ai-azure-hub-rebuild-part2.md) is the rehearsal and cutover night.*

---

## Introduction

Every Azure tenant that has been running for a few years has one of these: the network hub nobody wants to touch. Ours was the VNet that carries everything (site-to-site SD-WAN to every branch, the firewall pair, point-to-site VPN for remote users, and every published service), and it was built by hand, years ago, by people who no longer work here. Those published services cover the ERP, reporting dashboards and our workhorse compute, all deployed as containers. TLS is offloaded on the firewall pair, and traffic arriving on public DNS names is forwarded to the internal web servers behind it.

This series is about rebuilding that hub from scratch, as code, and cutting production over to it in a single overnight window. It is also about something I had not done before: doing the work **together with an AI coding agent** (Claude Code) that had real, certificate-based access to our Azure subscription.

The short version: it worked. The outage was just under an hour and a half, every public IP address stayed the same, and no setting on the SD-WAN side changed. But the interesting part is not the result. It is the question I had to answer before the first command ran: **how much do you let an LLM touch production, and what has to be true before you do?**

Part 1 covers the problem, the guardrails and the approach. Part 2 covers the rehearsal, the cutover night and the surprises.

---

## The Problem Statement: Three Pressures at Once

No single issue would have justified rebuilding a production hub. Three of them landing in the same year did.

### 1. Microsoft changed the Point-to-Site VPN sign-in app

Our P2S VPN gateway authenticated users through a **manually registered** "Azure VPN" enterprise application, the way the documentation said to do it a few years ago. Microsoft now provides a **Microsoft-registered** Azure VPN Client app, and the manually registered approach is being retired: no new connections since December 30, 2025, and full retirement on March 31, 2028.

Switching the audience on a live gateway means every user needs a new VPN profile, and the cutover has to be coordinated with Intune. If we were going to touch the gateway and every client anyway, I wanted to do it once.

**Worth being honest about:** there is a second, separate P2S notice, the gateway root certificate migration. My Azure administrator pointed that out during review. They are two different changes with two different deadlines, and it is easy to merge them in your head. We kept them apart.

### 2. Vendors retire VM sizes, and Azure constrains what you can pick

Both network virtual appliances in the hub are third-party marketplace images, and both vendors had moved on:

| Appliance | What we had | What the vendor now says |
|---|---|---|
| SD-WAN edge (Meraki vMX, medium) | `F4s_v2`-class size | Vendor KB recommends **Standard_D4_v5**; F4s_v2 is deprecated, and Microsoft retires the Fsv2 series on November 15, 2028 |
| Firewall pair (FortiGate, HA) | Deployed from a **2019 marketplace plan**, Gen1 image | The newest 7.6 images only exist on a newer **Gen2** plan; the old Gen1 plan stops at 7.6.0 |

You cannot resize a marketplace managed application in place, and you cannot switch a running VM from a Gen1 to a Gen2 image. "Upgrade" meant "redeploy", and redeploying network appliances in a production hub is exactly the kind of change that needs a plan, not a weekend.

### 3. Governance debt

The old hub worked. It just was not governed:

- **Names from four different eras:** `COMPANY_VNET_…`-style names with underscores, portal-generated names like `Company-<random>-NSG`, vendor defaults, and a few that followed our current naming convention.
- **One resource group for everything:** firewalls, load balancers, the VPN gateway and the VNet all sat in one RG named after the firewall vendor.
- **No infrastructure as code.** Nothing could be rebuilt from a repository, which also meant our **disaster-recovery region had nothing to deploy from**.
- **A secret in plain text:** the SD-WAN registration token was visible in the managed application's parameters, and a copy had been committed to an older Bicep file.

That last bullet is the one that turned "should" into "must". A DR plan that says "rebuild the hub by hand from screenshots" is not a DR plan. (Our [backup-based DR approach](azure-bcpdr-part1.md) depends on exactly this layer existing as code.)

**Put simply:** we needed the hub as code anyway (for DR), the appliances needed redeploying anyway (vendor sizes and images), and every VPN client needed a new profile anyway (Microsoft's app change). Doing all three as one governed rebuild was cheaper than doing them one at a time.

---

## Why an AI Agent, and Why That Was the Hard Decision

I have written before about letting LLMs **read** enterprise data through [MCP servers](ai-claude-mcp-analytic-server-part1.md), and about building an [IT dashboard in a week with an LLM](it-dashboard-build-vs-buy-part1.md). Read-only access with a clear audit trail is a comfortable place to be. This was different. Building and cutting over a hub means **creating, modifying and eventually deleting production network resources**.

The work itself suits an agent well:

- **Discovery at scale:** exporting every VNet, subnet, peering, NIC, load balancer rule, route table and lock, then diffing exports over time.
- **Writing Bicep** that reproduces an existing environment exactly, then proving it with `what-if`.
- **Comparing large configurations:** two firewall configs of 20,000+ lines each, side by side, with secrets masked.
- **Runbooks:** turning a plan into a step-by-step Excel runbook with formula-driven timings and a rollback deadline.

The risk is equally obvious. An agent with contributor rights that misreads one resource ID can delete the wrong thing, and it will report the mistake in the same confident tone as a success.

So before the first command ran, I wrote down the rules.

---

## The Guardrails: What I Allowed and What I Did Not

These are not best practices from a vendor slide. They are the actual rules we worked under for two weeks, several of them added after something went wrong.

| Rule | Why |
|---|---|
| **Read-only by default.** The first phase was discovery only: "do not make any changes". | You cannot plan a rebuild you have not measured. It also let me watch how the agent worked before giving it anything more. |
| **Every create, modify or delete needs my explicit approval, per action**, and every deployment is preceded by a `what-if` that I approve separately. | Approval in one context does not carry over to the next. "Approved stage 2" never meant "approved stage 3". |
| **Any change after an approval goes back for approval.** | Added after the agent fixed a template validation error and deployed without asking again. More on that below. |
| **All deletions are manual, by me, in the portal.** The agent prepares the inventory and checks the result. | Deletes are the one thing you cannot what-if your way out of. |
| **Locks are manual too.** The service principal did not have `locks/write`, and I kept it that way. | A guardrail the agent cannot remove is worth more than one it promises not to remove. |
| **The production region and the test region are never connected.** No peering, no VPN, nothing. | A rehearsal that can reach production is not a rehearsal. |
| **No secrets in the repository or in chat.** Certificates, firewall backups, VPN profiles and SD-WAN snapshots live in git-ignored folders. Tokens are pasted by me into Key Vault, never into the conversation. | The agent can be careful; the transcript is still a log. |
| **The SD-WAN API key is read-write, but the script can only send GET.** | The snapshot script has no code path for POST, PUT or DELETE. I trusted the code, not the intention. |
| **One step at a time.** For every manual step, the agent gives me exactly one instruction and waits for the result. | Long instruction lists are how steps get skipped at 3 a.m. |

### How the access actually worked

The agent never held a standing credential. It authenticated as a service principal with a certificate: convert the PFX to a temporary PEM, sign in, run the command, delete the PEM, sign out, all in one foreground command chain. Long deployments were started with `--no-wait` and polled with fresh, short sign-ins.

That sounds fussy. It came from a real lapse: in one early run the cleanup trap did not fire and the PEM stayed on disk longer than intended. The rule since then has been "delete it right after use, then **check** that it is gone", not "trust the trap".

---

## Where the AI Got It Wrong (and Why That Builds Trust Rather Than Destroying It)

I want to be specific, because "the AI made mistakes" is useless without the detail.

**1. It deployed after a fix without asking again.** We had approved a stage of the build. Validation failed on a duplicate module deployment name; the agent fixed the name in the template and redeployed. Technically correct, procedurally wrong: the template I approved was no longer the template being deployed. My reaction at the time, verbatim: _"East is current production so we definitely need to be very careful and get my approval."_ The rule "any change after an approval goes back for approval" exists because of that moment, and it was never broken again.

**2. It printed encrypted secrets in a diff.** Comparing two firewall configs, the first version of the diff showed encrypted key blobs. They were encrypted, not plain text, but they should never have reached the screen. The agent flagged it itself, and the comparison script now masks anything that looks like `ENC`, a certificate or a key before printing.

**3. It assigned work to the wrong people.** The first draft of the runbook had my Azure administrator performing manual steps. In our setup, I do every manual change and the other admins **review and verify**. The agent had assumed a common pattern instead of asking. Corrected, and written into its memory so the next session started with it.

**4. It was confidently wrong about the network once.** When the new firewalls showed missing security subscriptions, the agent explained it as "no internet by design in the isolated hub". My firewall administrator disagreed. The agent re-read its own Bicep, found that the pre-build load balancer rules **did** provide outbound access, and corrected itself plainly ("the firewall administrator is right"). The real cause turned out to be something else entirely: the firewall serial numbers had never been registered.

**5. It trusted its own records over the live system.** Our notes said the new firewalls ran the same firmware as production. The firewall administrator said otherwise. The firewall was right; it had been upgraded a few days earlier, and nobody had recorded it. That one came back to bite us on cutover night (Part 2).

Here is why none of this made me stop: **every one of these was caught by a guardrail, a reviewer or the agent itself before it caused damage**, and every one produced a new rule rather than an apology. That is the difference between an agent you can work with and one you cannot. It is not that it never errs; it is that the errors are visible, small and reversible.

And the trust ran both ways. Two days after cutover I was about to remove the user assignment from the old VPN enterprise app. The agent stopped me first: **both apps had the same display name, "Azure VPN"**, and both had the same group assigned. It pulled both application IDs read-only from Microsoft Graph and asked me to check the Overview page before clicking. Removing the assignment from the wrong one would have locked every remote user out of the VPN we had just gone live with.

---

## The Approach: Build Beside, Rehearse Elsewhere, Cut Over Once

With the rules in place, the plan had four parts.

### Discovery (read-only)

A script exported the full network estate to JSON: VNets, peerings, NICs, load balancers, public IPs, NSGs, route tables, gateways, managed applications and locks. From that the agent generated the Bicep configuration (address spaces, subnets, all 15 load balancer rules, NSG rules, route tables) so the new hub would be a faithful copy, not a reinterpretation.

**Key decision:** the new hub uses the **same address space** as the old one. Overlapping VNets cannot both be peered to the spokes, so the new hub stayed completely isolated until the window. Every internal address the spokes, branches and route tables point at (the internal load balancer, the SD-WAN next hop, the firewall interfaces) would be identical on the new side.

### Build beside production, in stages

The Bicep deployment ran in five stages, each with its own what-if and approval:

| Stage | What | Impact on production |
|---|---|---|
| 1 | Hub VNet, NSGs, route tables | None (isolated) |
| 2 | Firewall pair, internal and external load balancers, a temporary public IP | None |
| 3 | P2S VPN gateway on the Microsoft-registered app | None (new gateway, new profile) |
| 4 | SD-WAN edge (managed application) | **Window only** |
| 5 | Public IPs, load balancer rules, DNS, spoke peerings | **Window only** |

Stages 1 to 3 went live days before cutover. The firewalls were upgraded and given a restored copy of the production configuration with exactly three deliberate edits (hostname, HA alias, and the admin's hardware-bound token).

**Worth being honest about:** stage 3 failed the first time. Azure requires a VPN gateway to be in the **same resource group as its VNet**, which our nicely separated RG design violated. The error was `CreateGatewayInSameResourceGroupAsGatewayVnet`, the fix was a design change, and the stray public IP and empty RG it left behind were deleted by me, by hand.

### The governed result

| | Old hub | New hub |
|---|---|---|
| VNet | `COMPANY_VNET_FIREWALL`-style name | `vnet-<org>-peus-hub` |
| Resource groups | One RG named after the firewall vendor | VNets, firewall, SD-WAN, infrastructure in separate governed RGs |
| Build | Portal, by hand | Bicep, five stages, what-if gated |
| P2S sign-in | Manually registered app | Microsoft-registered app, assignment required, Conditional Access |
| SD-WAN edge | Deprecated size, token in plain text | Vendor-recommended size, token in Key Vault |
| DR | Nothing to deploy | Same code with a different parameter file |

### Rehearse in another region

This was the part I am most glad we did. Rather than rehearse in our head, we built the **old side** too, in our DR region, which is never connected to production:

- a fake "old hub" with the same address space, 8 public IPs and a load balancer with production's 15 rules;
- five spokes peered to it, with a test VM;
- the new hub from the **same Bicep code** as production, with a parameter file for the DR region.

Then we ran the window steps for real: lock removal, load balancer deletion, moving 8 public IPs between resource groups (into a locked RG, as in production), deleting the old peerings, and the window deployment. My Azure administrator verified every setting against production screenshots, and found one peering checkbox our code got wrong. It was fixed before production ever saw it.

The rehearsal gave us the two numbers the whole runbook depended on: **the public IP move took about 5 minutes, and the window deployment about 4.**

---

## Lessons Learned (Part 1)

1. **Write the guardrails before the first command, then add to them.** The most useful rules were the ones added after something went slightly wrong.
2. **Prefer guardrails the agent cannot bypass.** Missing permissions, GET-only code, git-ignored folders and manual deletes are stronger than instructions.
3. **Approval is per action and per version.** If the template changes after you approved it, you have not approved it.
4. **Make the agent show its evidence.** Every "it's fine" came with a read-only check: an export diff, a what-if, a Graph query. When it could not show evidence, it said so.
5. **Let the humans who know the systems overrule the AI, and expect the AI to accept it.** The firewall and Azure administrators caught things the agent missed, and the agent corrected itself without arguing.
6. **Rehearse the risky mechanics somewhere that cannot touch production.** A region that is never connected is the cheapest insurance you will buy.

---

## What's Next

[Part 2](ai-azure-hub-rebuild-part2.md) covers the cutover itself: the pre-window checks that found two last-minute production changes, the window step by step, a firmware bug that only showed up after go-live, and what we would do again for the DR build.

---

## References

- [Configure P2S VPN Gateway for Microsoft Entra ID authentication: Microsoft-registered client](https://learn.microsoft.com/azure/vpn-gateway/point-to-site-entra-gateway): the new Azure VPN Client app
- [Bicep deployment what-if operation](https://learn.microsoft.com/azure/azure-resource-manager/bicep/deploy-what-if): previewing changes before deploying
- [Move Azure resources to a new resource group or subscription](https://learn.microsoft.com/azure/azure-resource-manager/management/move-resource-group-and-subscription): how the public IPs kept their addresses
- [Cisco Meraki vMX Setup Guide for Microsoft Azure](https://documentation.meraki.com/MX/MX_Installation_Guides/vMX_Setup_Guide_for_Microsoft_Azure): vMX sizing guidance
- [Claude Code](https://www.anthropic.com/claude-code): the AI coding agent used throughout
- [Retirement of the F, Fs, Fsv2, Lsv2, G, Gs, Av2, Amv2 and B-series VMs](https://learn.microsoft.com/en-us/answers/questions/5586430/retiring-f-fs-fsv2-lsv2-g-gs-av2-amv2-and-b-series)
- [Migrate a manually registered Azure VPN Client to the Microsoft-registered client](https://learn.microsoft.com/azure/vpn-gateway/point-to-site-entra-gateway-update)
- [Deploying Cisco Meraki vMX with Bicep](meraki-vm-deployment.md): my earlier vMX template (on the now-deprecated F4s_v2 size)
- [Azure BCP/DR with Backup & Restore - Part 1](azure-bcpdr-part1.md): the DR region this hub code now deploys to

---

_This article documents a production implementation. Company names, people, subscription and tenant identifiers, IP addresses and serial numbers have been removed or generalized._
