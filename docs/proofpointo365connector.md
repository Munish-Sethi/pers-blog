# Understanding SPF, DKIM, and DMARC in O365 with Proofpoint: Preventing Spoofing and Bypass Attacks

## Introduction

Email security is a critical aspect of any organization’s IT infrastructure. This article explains the basics of SPF, DKIM, and DMARC, and details a real-world scenario involving Office 365 (O365) and Proofpoint, where attackers were able to bypass protections and how to mitigate such risks.

---

## 1. Email Flow Architecture

- **Internal Emails:** Sent from one user to another within the organization, these do **not** traverse Proofpoint.
- **Outbound External Emails:** Sent from O365 to Proofpoint, then to external recipients.
- **Inbound External Emails:** Received by Proofpoint, then relayed to O365, and finally delivered to users.

> **Note:** Even after configuring MX records to point only to Proofpoint (e.g., `mx1-us1.ppe-hosted.com` with IPs `148.163.129.50` and `67.231.154.162`), attackers may still find ways to bypass these controls.

---

## 2. SPF, DKIM, and DMARC Explained

### SPF (Sender Policy Framework)
- **Purpose:** Specifies which mail servers are authorized to send email for your domain.
- **How to Check:**
  ```sh
  dig +short TXT munishsethi.com
  dig +short TXT _spf.munishsethi.com
  ```
- **Example Record:**
  ```
  v=spf1 include:spf.protection.outlook.com include:spf.proofpoint.com -all
  ```

### DKIM (DomainKeys Identified Mail)
- **Purpose:** Uses cryptographic signatures to verify that an email was sent by an authorized server and was not altered.
- **How to Check:**
  ```sh
  dig +short TXT selector1._domainkey.munishsethi.com
  ```
- **Example Record:**
  ```
  v=DKIM1; k=rsa; p=...public-key...
  ```

### DMARC (Domain-based Message Authentication, Reporting, and Conformance)
- **Purpose:** Tells receiving servers what to do if SPF or DKIM checks fail.
- **How to Check:**
  ```sh
  dig +short TXT _dmarc.munishsethi.com
  ```
- **Example Record:**
  ```
  v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@munishsethi.com
  ```
- **Policy Options:**
  - `none`: Take no action, just report.
  - `quarantine`: Treat as suspicious (e.g., send to spam/quarantine).
  - `reject`: Reject the message outright.

---

## 3. The Problem: Spoofing Despite DMARC Quarantine

Even after setting the MX records to Proofpoint and configuring DMARC with `p=quarantine`, spoofed emails were still being delivered. Investigation revealed that attackers were sending emails directly to the Microsoft EOP (Exchange Online Protection) endpoint (e.g., `SJ1PEPF000023D6.mail.protection.outlook.com`), bypassing the MX record lookup. Microsoft EOP sometimes relayed these messages to users if the spam score (SCL) was low, even if DMARC failed.

### Why This Happens
- Microsoft EOP may not always quarantine emails with failed DMARC if the SCL is low.
- Attackers can send directly to O365 endpoints, bypassing Proofpoint.

---

## 4. Allowing Legitimate Internal Applications


Some internal applications need to send emails (e.g., alerts, notifications) to both internal and external recipients. These are sent from trusted IP addresses and should be allowed.

### Step-by-Step: Creating a Connector in O365

1. **Log in to the Microsoft 365 Admin Center**
   - Go to https://admin.exchange.microsoft.com
   - Use an account with Exchange admin permissions.

2. **Navigate to Mail Flow > Connectors**
   - In the left pane, select **Mail flow** > **Connectors**.

3. **Create a New Connector**
   - Click **Add a connector**.
   - **From:** Your organization's email server
   - **To:** Office 365
   - Click **Next**.

4. **Name and Describe the Connector**
   - Give the connector a meaningful name (e.g., "Internal App Relay").
   - Add a description for future reference.

5. **Specify Trusted IP Addresses**
   - Select "By verifying that the IP address of the sending server matches one of the following IP addresses..."
   - Enter the public IP addresses of your trusted internal applications/servers.

6. **Configure Security Restrictions**
   - Choose whether to require TLS, certificate, or other restrictions as needed.

7. **Review and Create**
   - Review your settings and click **Create connector**.

8. **Test the Connector**
   - Send a test email from your internal application to an internal and external recipient.
   - Check message headers in the recipient's mailbox to confirm successful delivery and correct routing.

**Tip:** Use the "Message Trace" feature in Exchange Admin Center to troubleshoot delivery issues.

---

## 5. Blocking External Spoofing: The PowerShell Rule


To block external senders from bypassing Proofpoint and sending directly to O365, you must create a transport rule (mail flow rule) in Exchange Online using PowerShell. The Exchange Admin Center (EAC) UI does not support the required advanced header matching.

### Step-by-Step: Creating the Transport Rule via PowerShell

1. **Connect to Exchange Online PowerShell**
   - Open PowerShell on your admin workstation.
   - Run:
     ```powershell
     Connect-ExchangeOnline -UserPrincipalName <your-admin-account>
     ```

2. **Create the Transport Rule**
   - Run the following command (update the rule name as needed):
     ```powershell
     New-TransportRule -Name "Quarantine external spoof bypass Proofpoint" `
       -FromScope NotInOrganization `
       -SetAuditSeverity High `
       -Quarantine $true `
       -ExceptIfHeaderMatchesMessageHeader "X-PPE-TRUSTED" -ExceptIfHeaderMatchesPatterns ".+"
     ```

3. **Explanation of the Rule Parameters**
   - `-FromScope NotInOrganization`: Applies to emails from outside your organization.
   - `-SetAuditSeverity High`: Flags the rule for auditing.
   - `-Quarantine $true`: Moves matching messages to quarantine.
   - `-ExceptIfHeaderMatchesMessageHeader "X-PPE-TRUSTED"`: Exempts emails with the Proofpoint trusted header.
   - `-ExceptIfHeaderMatchesPatterns ".+"`: Ensures only emails with the trusted header are exempted.

4. **Validate the Rule**
   - Send a test email from an external source directly to your O365 endpoint (bypassing Proofpoint) and verify it is quarantined.
   - Send a test email from Proofpoint and verify it is delivered.

5. **Troubleshooting**
   - Use the "Message Trace" feature in Exchange Admin Center to check the status of test messages.
   - Review the message headers for the presence of `X-PPE-TRUSTED`.

**Note:** This rule must be created via PowerShell as the EAC UI does not support regex or advanced header matching.

---

## 6. Step-by-Step Setup

1. **Configure SPF, DKIM, and DMARC for your domain (e.g., munishsethi.com).**
   - Update DNS records with your domain registrar or DNS provider.
   - Use `dig` or online tools to verify propagation.
2. **Set MX records to point only to Proofpoint.**
   - In your DNS provider, set the MX record to `mx1-us1.ppe-hosted.com` (and backup as needed).
   - Remove any direct O365 MX records.
3. **Create a connector in O365 for trusted internal IPs.**
   - Follow the detailed steps above in the "Allowing Legitimate Internal Applications" section.
4. **Create the PowerShell transport rule to quarantine emails that bypass Proofpoint.**
   - Follow the detailed steps above in the "Blocking External Spoofing" section.
5. **Monitor and adjust DMARC policy to `p=reject` for stricter enforcement.**
   - Start with `p=quarantine` and review DMARC reports.
   - Move to `p=reject` once you are confident legitimate mail is not being blocked.
   - Use DMARC reporting tools to monitor for issues.

---

## 7. Why Additional Connector and Rule Are Needed

- **Connector:** Allows legitimate internal applications to send emails without being blocked or quarantined.
- **Transport Rule:** Ensures that any email not passing through Proofpoint is quarantined, preventing attackers from bypassing your MX records.

---

## 8. Security Considerations

- Attackers constantly look for ways to bypass security controls, especially if they know your organization uses O365.
- Regularly review and update your connectors, rules, and DNS records.
- Use `p=reject` in DMARC for maximum protection, but test thoroughly before enforcing.

---

## 9. Summary

- SPF, DKIM, and DMARC are foundational for email security, but not foolproof.
- Attackers can exploit direct-to-EOP delivery if not properly mitigated.
- Use connectors and transport rules to enforce your security architecture.
- Always monitor, test, and update your configurations to stay ahead of threats.

---

*For more information, consult Microsoft and Proofpoint documentation, and regularly audit your email security setup.*
