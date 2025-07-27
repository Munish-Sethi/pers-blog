# Investigating a False Positive in O365 Tenant Allow/Block List: A Complete Technical Analysis

## Executive Summary

This article provides a detailed technical walkthrough of investigating and resolving an O365 Tenant Allow/Block List false positive that occurred when a user accidentally reported an internal email as phishing. We'll explore the investigation process, explain the unexpected behavior between internal and external email delivery, and demonstrate how to properly diagnose and resolve such issues in a hybrid ProofPoint Essentials + O365 environment.

## Environment Overview

**Email Security Architecture:**
- **External Email Flow**: Internet → ProofPoint Essentials → O365 → End User
- **Internal Email Flow**: Internal User → O365 → End User
- **Security Stack**: ProofPoint Essentials (primary external filter) + O365 Defender for Office 365

**Key Systems:**
- Microsoft 365 Defender Portal: `https://security.microsoft.com`
- Exchange Online PowerShell
- ProofPoint Essentials Portal
- Microsoft Purview Compliance Portal: `https://compliance.microsoft.com`

## The Incident Timeline

### Initial Discovery
**Time**: 9:00 AM CST, July 17, 2025  
**Issue**: User `john.doe@yourdomain.com` could not receive internal emails  
**Symptoms**: Internal emails bouncing, external emails delivering normally

### Investigation Phase 1: Identifying the Root Cause

The first step was to check the O365 Tenant Allow/Block List for any entries related to the affected user.

**Navigation**: Microsoft 365 Defender Portal → Email & collaboration → Policies & rules → Threat policies → Tenant Allow/Block List

```powershell
# Connect to Exchange Online
Connect-ExchangeOnline -Device

# Check current Tenant Allow/Block List entries
Get-TenantAllowBlockListItems -ListType Sender | Select-Object Value, Action, CreatedDateTime, LastModifiedDateTime, Notes, CreatedBy, ModifiedBy
```

**Key Finding**: The user `john.doe@yourdomain.com` was found on the block list with:
- **CreatedDateTime**: July 17, 2025 2:07:06 PM UTC (8:07:06 AM CST)
- **ModifiedBy**: [Blank] - indicating system-generated entry
- **Action**: Block

### Investigation Phase 2: Audit Log Analysis

To understand how the user ended up on the block list, we needed to examine the audit logs.

```powershell
# Search for Tenant Allow/Block List activities on July 17th
Search-UnifiedAuditLog -StartDate "2025-07-17 00:00:00" -EndDate "2025-07-17 23:59:59" -Operations "New-TenantAllowBlockListItems" -ResultSize 1000
```

**Critical Discovery**: The audit log revealed:

```json
{
  "CreationTime": "2025-07-17T14:07:06",
  "Operation": "New-TenantAllowBlockListItems",
  "UserId": "NT AUTHORITY\\SYSTEM (Microsoft.Exchange.AdminApi.NetCore)",
  "Parameters": [
    {"Name": "ListSubType", "Value": "Submission"},
    {"Name": "Block", "Value": "True"},
    {"Name": "Entries", "Value": "john.doe@yourdomain.com"},
    {"Name": "SubmissionID", "Value": "8c3cd19d-e1fb-4095-fa0a-08ddc53afdd2"},
    {"Name": "ListType", "Value": "Sender"},
    {"Name": "ExpirationDate", "Value": "8/15/2025 6:30:00 PM"},
    {"Name": "SubmissionUserId", "Value": "admin.user@yourdomain.com"}
  ]
}
```

**Root Cause Identified**: 
- **Trigger**: User `admin.user@yourdomain.com` reported an email as phishing using Outlook's "Report Message" feature
- **System Response**: Microsoft's automated system analyzed the submission and incorrectly added the **recipient** to the block list instead of evaluating the sender
- **ListSubType: "Submission"**: Confirms this was from a user report, not manual admin action

### Investigation Phase 3: Understanding the Anomalous Behavior

The most puzzling aspect was why internal emails were blocked while external emails continued to deliver normally. This behavior seemed inconsistent with how the Tenant Allow/Block List should function.

#### Message Trace Analysis

```powershell
# Check for failed internal emails
Get-MessageTrace -RecipientAddress "john.doe@yourdomain.com" -StartDate "2025-07-17 00:00:00" -EndDate "2025-07-17 23:59:59" -Status "Failed" | Select-Object Received, SenderAddress, Subject, Status, MessageTraceId
```

**Results**: Multiple internal emails failed after 8:07 AM CST:

```
Received             SenderAddress                    Subject                Status
--------             -------------                    -------                ------
7/17/2025 9:35:35 PM internal.user@yourdomain.com    Testing - ignore       Failed
7/17/2025 9:30:58 PM manager@yourdomain.com          Daily Stats           Failed
7/17/2025 9:29:08 PM hr@yourdomain.com               Test Email            Failed
```

#### Detailed Failure Analysis

```powershell
# Get detailed trace for specific failed message
Get-MessageTraceDetail -MessageTraceId "990b654e-bcad-489d-66b1-08ddc579ddd4" -RecipientAddress "john.doe@yourdomain.com"
```

**Critical Error Message**:
```
Event: Fail
Reason: [{LED=550 5.7.703 Your message can't be delivered because messages to john.doe@yourdomain.com...
```

**Error Code Analysis**: `550 5.7.703` is the specific error code for Tenant Allow/Block List blocking, confirming the block list was the cause.

#### External Email Analysis

```powershell
# Check if external emails were delivered successfully after the block
Get-MessageTrace -RecipientAddress "john.doe@yourdomain.com" -StartDate "2025-07-17 08:07:00" -EndDate "2025-07-17 23:59:59" -Status "Delivered" | Where-Object {$_.SenderAddress -notlike "*@yourdomain.com"}
```

**Surprising Results**: External emails were successfully delivered:

```
Received             SenderAddress                        Subject
--------             -------------                        -------
7/17/2025 11:34:38 PM noreply@vendor.com                 Flight Details
7/17/2025 10:48:58 PM shop@retailer.com                  Promotional Email
7/17/2025 1:39:06 PM  partner@external.com               Business Communication
```

### Investigation Phase 4: ProofPoint Connector Analysis

The anomalous behavior led us to examine the ProofPoint integration with O365.

```powershell
# Check for ProofPoint connectors
Get-InboundConnector | Where-Object {$_.Name -like "*proof*" -or $_.ConnectorSource -like "*proof*"}
```

**Discovery**: 
```
Name                         SenderDomains SenderIPAddresses           Enabled
----                         ------------- -----------------           -------
Proofpoint Inbound connector {smtp:*;1}    {67.231.149.0/24, ...}     True
```

```powershell
# Get detailed connector configuration
Get-InboundConnector "Proofpoint Inbound connector" | Format-List
```

**Key Configuration Properties**:
- **SenderDomains**: `{smtp:*;1}` - Accepts from any domain
- **SenderIPAddresses**: Restricted to ProofPoint IP ranges
- **RestrictDomainsToIPAddresses**: True - Only accepts from trusted IPs
- **CloudServicesMailEnabled**: True - Enables certain bypass capabilities

## Technical Explanation: Why the Behavior Occurred

### Email Flow Architecture Analysis

**Internal Email Flow**:
```
Internal Sender → O365 Mail Flow Rules → Tenant Allow/Block List Check → Recipient
                                              ↓
                                         BLOCKED (550 5.7.703)
```

**External Email Flow**:
```
External Sender → ProofPoint Essentials → Trusted Inbound Connector → Recipient
                                                    ↓
                                              BYPASSES Tenant Allow/Block List
```

### The Technical Explanation

The ProofPoint Inbound connector is configured as a **trusted source** that bypasses standard O365 mail flow rules, including the Tenant Allow/Block List. This is intentional design because:

1. **ProofPoint serves as the primary external threat filter**
2. **Trusted connectors have elevated permissions** to bypass certain O365 security checks
3. **Internal emails** still flow through standard O365 routing where security policies apply

This explains why:
- ✅ **External emails continued to deliver** (via ProofPoint's trusted connector)
- ❌ **Internal emails were blocked** (via standard O365 mail flow)

## Resolution Steps

### Step 1: Immediate Remediation

```powershell
# Remove the user from the block list
Remove-TenantAllowBlockListItems -ListType Sender -Entries "john.doe@yourdomain.com"
```

### Step 2: Comprehensive Impact Assessment

```powershell
# Generate comprehensive report of all blocked emails
$blockedEmails = Get-MessageTrace -RecipientAddress "john.doe@yourdomain.com" -StartDate "2025-07-17 08:07:00" -EndDate "2025-07-17 23:59:59" -Status "Failed" | Where-Object {$_.SenderAddress -like "*@yourdomain.com"}

# Export for documentation
$blockedEmails | Select-Object @{Name="Time_CST";Expression={$_.Received.AddHours(-5)}}, SenderAddress, Subject, Status, MessageTraceId | Export-Csv -Path "C:\temp\BlockedEmails_Impact_Assessment.csv" -NoTypeInformation

Write-Host "Total internal emails blocked: $($blockedEmails.Count)"
```

### Step 3: Verification

```powershell
# Verify removal from block list
Get-TenantAllowBlockListItems -ListType Sender | Where-Object {$_.Value -like "*john.doe*"}
```

## Lessons Learned and Preventive Measures

### Technical Insights

1. **User Reports Can Cause False Positives**: The "Report Message" feature can incorrectly target recipients instead of malicious senders
2. **Trusted Connectors Bypass Security Rules**: ProofPoint's trusted connector configuration explains the asymmetric behavior
3. **Audit Logs Are Critical**: The `ListSubType: "Submission"` parameter was key to identifying the root cause

### Recommended Preventive Actions

1. **User Training**: Educate users on proper use of "Report Message" functionality
2. **Monitoring**: Implement alerts for Tenant Allow/Block List changes
3. **Review Process**: Consider implementing approval workflows for user-reported submissions

### PowerShell Monitoring Script

```powershell
# Daily monitoring script for Tenant Allow/Block List changes
$yesterday = (Get-Date).AddDays(-1)
$today = Get-Date

$changes = Search-UnifiedAuditLog -StartDate $yesterday -EndDate $today -Operations "New-TenantAllowBlockListItems","Set-TenantAllowBlockListItems","Remove-TenantAllowBlockListItems" -ResultSize 5000

if ($changes) {
    Write-Host "Tenant Allow/Block List changes detected:" -ForegroundColor Yellow
    $changes | ForEach-Object {
        $details = $_.AuditData | ConvertFrom-Json
        Write-Host "Time: $($_.CreationDate) | Operation: $($_.Operations) | User: $($_.UserIds)" -ForegroundColor Cyan
    }
} else {
    Write-Host "No Tenant Allow/Block List changes in the last 24 hours." -ForegroundColor Green
}
```

## Conclusion

This incident highlighted the importance of understanding complex email security architectures and the interactions between different security layers. The false positive was quickly identified and resolved through systematic investigation using PowerShell and audit logs.

**Key Takeaways**:
- Audit logs provide crucial forensic information for security incidents
- Trusted connectors can create asymmetric email flow behavior
- User education is essential for preventing false positive security reports
- Systematic investigation methodology is critical for complex email issues

The resolution restored normal email flow while maintaining the security benefits of both ProofPoint Essentials and O365 Defender integration.

---

*This article demonstrates real-world troubleshooting techniques for O365 and ProofPoint environments. All domain names and user identities have been anonymized for security purposes.*