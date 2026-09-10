---
description: Part 1 of a real-world migration guide from Amazon WorkMail to Microsoft 365, covering tenant setup, licensing, and IMAP mailbox migration ahead of AWS's WorkMail end of support.
---

# Migrating from Amazon WorkMail to Microsoft 365
## Part 1: Tenant Setup & Mailbox Migration

---

### 📚 **Series Navigation**
- **Part 1: Tenant Setup & Mailbox Migration** *(Current)*
- [Part 2: DNS Cutover, Catch-All & Cleanup](email-workmail-to-m365-part2.md)

*AWS has announced the end of support for Amazon WorkMail, effective March 31, 2027. After that date, all WorkMail accounts, console access, and stored data will be permanently deleted with no recovery option. This two-part guide documents a real-world migration from Amazon WorkMail to Microsoft 365 Exchange Online, using the built-in IMAP migration tooling available in the Exchange Admin Center — no third-party tools required.*

> **AWS Official End of Support Notice:**
> [https://docs.aws.amazon.com/workmail/latest/adminguide/workmail-end-of-support.html](https://docs.aws.amazon.com/workmail/latest/adminguide/workmail-end-of-support.html)

---

## Why Microsoft 365 and Not AWS's Recommended Alternatives?

AWS officially recommends migrating to Kopano Cloud, Zoho Mail, or Zoom Mail. These are reasonable options, but if your organization is already in the Microsoft ecosystem — using Outlook on desktop or mobile — Microsoft 365 Exchange Online is the natural home for your email. You get:

- Native Exchange protocol (not IMAP workarounds) for Outlook on PC and iPhone
- 50 GB mailbox per user
- Full SPF, DKIM, and DMARC support with proper domain alignment
- Built-in IMAP migration tooling in Exchange Admin Center — no third-party software required
- A single platform for email, Teams, OneDrive, and identity management (Entra ID)

There is no official AWS or Microsoft documentation specifically covering the WorkMail → Microsoft 365 migration path. This guide fills that gap based on a hands-on migration completed in September 2026.

---

## Overview

The migration is split into two parts:

- **Part 1 (this article):** M365 tenant preparation, user creation, license assignment, and IMAP mailbox migration
- **Part 2:** DNS cutover (MX, SPF, DKIM, DMARC), catch-all configuration, and AWS decommission

The key principle throughout: **mailbox data is migrated before any DNS records are changed.** This means email continues flowing to WorkMail during the migration, and users experience zero disruption.

---

## Prerequisites

Before starting, you need:

- An active Amazon WorkMail organization with admin access
- The IMAP server address for your WorkMail region (see table below)
- Passwords for each WorkMail mailbox being migrated (or admin rights to reset them)
- A Microsoft 365 tenant (existing or new) with Global Admin access
- Your custom domain already added and verified in M365 (or ready to be added)

### WorkMail IMAP Server by Region

| AWS Region | IMAP Server | Port | Encryption |
|---|---|---|---|
| US East (N. Virginia) | `imap.mail.us-east-1.awsapps.com` | 993 | SSL/TLS |
| US West (Oregon) | `imap.mail.us-west-2.awsapps.com` | 993 | SSL/TLS |
| Europe (Ireland) | `imap.mail.eu-west-1.awsapps.com` | 993 | SSL/TLS |

To confirm your region, check the URL in the AWS WorkMail console — it will contain the region identifier (e.g., `us-east-1`).

> **AWS WorkMail IMAP documentation:**
> [https://docs.aws.amazon.com/workmail/latest/userguide/using_IMAP.html](https://docs.aws.amazon.com/workmail/latest/userguide/using_IMAP.html)

---

## Important: A Note on Mailbox Passwords

The IMAP migration tool requires the **WorkMail password** for each mailbox being migrated. As a WorkMail admin, you can reset any user's password from the WorkMail console without knowing the current password:

- AWS Console → WorkMail → Organizations → your org → Users → select user → Reset password

Set a temporary password, note it down, and use it in the migration CSV file. The password only needs to work for the duration of the migration — a few hours at most.

---

## Step 1: Prepare Your Microsoft 365 Tenant

### Do You Already Have an M365 Tenant?

Before purchasing a new subscription, check whether a tenant already exists for your domain. This is more common than expected — organizations sometimes create tenants during learning or trials and forget about them.

To check, open a browser and navigate to:

```
https://login.microsoftonline.com/yourdomain.com/.well-known/openid-configuration
```

If the response contains a valid `issuer` URL with a tenant GUID, a tenant already exists. If you get an error, no tenant exists and you can create a fresh one.

If a tenant does exist, verify you have admin credentials before proceeding. Signing in at [https://admin.microsoft.com](https://admin.microsoft.com) with your domain email will confirm access.

### Choosing the Right License

For email-only migration from WorkMail, two plans are appropriate:

| Plan | Price | What's Included |
|---|---|---|
| Exchange Online Plan 1 | $4/user/month | Email only — 50 GB mailbox, Outlook support |
| Microsoft 365 Business Basic | $7/user/month | Email + 1 TB OneDrive + Teams + web Office apps |

If your users only need email, Exchange Online Plan 1 is sufficient. If you want OneDrive for Business and Teams included, Business Basic is worth the upgrade. Both plans support native Exchange connectivity for Outlook on PC and iPhone — no IMAP configuration needed post-migration.

Purchase licenses via the M365 Admin Center: **Billing → Purchase services**.

---

## Step 2: Add and Verify Your Domain in M365

If your domain is not yet verified in M365:

1. Go to **Microsoft 365 Admin Center → Settings → Domains → Add domain**
2. Enter your domain name and follow the verification wizard
3. M365 will provide a TXT record to add to your DNS provider for verification
4. Add only the verification TXT record at this stage — **do not change MX records yet**
5. Return to M365 and click Verify

> **Important:** When M365 asks how you want to connect your domain, select **"Add your own DNS records"** — not the automatic option. You will manage DNS changes manually in Part 2, after mailbox migration is confirmed complete.

---

## Step 3: Create User Accounts and Assign Licenses

For each user being migrated from WorkMail:

1. Go to **M365 Admin Center → Users → Active Users → Add a user**
2. Create the account with the same email address as WorkMail (e.g., `user@yourdomain.com`)
3. Set a temporary password
4. Assign the purchased license (Exchange Online Plan 1 or Business Basic)

> **Usage Location requirement:** Microsoft requires a usage location to be set before a license can be assigned. If you receive a license assignment error, go to the user's profile → Edit → Settings → set Usage location to your country, then retry the license assignment.

After license assignment, verify mailboxes are provisioned by going to **Exchange Admin Center → Recipients → Mailboxes**. Both user mailboxes should appear within a few minutes.

---

## Step 4: Run the IMAP Migration

This is the core step — pulling all email from WorkMail into M365. This runs entirely in the background while WorkMail continues receiving new email. Users experience no disruption.

### 4.1 Create the Migration Batch

Navigate to **Exchange Admin Center → Migration → Migration batches → + Add migration batch**

- **Migration batch name:** Give it a descriptive name (e.g., `WorkMail-Migration-Sept2026`)
- **Migration path:** Migration to Exchange Online
- **Migration type:** IMAP migration

### 4.2 Configure the IMAP Endpoint

On the IMAP server configuration screen, enter:

- **IMAP server:** your WorkMail IMAP server address (from the table above)
- **Port:** 993
- **Encryption:** SSL
- **Accept untrusted certificates:** unchecked
- **Skip verification:** unchecked

Click Next — M365 will validate connectivity to your WorkMail IMAP server.

### 4.3 Prepare the Migration CSV

Download the CSV template provided by the wizard. The format is:

```
EmailAddress,UserName,Password
user1@yourdomain.com,user1@yourdomain.com,TempPassword123!
user2@yourdomain.com,user2@yourdomain.com,TempPassword456!
```

Key points:
- `EmailAddress` must match the M365 mailbox address exactly
- `UserName` for WorkMail is always the full email address
- Use the temporary passwords you set in Step 0 (or reset them now)
- Save the file and upload it in the wizard

### 4.4 Configure Migration Settings

On the configuration settings screen:
- Leave both folder filter checkboxes **unchecked** — migrate everything, all folders, all time ranges
- Set your notification email address for completion alerts
- **Start:** Automatically
- **End:** Leave disabled — you will monitor and manage the batch manually

Click **Save** to start the migration batch.

### 4.5 Monitor the Migration

Go to **Migration → Migration batches** and click on your batch. The status will progress through:

- **Queued** → starting up
- **Syncing** → actively copying email from WorkMail
- **Synced** → initial copy complete, incremental sync running

The migration log shows real-time progress including messages copied, bytes transferred, and folders completed. For a 500 MB mailbox, expect 10–30 minutes depending on network speed.

When the log shows:

```
Mailbox contents verification of target mailbox: successful
Source and Target: X folders, X items, X MB
```

The migration is complete and verified. All email is now safely in M365.

### 4.6 Run an Incremental Sync After DNS Cutover

After you change MX records in Part 2, some email may arrive at WorkMail during the DNS propagation window (typically 30–60 minutes). To capture these stragglers, run the migration batch one more time after DNS has fully propagated — M365 will only copy new items not yet migrated (delta sync).

---

## What IMAP Migration Does and Does Not Migrate

| Item | Migrated? |
|---|---|
| Inbox | ✅ Yes |
| Sent Items | ✅ Yes |
| Deleted Items | ✅ Yes (including items deleted but not purged) |
| All custom folders | ✅ Yes |
| Contacts | ❌ No — export from WorkMail webmail as .vcf and import manually |
| Calendar items | ❌ No — export from WorkMail webmail as .ics and import manually |
| Tasks | ❌ No |

> **Note on deleted items:** IMAP migration pulls everything present on the server, including items in the Deleted Items folder that were never permanently purged. Users may see emails they thought were deleted reappear in their M365 mailbox. This is expected — Exchange Online now handles deletions properly (true two-way sync), so users can delete these items and they will sync across all devices immediately.

---

## Lessons Learned

**Reset mailbox passwords before starting.** The IMAP migration fails silently if credentials are wrong — the batch shows as syncing with 0 bytes transferred. Always test IMAP credentials manually before running the migration.

**Don't change DNS before migration completes.** The safest sequence is: migrate first, verify the data is in M365, then cut over DNS. Changing MX records while migration is running doesn't break anything, but it adds unnecessary complexity.

**The migration is non-destructive.** WorkMail is not modified or affected in any way. If the migration fails or data looks wrong, WorkMail is still intact and you can start over.

**Mailbox size matters less than you expect.** A 500 MB mailbox migrates in under 30 minutes on a normal broadband connection. Even a 2 GB mailbox typically completes within a couple of hours.

---

## Next Steps

With mailboxes confirmed in M365, Part 2 covers:

- Updating DNS records (MX, SPF, DKIM, DMARC) at your DNS provider
- Setting up catch-all email for non-existent addresses
- Verifying email health with header analysis
- Decommissioning the WorkMail organization and cleaning up AWS resources

## References

* [AWS WorkMail end of support](https://docs.aws.amazon.com/workmail/latest/adminguide/workmail-end-of-support.html)
* [AWS WorkMail IMAP settings](https://docs.aws.amazon.com/workmail/latest/userguide/using_IMAP.html)
* [Microsoft IMAP migration guide](https://learn.microsoft.com/en-us/exchange/mailbox-migration/migrating-imap-mailboxes/migrating-imap-mailboxes)
