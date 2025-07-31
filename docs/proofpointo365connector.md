# Understanding SPF, DKIM, and DMARC in O365 with Proofpoint: Preventing Spoofing and Bypass Attacks

## Introduction

Email security is a critical aspect of any organization's IT infrastructure. This article explains the basics of SPF, DKIM, and DMARC, and details a real-world scenario involving Office 365 (O365) and Proofpoint, where attackers were able to bypass protections and how to mitigate such risks.

After implementing traditional quarantine approaches, we discovered significant operational challenges that led us to adopt a more sophisticated **redirect-based solution** that maintains business continuity while providing superior security protection.

---

## 1. Email Flow Architecture

- **Internal Emails:** Sent from one user to another within the organization, these do **not** traverse Proofpoint.
- **Outbound External Emails:** Sent from O365 to Proofpoint, then to external recipients.
- **Inbound External Emails:** Received by Proofpoint, then relayed to O365, and finally delivered to users.

> **Note:** Even after configuring MX records to point only to Proofpoint (e.g., `mx1-us1.ppe-hosted.com` with IPs `148.163.129.50` and `67.231.154.162`), attackers may still find ways to bypass these controls.

### The Bypass Problem Explained

Attackers can research your organization's `.onmicrosoft.com` domain and send emails directly to Microsoft's EOP servers, completely bypassing your ProofPoint security stack. This happens because:

1. **Discovery of .onmicrosoft.com domains**: Attackers use tools like MXtoolbox to find your `companyname.onmicrosoft.com` domain
2. **Direct delivery to Microsoft**: They send emails directly to `mail.protection.outlook.com` servers
3. **Bypass your MX records**: Since they're not using normal MX record lookup, your ProofPoint gateway never sees these emails

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

### Real-World Example: Teams Meeting Forward Issue

During our implementation, we encountered a specific scenario that highlighted the complexity of modern email security:

**The Scenario**: A user received a Teams calendar meeting invite from an external sender (`rmay@dmainc.com`). When this user forwarded the meeting to internal colleagues, the forwarded meeting was being quarantined by our security rules.

**The Problem**: The forwarded email had:
- `From: "May, Rico" <rmay@dmainc.com>` (external domain)
- `Sender: Manimaran Chokkappa <Manimaran.Chokkappa.ext@yourcompany.com>` (internal)
- `X-MS-Exchange-MeetingForward-Message: Forward` (indicating internal forward)

This legitimate internal forward was being treated as an external threat because Exchange preserves the original "From" address while adding internal sender information.

---

## 4. Evolution from Quarantine to Redirect Approach

### Initial Quarantine Approach (Problematic)

Our first attempt used a broad quarantine rule:

```powershell
New-TransportRule -Name "Quarantine external spoof bypass Proofpoint" `
  -FromScope NotInOrganization `
  -SetAuditSeverity High `
  -Quarantine $true `
  -ExceptIfSenderDomainIs @("skype.voicemail.microsoft.com", "microsoft.com") `
  -ExceptIfHeaderMatchesMessageHeader "X-PPE-TRUSTED" -ExceptIfHeaderMatchesPatterns "[\s\S]*" `
  -ExceptIfHeaderContainsMessageHeader "X-MS-Exchange-MeetingForward-Message" -ExceptIfHeaderContainsWords "Forward"
```

### Problems with the Quarantine Approach

1. **Overly Broad**: Quarantined ALL external email except specific exceptions
2. **Operational Impact**: 
   - Customer communications blocked
   - Partner emails quarantined
   - Legitimate business correspondence interrupted
   - Meeting forwards and internal operations affected
3. **Administrative Overhead**: IT overwhelmed with quarantine release requests
4. **Business Disruption**: Users couldn't receive important external communications

### The Better Solution: Redirect Approach

After experiencing these operational challenges, we developed a **redirect-based solution** that:

- **Maintains mail flow** while ensuring security
- **Forces suspicious emails** back through the proper security stack
- **Reduces false positives** significantly
- **Preserves business continuity**

---

## 5. Allowing Legitimate Internal Applications

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

## 6. The Complete Redirect-Based Security Solution

### Overview

Our final solution consists of three coordinated components:

1. **ProofPoint SCL Rule** (Highest Priority - Keep existing)
2. **Azure/Application Server Allow Rule** (Priority 2)
3. **Bypass Redirect Rule** (Priority 3)

### Step 1: Preserve Existing ProofPoint SCL Rule

**Keep your existing highest priority rule that your ProofPoint partner created:**

```
Rule: ProofPoint SCL Trust Rule
Priority: 1 (Highest)
Conditions: sender ip addresses belong to ProofPoint ranges
Actions: Set the spam confidence level (SCL) to '-1'
```

**Why this is critical:**
- SCL -1 = "Trusted sender" bypasses all EOP spam filtering
- Prevents EOP from re-scanning mail already processed by ProofPoint
- Ensures clean mail from ProofPoint isn't incorrectly blocked

### Step 2: Create the Redirect Infrastructure

**Create the outbound connector for redirecting bypass attempts:**

```powershell
# Connect to Exchange Online PowerShell
Connect-ExchangeOnline -UserPrincipalName <your-admin-account>

# Create outbound connector for redirect functionality
New-OutboundConnector -Name 'Redirect Bypass to MX' `
  -ConnectorType 'Partner' `
  -UseMxRecord:$true `
  -IsTransportRuleScoped:$True
```

**Explanation:**
- `UseMxRecord:$true`: Forces mail back through proper MX record lookup
- `IsTransportRuleScoped:$True`: Only activates when triggered by transport rule
- This connector will route suspicious mail back to ProofPoint for proper processing

### Step 3: Create Application Server Exception Rule

```powershell
# Rule to allow legitimate application servers (Azure, Physical Company Locations etc.)
New-TransportRule -Name 'Allow Company Servers Direct Delivery' `
  -FromScope NotInOrganization `
  -RecipientDomainIs "yourdomain.com" `
  -SenderIpRanges @(
    # Azure/Application Server IPs
    "XXX.XX.XX.XX/32","YY.YY.YYY.YYY/32"
  ) `
  -SetAuditSeverity Low `
  -StopRuleProcessing $true
```

**Explanation:**
- **Purpose**: Allows legitimate application servers to deliver directly to O365
- **StopRuleProcessing**: If this rule matches, don't process the redirect rule
- **Easy Maintenance**: Simple to update when adding new Azure regions or application servers

### Step 4: Create the Main Bypass Redirect Rule

```powershell
# Main rule to redirect ProofPoint bypass attempts
New-TransportRule -Name 'Redirect Direct Delivery to MX' `
  -FromScope NotInOrganization `
  -RecipientDomainIs "yourdomain.com" `
  -ExceptIfSenderIpRanges @(
    # ProofPoint IP Ranges (Static - rarely change)
    "67.231.149.0/24","67.231.148.0/24","67.231.147.0/24",
    "67.231.146.0/24","67.231.145.0/24","67.231.144.0/24",
    "67.231.156.0/24","67.231.155.0/24","67.231.154.0/24",
    "67.231.153.0/24","67.231.152.0/24","148.163.159.0/24",
    "148.163.158.0/24","148.163.157.0/24","148.163.156.0/24",
    "148.163.155.0/24","148.163.154.0/24","148.163.153.0/24",
    "148.163.152.0/24","148.163.151.0/24","148.163.150.0/24",
    "148.163.149.0/24","148.163.148.0/24","148.163.147.0/24",
    "148.163.146.0/24","148.163.145.0/24","148.163.144.0/24",
    "148.163.143.0/24","148.163.142.0/24","148.163.141.0/24",
    "148.163.140.0/24","148.163.139.0/24","148.163.138.0/24",
    "148.163.137.0/24","148.163.136.0/24","148.163.135.0/24",
    "148.163.134.0/24","148.163.133.0/24","148.163.132.0/24",
    "148.163.131.0/24","148.163.130.0/24","148.163.129.0/24",
    "148.163.128.0/24"
  ) `
  -ExceptIfHeaderMatchesMessageHeader "X-PPE-TRUSTED" `
  -ExceptIfHeaderMatchesPatterns "[\s\S]*" `
  -SetAuditSeverity Low `
  -RouteMessageOutboundConnector 'Redirect Bypass to MX'
```

**Explanation:**
- **Target**: External emails to your domain that didn't come through ProofPoint
- **Exceptions**: 
  - ProofPoint IP ranges (legitimate mail flow)
  - X-PPE-TRUSTED header (already processed by ProofPoint)
- **Action**: Route back through MX records (to ProofPoint) instead of quarantining
- **Result**: Suspicious mail gets processed by your security stack before delivery

### Rule Processing Flow

```
Email arrives at O365 EOP
    ↓
Priority 1: ProofPoint SCL Rule
├── From ProofPoint IP? → Set SCL -1 (Trusted) → Deliver
    ↓
Priority 2: Azure Application Allow Rule  
├── From Azure/App IP? → Allow Direct Delivery → Stop Processing
    ↓
Priority 3: Bypass Redirect Rule
├── From external & not ProofPoint? → Redirect to MX (ProofPoint)
├── From ProofPoint or has X-PPE-TRUSTED? → Allow delivery
    ↓
Normal delivery continues
```

### Loop Prevention Mechanisms

**How we prevent mail loops:**

1. **IP-based Recognition**: When ProofPoint processes redirected mail and delivers it back, it comes from ProofPoint IPs
2. **Header-based Recognition**: ProofPoint adds X-PPE-TRUSTED header to processed mail
3. **Exception Logic**: Both trigger exceptions in the redirect rule, preventing re-redirect

**Example Flow:**
```
Attacker sends direct to EOP → Redirect Rule triggers → Mail sent to ProofPoint
    ↓
ProofPoint processes mail → Delivers from ProofPoint IP with X-PPE-TRUSTED header
    ↓
Redirect rule exceptions apply → Mail delivered normally (no loop)
```

---

## 7. Why the Redirect Approach is Superior

### Comparison: Quarantine vs Redirect

| Aspect | Quarantine Approach | Redirect Approach |
|--------|-------------------|------------------|
| **Security** | High (blocks everything) | High (forces through security stack) |
| **False Positives** | Very High | Low |
| **Business Impact** | Severe disruption | Minimal disruption |
| **Maintenance** | High (constant release requests) | Low (automated processing) |
| **User Experience** | Poor (missing emails) | Good (delayed but delivered) |
| **IT Overhead** | Very High | Low |

### Business Benefits of Redirect Approach

1. **Maintains Business Continuity**: Legitimate emails still get delivered after processing
2. **Reduces Help Desk Load**: No quarantine release requests for legitimate mail
3. **Provides Complete Protection**: All email goes through your security stack
4. **Enables Monitoring**: Can track exactly how much bypass traffic you're getting
5. **Flexible**: Easy to add exceptions for legitimate sources

### Security Benefits

1. **Zero Bypass**: All external email is forced through ProofPoint
2. **Comprehensive Coverage**: Catches all bypass attempts, not just obvious spoofs
3. **Maintains Defenses**: Your security stack processes everything
4. **Audit Trail**: Complete visibility into redirect activity

---

## 8. Implementation Steps and Best Practices

### Pre-Implementation Checklist

1. **Document Current State**:
   ```powershell
   # Get current transport rules
   Get-TransportRule | Select-Object Name, Priority, State
   
   # Get current connectors  
   Get-InboundConnector | Select-Object Name, SenderIPAddresses
   Get-OutboundConnector | Select-Object Name, SmartHosts
   ```

2. **Test Environment**: If possible, test in a development tenant first

3. **Communication Plan**: Inform users about potential short delays during initial processing

### Implementation Order

1. **Create redirect connector** (doesn't affect mail flow until rules are created)
2. **Create Azure/Application allow rule** (prevents legitimate app mail from being redirected)  
3. **Create bypass redirect rule** (starts catching bypass attempts)
4. **Monitor and adjust** as needed

### Post-Implementation Monitoring

1. **Check Rule Reports**:
   ```powershell
   # Check rule execution statistics
   Get-TransportRule "Redirect Direct Delivery to MX" | Get-TransportRuleReport
   ```

2. **Monitor Message Trace**: Look for emails being redirected and ensure they're delivered after processing

3. **Review Connector Validation**: The redirect connector will show "Validation failed" - this is normal and expected

### Maintenance Commands

**Update Azure/Application IPs:**
```powershell
Set-TransportRule -Identity 'Allow Azure Application Servers Direct Delivery' `
  -SenderIpRanges @("NEW_IP_LIST_HERE")
```

**Check Current Settings:**
```powershell
Get-TransportRule "Allow Azure Application Servers Direct Delivery" | 
  Select-Object SenderIpRanges
```

---

## 9. Troubleshooting Common Issues

### Issue: Connector Shows "Validation Failed"

**Symptom**: The redirect connector shows validation failure in Exchange Admin Center

**Cause**: Normal behavior - ProofPoint has security restrictions preventing test connections

**Resolution**: This is expected and the connector will work when triggered by transport rules

### Issue: Meeting Forwards Still Being Caught

**Symptom**: Internal meeting forwards are being redirected

**Analysis**: Check message headers for:
- `X-MS-Exchange-MeetingForward-Message: Forward`
- Internal sender information

**Resolution**: These should not trigger the redirect rule due to `FromScope NotInOrganization`, but if they do, add specific exceptions

### Issue: Legitimate Partners Being Redirected

**Symptom**: Known good partners' emails are being redirected

**Analysis**: Verify if they're sending directly to EOP instead of through normal MX lookup

**Resolution**: Add their IP ranges to the exception list or ask them to use proper MX record delivery

---

## 10. Advanced Configurations

### Adding Regional ProofPoint IPs

If your organization expands to new regions with different ProofPoint IPs:

```powershell
# Get current ProofPoint IPs
$currentRule = Get-TransportRule "Redirect Direct Delivery to MX"
$currentIPs = $currentRule.ExceptIfSenderIpRanges

# Add new regional IPs
$newIPs = $currentIPs + @("NEW_PROOFPOINT_RANGE_1","NEW_PROOFPOINT_RANGE_2")

# Update rule
Set-TransportRule -Identity "Redirect Direct Delivery to MX" -ExceptIfSenderIpRanges $newIPs
```

### Custom Reporting

Create custom monitoring for redirect activity:

```powershell
# Get message trace for redirected emails (last 7 days)
Get-MessageTrace -StartDate (Get-Date).AddDays(-7) -EndDate (Get-Date) |
  Where-Object {$_.MessageTraceId -like "*Redirect*"} |
  Select-Object Received, SenderAddress, RecipientAddress, Status
```

---

## 11. Security Considerations and Best Practices

### Regular Review Tasks

1. **Monthly**: Review transport rule reports for unusual activity
2. **Quarterly**: Audit IP exception lists for accuracy
3. **Annually**: Review overall email security architecture

### Security Hardening

1. **Monitor Redirect Volume**: Sudden increases may indicate attack campaigns
2. **Review Exception Lists**: Ensure only legitimate IPs are excepted
3. **DMARC Policy Evolution**: Move from `p=quarantine` to `p=reject` when confident

### Compliance Considerations

1. **Audit Trails**: Ensure message tracking captures redirect activity
2. **Data Retention**: Plan for log retention requirements
3. **Incident Response**: Include redirect logs in security incident procedures

---

## 12. Summary and Lessons Learned

### Key Takeaways

1. **Simple quarantine approaches** can cause significant business disruption
2. **Redirect-based solutions** provide better balance of security and usability  
3. **Layered approach** with multiple rules provides comprehensive protection
4. **ProofPoint bypass attacks** are common and require specific countermeasures
5. **Proper exception handling** is critical for operational success

### The Final Architecture

Our solution creates a comprehensive security architecture:

- **Layer 1**: ProofPoint SCL rule ensures processed mail is trusted
- **Layer 2**: Application server exceptions prevent legitimate apps from being redirected
- **Layer 3**: Bypass redirect ensures all other external mail goes through security stack
- **Result**: Zero bypass attacks while maintaining business continuity

### Future Considerations

- Monitor for new bypass techniques as attackers evolve
- Consider additional security layers as threat landscape changes
- Regular review and updates to maintain effectiveness

---

## 13. Additional Resources

### Useful PowerShell Commands

```powershell
# Connect to Exchange Online
Connect-ExchangeOnline -UserPrincipalName admin@yourcompany.com

# List all transport rules with priorities
Get-TransportRule | Select-Object Name, Priority, State | Sort-Object Priority

# Check specific rule details
Get-TransportRule "Redirect Direct Delivery to MX" | Format-List

# View connector status
Get-OutboundConnector "Redirect Bypass to MX" | Format-List

# Message trace for troubleshooting
Get-MessageTrace -SenderAddress "test@externaldomain.com" -StartDate (Get-Date).AddHours(-2)
```

### DNS Verification Commands

```bash
# Check MX records
dig +short MX yourdomain.com

# Verify SPF
dig +short TXT yourdomain.com | grep spf

# Check DMARC policy  
dig +short TXT _dmarc.yourdomain.com

# Verify DKIM
dig +short TXT selector1._domainkey.yourdomain.com
```

---

*This comprehensive approach to email security demonstrates that effective protection requires balancing security needs with operational requirements. The redirect-based solution provides robust protection against bypass attacks while maintaining the business continuity essential for modern organizations.*

*For more information, consult Microsoft and Proofpoint documentation, and regularly audit your email security setup. Remember that email security is an ongoing process that requires continuous monitoring and adjustment as threats evolve.*