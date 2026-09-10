---
description: Part 2 of the WorkMail-to-M365 migration covering DNS cutover (MX, SPF, DKIM, DMARC), catch-all configuration, and decommissioning AWS WorkMail.
---

# Migrating from Amazon WorkMail to Microsoft 365
## Part 2: DNS Cutover, Catch-All & Cleanup

---

### 📚 **Series Navigation**
- [Part 1: Tenant Setup & Mailbox Migration](email-workmail-to-m365-part1.md)
- **Part 2: DNS Cutover, Catch-All & Cleanup** *(Current)*

*This is Part 2 of a two-part guide. [Part 1](email-workmail-to-m365-part1.md) covers tenant setup and IMAP mailbox migration. This part assumes all mailboxes have been successfully migrated and verified in Microsoft 365.*

---

## Overview

At this point:

- ✅ All email is migrated and verified in M365 mailboxes
- ✅ MX records still point to WorkMail — email continues flowing normally
- ✅ WorkMail is untouched and still receiving new mail

This part covers the DNS cutover that switches email flow from WorkMail to M365, followed by catch-all configuration, email health verification, and AWS decommission.

The sequence matters: **DNS changes happen after migration, not before.**

---

## Step 1: Collect the Required DNS Records from M365

Before touching any DNS, collect all the records M365 needs from the admin center.

Go to **Microsoft 365 Admin Center → Settings → Domains → yourdomain.com → Continue setup**

When prompted, select **"Add your own DNS records"** and download the CSV — M365 provides the exact values for your tenant. You will need:

| Record Type | Name | Value | Purpose |
|---|---|---|---|
| MX | @ | `yourdomain-com.mail.protection.outlook.com` | Routes inbound email to M365 |
| TXT | @ | `v=spf1 include:spf.protection.outlook.com -all` | SPF — authorizes M365 to send |
| CNAME | autodiscover | `autodiscover.outlook.com` | Outlook auto-configuration |
| CNAME | selector1._domainkey | (value from M365 DKIM setup) | DKIM signing |
| CNAME | selector2._domainkey | (value from M365 DKIM setup) | DKIM signing |

> **Note:** The DKIM CNAME values are tenant-specific and generated separately from the domain setup wizard. Get them from **Microsoft 365 Defender → Email & collaboration → Policies & rules → Threat policies → Email authentication settings → DKIM → yourdomain.com → Create DKIM keys.**

Export your current DNS records from your DNS provider before making any changes. This is your rollback reference.

---

## Step 2: DNS Cutover — Make Changes One at a Time

Make DNS changes in this exact order. Do not make all changes simultaneously.

### 2.1 Replace the MX Record

The MX record determines where inbound email is delivered. Changing it is the most critical step.

**Delete** the existing WorkMail MX record:
```
@ MX 10 inbound-smtp.<region>.amazonaws.com
```

**Add** the M365 MX record:
```
Type:     MX
Name:     @
Value:    yourdomain-com.mail.protection.outlook.com
Priority: 0
TTL:      3600
```

After saving, new email will begin routing to M365. DNS propagation typically takes a few minutes with short TTLs, or up to an hour with longer TTLs.

### 2.2 Replace the SPF TXT Record

**Delete** the existing WorkMail SPF record:
```
v=spf1 include:amazonses.com ~all
```

**Add** the M365 SPF record:
```
Type:  TXT
Name:  @
Value: v=spf1 include:spf.protection.outlook.com -all
TTL:   3600
```

> **Why `-all` and not `~all`?** The `-all` (hard fail) instructs receiving servers to reject mail that doesn't pass SPF, rather than just marking it as suspicious. This is the correct setting once you are fully on M365 and no longer sending from WorkMail.

### 2.3 Add the Autodiscover CNAME

```
Type:  CNAME
Name:  autodiscover
Value: autodiscover.outlook.com
TTL:   3600
Proxy: DNS Only (not proxied through Cloudflare or similar CDN)
```

> **Important for Cloudflare users:** The autodiscover CNAME must be set to **DNS Only** (grey cloud), not Proxied (orange cloud). Proxying this record breaks Outlook auto-configuration.

### 2.4 Add M365 DKIM CNAMEs

```
Type:  CNAME
Name:  selector1._domainkey
Value: selector1-yourdomain-com._domainkey.<tenant>.onmicrosoft.com
TTL:   3600
Proxy: DNS Only

Type:  CNAME
Name:  selector2._domainkey
Value: selector2-yourdomain-com._domainkey.<tenant>.onmicrosoft.com
TTL:   3600
Proxy: DNS Only
```

The exact target values come from the DKIM setup page in Microsoft 365 Defender. Copy them exactly — they are tenant-specific.

After adding the CNAMEs, go back to **Microsoft 365 Defender → DKIM → yourdomain.com** and click **Enable**. If you receive an error that the CNAME records were not found, wait 15–30 minutes for DNS propagation and retry. Microsoft's DNS resolver can take longer to pick up changes than third-party tools like MXToolbox.

---

## Step 3: Verify DNS Propagation

Use [MXToolbox](https://mxtoolbox.com/SuperTool.aspx) to verify each record has propagated before proceeding:

- **MX Lookup** → `yourdomain.com` → should show `mail.protection.outlook.com`
- **DNS Lookup → CNAME** → `selector1._domainkey.yourdomain.com` → should return the Microsoft selector value
- **DNS Lookup → CNAME** → `selector2._domainkey.yourdomain.com` → should return the Microsoft selector value

Do not enable DKIM in M365 until both selector CNAMEs are confirmed by MXToolbox. The M365 DKIM enablement will fail with a CNAME not found error if DNS hasn't propagated yet.

---

## Step 4: Verify Email Health

Send a test email from your M365 account (via Outlook Web at [https://outlook.office.com](https://outlook.office.com)) to an external Gmail address. In Gmail, open the email and select **Show original** (three-dot menu). You should see:

```
dkim=pass    header.i=@yourdomain.com    (selector1 or selector2)
spf=pass     smtp.mailfrom=yourdomain.com
dmarc=pass   dis=NONE
```

All three must show **pass** before the migration can be considered complete. If any show fail:

| Failure | Likely Cause |
|---|---|
| `dkim=fail` | DKIM not yet enabled in M365 Defender, or DNS not propagated |
| `spf=fail` | Old WorkMail SPF record not yet replaced, or DNS not propagated |
| `dmarc=fail` | SPF and DKIM both failing — fix those first and DMARC will pass automatically |

---

## Step 5: Update DMARC Policy

After confirming all three checks pass, consider tightening your DMARC policy from `quarantine` to `reject`. The `reject` policy instructs receiving mail servers to outright reject email that fails DMARC, rather than delivering it to the spam folder.

Find your existing `_dmarc` TXT record and update the `p=` value:

```
Before: v=DMARC1;p=quarantine;pct=100;fo=1
After:  v=DMARC1;p=reject;pct=100;fo=1
```

> **Note:** Only change to `p=reject` after you have confirmed DKIM and SPF are both passing consistently for at least one full day. Moving to reject too early can cause legitimate email to be silently dropped if any sending path isn't yet covered by your SPF record.

---

## Step 6: Set Up Catch-All Email Routing

A catch-all mailbox receives email sent to any address at your domain that doesn't correspond to a real mailbox. This is useful if you use addresses like `bills@yourdomain.com`, `info@yourdomain.com`, or `postmaster@yourdomain.com` without creating dedicated mailboxes for each.

M365 handles catch-all via three steps: changing the domain type, and creating a mail flow rule.

### 6.1 Change Domain Type to Internal Relay

By default, M365 treats your domain as **Authoritative** — meaning it rejects email to unknown addresses and returns an NDR (Non-Delivery Report). Changing to **Internal Relay** tells Exchange to accept all email for the domain and let mail flow rules decide what to do with it.

Go to **Exchange Admin Center → Mail flow → Accepted domains → yourdomain.com → Edit**

Change **"This accepted domain is"** from **Authoritative** to **Internal relay**.

Leave the following as defaulted:
- Accept mail for all subdomains: **Off**
- Allow email to be sent from this domain: **On**

Save the change.

### 6.2 Create the Catch-All Mail Flow Rule

Go to **Exchange Admin Center → Mail flow → Rules → + Add a rule → Create a new rule**

Configure as follows:

| Field | Value |
|---|---|
| Name | `Catch-All Rule` |
| Apply this rule if | The recipient → domain is → `yourdomain.com` |
| Do the following | Redirect the message to → `yourprimaryuser@yourdomain.com` |
| Except if | The recipient → is this person → add all valid mailboxes (e.g., `user1@`, `user2@`) |
| Rule mode | Enforce |
| Comments | Add a description for future reference |

The exception list is critical — it ensures email addressed to real mailboxes (`user1@`, `user2@`) is delivered normally and not redirected to the catch-all inbox.

> **Loop prevention:** Internal Relay + the exception list prevents mail loops. Email to valid addresses is excluded from the rule. Email to invalid addresses is redirected. Exchange does not re-process redirected mail through the same rule.

> **Tip:** After creating the rule, verify it is in **Enabled** state. New rules are sometimes created in a disabled state in the Exchange Admin Center.

### 6.3 Test the Catch-All

Send two test emails from an external account:

1. **To a valid address** (e.g., `user1@yourdomain.com`) — should arrive normally in that user's inbox
2. **To a non-existent address** (e.g., `bills@yourdomain.com`) — should arrive in the catch-all inbox (your primary user)

If the second email does not arrive and there is no NDR, check that the rule is enabled and that the domain type was changed to Internal relay.

---

## Step 7: Remove Old WorkMail DNS Records

Once M365 email is confirmed working and DKIM is passing, remove the WorkMail-specific DNS records that are no longer needed:

**Delete these records from your DNS provider:**

```
CNAME  <hash1>._domainkey  →  <hash1>.dkim.amazonses.com
CNAME  <hash2>._domainkey  →  <hash2>.dkim.amazonses.com
CNAME  <hash3>._domainkey  →  <hash3>.dkim.amazonses.com
CNAME  autodiscover        →  autodiscover.mail.<region>.awsapps.com  (if present)
TXT    _amazonses          →  (SES verification token, if present)
```

> **Do not delete before M365 DKIM is confirmed working.** If M365 DKIM is not yet active, the WorkMail DKIM CNAMEs are still signing your outbound email. Deleting them before M365 DKIM is enabled causes DMARC failures and email landing in spam. Only delete them once `dkim=pass header.i=@yourdomain.com selector1` appears in your email headers.

---

## Step 8: Decommission Amazon WorkMail

Wait at least 48 hours after DNS cutover before deleting WorkMail. This window catches any email that was in transit or cached in DNS during propagation.

During this window, check the WorkMail inbox periodically for any new email that arrived after the MX cutover. If you find any, run the M365 IMAP migration batch one final time (incremental sync) to pull those messages into M365.

When ready:

1. Go to **AWS Console → Amazon WorkMail → Organizations**
2. Select your organization → **Actions → Delete organization**
3. Type the organization name to confirm → Delete

WorkMail billing stops immediately after deletion.

---

## Step 9: Final DNS State

After completing all steps, your DNS should look similar to this (using yourdomain.com as placeholder):

```
MX     @                       yourdomain-com.mail.protection.outlook.com   (M365 inbound)
TXT    @                       v=spf1 include:spf.protection.outlook.com -all
TXT    _dmarc                  v=DMARC1;p=reject;pct=100;fo=1
CNAME  autodiscover            autodiscover.outlook.com                      (DNS Only)
CNAME  selector1._domainkey    selector1-yourdomain-com._domainkey.<tenant>.onmicrosoft.com
CNAME  selector2._domainkey    selector2-yourdomain-com._domainkey.<tenant>.onmicrosoft.com
```

WorkMail-specific records (amazonses DKIM CNAMEs, WorkMail autodiscover, SES TXT) should all be gone.

---

## Lessons Learned

**Do one DNS change at a time.** Making all changes simultaneously makes it impossible to isolate the cause if something breaks. MX → SPF → Autodiscover → DKIM in sequence, with verification between each step.

**DKIM takes time.** Microsoft's DKIM validation can take longer than external DNS propagation. MXToolbox may show your CNAME records as live while M365 still reports CNAME not found. Wait 30–60 minutes and retry — don't keep clicking Enable repeatedly.

**Internal Relay + catch-all works cleanly.** The combination of Internal Relay domain type and a mail flow rule with proper exceptions is robust and loop-safe. The key is ensuring the exception list covers all valid mailboxes.

**Email headers are ground truth.** When verifying SPF, DKIM, and DMARC, always check the raw email headers from the receiving side — not just the sending side. Gmail's Show original is the fastest way to get a full authentication result breakdown.

**Delete WorkMail last.** Keep WorkMail alive for at least 48 hours post-cutover. It costs nothing extra during this window and provides a safety net if any email straggler needs to be recovered.

---

## Summary

| Step | Action | When |
|---|---|---|
| Part 1 | Set up M365 tenant, create users, assign licenses | Before DNS changes |
| Part 1 | Run IMAP migration batch, verify all email in M365 | Before DNS changes |
| Part 2 | Replace MX record | After migration verified |
| Part 2 | Replace SPF TXT record | Same time as MX |
| Part 2 | Add Autodiscover CNAME | Same time as MX |
| Part 2 | Add M365 DKIM CNAMEs, enable DKIM | After MX confirmed working |
| Part 2 | Update DMARC to p=reject | After DKIM confirmed passing |
| Part 2 | Configure catch-all (Internal Relay + mail flow rule) | Any time after MX cutover |
| Part 2 | Delete WorkMail DKIM CNAMEs | After M365 DKIM confirmed |
| Part 2 | Delete WorkMail organization in AWS | 48 hours after cutover |

---

## References

* [AWS WorkMail end of support](https://docs.aws.amazon.com/workmail/latest/adminguide/workmail-end-of-support.html)
* [AWS WorkMail IMAP settings](https://docs.aws.amazon.com/workmail/latest/userguide/using_IMAP.html)
* [Microsoft IMAP migration guide](https://learn.microsoft.com/en-us/exchange/mailbox-migration/migrating-imap-mailboxes/migrating-imap-mailboxes)
* [Microsoft DKIM setup for Exchange Online](https://learn.microsoft.com/en-us/microsoft-365/security/office-365-security/email-authentication-dkim-configure)
