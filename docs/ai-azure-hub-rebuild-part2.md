---
description: "Part 2 - cutting production over to a new Azure hub in one night: freeze checks that caught config drift, the 15-step window, and a firmware issue found after go-live."
---

# Rebuilding a Production Azure Hub with an AI Agent
## Part 2: Rehearsal, Cutover Night and What I Would Do Again

---

### 📚 **Series Navigation**
- [Part 1: Why We Did It, and How Far I Trusted the AI](ai-azure-hub-rebuild-part1.md)
- **Part 2: Rehearsal, Cutover Night and What I Would Do Again** *(Current)*

---

## Introduction

In [Part 1](ai-azure-hub-rebuild-part1.md) I described why we rebuilt our production Azure network hub, the guardrails I put around an AI coding agent with access to the subscription, and how we built the new hub beside production and rehearsed the cutover in a region that is never connected to it.

This part is about the night itself, and about the things that surfaced only because we checked. The short version: **the checks found more than the cutover did.**

---

## The Day Before: Three Findings Nobody Expected

The day before the window was meant to be quiet. Two read-only checks turned it into the most useful day of the project.

### Finding 1: the firewalls were on a different firmware

My firewall administrator compared the new pair with production from screenshots and reported a different firmware version: the new pair was **one patch release newer** than production. Our records said both were on the same release.

The firewall was right. On the new pair, `get system status` confirmed the newer release, and the HA "cluster state change time" pointed to a reboot on a night four days earlier, inside the 02:00–04:00 automatic-upgrade window that the restored production config defines, even though automatic upgrades were switched off. We still do not know who or what triggered it.

The firewall team accepted the newer release. Remember that difference.

### Finding 2: the new firewalls were not registered

While checking the firmware, the FortiGuard page showed the new pair with **only the free services licensed**: no IPS, no antivirus contract, and signatures from 2015 and 2018. Production had everything, with signatures updated within the hour.

The agent's first explanation (no internet in the isolated hub) was wrong, as I described in Part 1. Two read-only CLI commands settled it: the firewalls reached FortiGuard fine, but their **new serial numbers had never been registered**.

**Why this matters:** without that check, the new firewalls would have gone live passing production traffic with eight-year-old antivirus signatures. The firewall administrator registered both serials under **our own** FortiCloud account the same afternoon.

This is a good example of how the findings cascaded. We work in a managed service provider environment, where a lot of the setup happens outside our direct view. We would never have noticed the registration gap if we had not been checking the firmware, and we would not have checked the firmware without a rebuild. Peeling the onion one layer at a time is what moves us toward better governance.

### Finding 3: production had changed after the freeze

At 01:00 on cutover morning, the first pre-window step was a **freeze check**: take a fresh backup of the production firewall config and compare it with the baseline the new pair was restored from.

The agent's comparison masks secrets and compares settings structurally, not line by line, because the two backup formats differ. Every object count matched (25 policies, 145 addresses, 10 VIPs, 11 static routes), except for two settings:

| Published service | Baseline (on the new pair) | Production that morning |
|---|---|---|
| Published service A | old back-end server | new back-end server |
| Published service B | old back-end server | new back-end server |

Two virtual IPs had been repointed to new back-end servers after the freeze. If we had gone live without them, **two partner-facing services would have broken at cutover**, and we would have spent the window debugging the new firewall instead of a config drift. The firewall administrator confirmed both changes were intended; I applied them to the new pair from the CLI before the window started.

> **Critical rule:** a change freeze is a promise, not a control. Check it on the morning of the window.

---

## The Window, Step by Step

The runbook had 15 window steps, each with an owner, an expected result and a read-only check by the agent before the next one started. All deletes and moves were mine, in the portal. The agent did only the two things that were scripted: the what-if and the deployment.

| Time (CST) | Step | Who | Check |
|---|---|---|---|
| 02:20 | Go decision, T0 recorded for the SD-WAN audit-log check | Team | All pre-window checks green |
| 02:20 | Remove the delete lock on the old resource group | Me | Agent: lock gone |
| 02:31 | **Delete the old SD-WAN edge, outage starts** | Me | Agent: app and managed RG gone |
| 02:33 | Delete the old external load balancer | Me | Agent: 8 public IPs detached, addresses unchanged |
| 02:43 | **Move the 8 public IPs** to the new firewall RG | Me | Agent: all 8 in the new RG, same addresses and zones |
| 02:48 | Delete the old spoke peerings | Me | Agent: no spoke peered to the old hub |
| 02:51 | Generate the SD-WAN registration token, store it in Key Vault | Me | Never pasted into chat |
| 02:52 | Collision check and **what-if** for the window deployment | Agent → I approve | 11 creates, changes only on new-hub resources, **0 deletes** |
| 02:55 | **Window deployment** | Agent | Succeeded in about 4 minutes |
| 02:59 | Azure checks: 8 frontends, 15 rules, DNS, 10 peerings, SD-WAN next hop | Agent + Azure admin | All green |
| 03:05 | Make the SD-WAN NIC address static | Me | Agent: static, same address |
| ~03:15 | SD-WAN online, all branch tunnels up, audit log and snapshot unchanged | Meraki admin + agent | Only change since T0: the token |
| ~03:45 | Functional tests: branch connectivity, ERP-related services, reporting dashboards, container workloads, internet egress | Team | All passed |
| 03:54 | **Go-live** | Team | |

**The outage was just under an hour and a half (83 minutes)**, inside the two-hour window we had communicated. Every published service kept its public IP address, so no partner had to change anything.

### Two moments worth describing

**The SD-WAN redeploy.** The edge appliance is a vendor managed application, which you cannot move or resize. We deleted it and deployed a new one on the **same dashboard record** with a fresh token. The risk was the cloud side resetting settings. The agent's verification had three independent parts: the vendor's own audit log since T0 (exactly one entry, "Generated vMX Authentication Token"), a before-and-after snapshot of the network settings (zero differences), and every branch tunnel up.

**The static IP.** Every branch route in Azure points at the SD-WAN appliance's private address. The vendor template has no parameter for it; it relies on Azure handing out the first free address in an empty subnet. Both rehearsals got the right address, and so did production. During the window, while the appliance was still booting, I switched the NIC from dynamic to static on the same address, so a future redeploy cannot silently move it.

---

## After Go-Live: The Cost of the Unexplained Upgrade

One check failed: **admin single sign-on to the new firewalls**. The login page said "Single Sign-On Failed" before ever reaching the Microsoft sign-in page.

We parked it as priority 1 instead of holding the go-live. It affected only how administrators log in to the firewall; local admin accounts worked, and traffic was unaffected. The next morning we picked it up:

1. The SAML settings on the new pair were **identical** to production.
2. With SAML debugging enabled, the SAML daemon logged **nothing**, so it never started a login at all.
3. The firewall crash log showed a security-module violation at every login attempt: the web process was blocked from writing the SAML metadata file it needs before redirecting to the identity provider.
4. The agent searched for that exact signature and matched it to a **known vendor issue in that specific patch release**, with the same crash-log entry as the vendor's documented confirmation.

So the unrecorded upgrade from Finding 1 was the root cause. The lesson is not about one vendor's bug; every vendor has them. It is that **the new pair should have matched production's exact version**, and nobody was checking.

We did not roll back. A newer major release was already available, so we moved the pair to the latest firmware instead. We treat the appliances like tin soldiers: rather than patching them from one release to the next, we line them up on the latest firmware available.

**Configuration was never the problem.** It took about fifteen minutes from "SSO is broken" to "this is a known issue in that release, here is the evidence", most of it waiting for me to copy CLI output. That is the kind of task where an agent earns its keep: reading logs carefully, searching precisely, and giving the decision back to a human.

---

## What I Would Do Again

1. **Discovery before design.** The export-and-diff approach caught drift twice: before the build and on cutover morning. Without the baseline there is nothing to compare against.
2. **Build beside, with the same address space, isolated.** Every internal address stayed the same, so route tables, branch routes and firewall rules needed no changes at all.
3. **Rehearse the mechanics in a region that can never reach production.** Moving public IPs between resource groups, into a locked RG, while keeping their addresses, is not something to try for the first time at 2 a.m.
4. **Approve every action, and approve again after every change.** It slows you down by minutes and protects you from the one change you did not read.
5. **Keep deletes human.** The agent prepared every inventory and checked every result; I clicked every delete. It was the right split.
6. **Check the vendor side, not just Azure.** Firmware, licenses, registrations and freeze compliance were all outside Azure, and all three day-before findings came from there.
7. **Write it down as you go.** The agent kept a running log of every decision, check and timestamp. This article, the runbook and the post-go-live task list were all written from it.

## What I Would Do Differently

- **Treat firmware as part of the freeze.** We froze the production config but not the new pair's firmware. Matching production's exact version, with a check on the morning of the window, would have surfaced the SSO issue days earlier.
- **Register appliances the day they are built.** The license and registration finding cost an afternoon we did not plan for.
- **Ask about roles up front.** "Who performs, who verifies?" should be the first question of any runbook, not a correction halfway through.

---

## Where This Leaves Us

- **Production runs on a governed, code-built hub.** The old hub is isolated, and its retirement (deleting the old firewalls, gateway, load balancer, VNet and the old VPN app, plus a review of routes to decommissioned sites in all four places they live) is a separate, manual phase.
- **The VPN is on Microsoft's own app**, with assignment required and a device-compliance Conditional Access policy.
- **The DR region now has something to deploy.** The same Bicep code built the production hub and the rehearsal. The next project is the DR network layer (hub, firewalls, SD-WAN edge and governed spokes), followed by restoring workloads.

And on the trust question from Part 1: I would give an AI agent this kind of access again, **under these rules**. Not because it was never wrong (Part 1 lists five times it was), but because the guardrails made every mistake small, visible and reversible, and because the agent treated each correction as a new rule rather than an argument.

---

## Summary

| Area | Outcome |
|---|---|
| Outage | 83 minutes, inside the communicated window |
| Public IPs | All 8 unchanged; no partner changes needed |
| SD-WAN | Same dashboard record, zero setting changes, all branch tunnels up |
| Day-before findings | Firmware drift, unregistered firewalls, two post-freeze production changes |
| Post go-live issue | Admin SSO, a known issue in the unplanned patch release; resolved by moving to the latest firmware |
| Deletes performed by the AI | **None** |

---

## References

- [Move Azure resources to a new resource group or subscription](https://learn.microsoft.com/azure/azure-resource-manager/management/move-resource-group-and-subscription)
- [Cisco Meraki vMX Setup Guide for Microsoft Azure](https://documentation.meraki.com/MX/MX_Installation_Guides/vMX_Setup_Guide_for_Microsoft_Azure)
- [Claude Code](https://www.anthropic.com/claude-code)
- [Deploying Cisco Meraki vMX with Bicep](meraki-vm-deployment.md)
- [Azure BCP/DR with Backup & Restore - Part 1](azure-bcpdr-part1.md)

---

_This article documents a production implementation. Company names, people, subscription and tenant identifiers, IP addresses and serial numbers have been removed or generalized._
