# 📧 Email Security Implementation (O365 and Proof Point Essentials) Series
## Part 2: DNS Configuration and Setup

---

### 📚 **Series Navigation**
- [Part 1: Understanding SPF, DKIM, and DMARC](email-o365-proofpoint-part1.md)
- **Part 2: DNS Configuration and Setup** *(Current)*
- [Part 3: Office 365 Connector Configuration](email-o365-proofpoint-part3.md)
- [Part 4: Proofpoint Integration Setup](email-o365-proofpoint-part4.md)
- [Part 5: Testing and Troubleshooting](email-o365-proofpoint-part5.md)

---

## 🎯 **What We'll Configure**

In this part, we'll set up all the DNS records needed for our email security implementation:
- SPF records (including handling character limits)
- DKIM keys from multiple sources
- DMARC policy with reporting
- MX record for mail routing

---

## 📋 **DNS Records Overview**

Here's what we'll be implementing in your DNS (using Cloudflare as an example):

| Record Type | Name | Purpose |
|-------------|------|---------|
| MX | yourdomain.com | Route mail through Proofpoint |
| TXT | yourdomain.com | Main SPF record |
| TXT | _spf1.yourdomain.com | Additional SPF IPs (Part 1) |
| TXT | _spf2.yourdomain.com | Additional SPF IPs (Part 2) |
| TXT | _dmarc.yourdomain.com | DMARC policy |
| CNAME | hs1-19543953._domainkey | Office 365 DKIM key |
| CNAME | hs2-19543953._domainkey | Office 365 DKIM key |
| TXT | selector-1678913997._domainkey | Proofpoint DKIM key |

---

## 📧 **MX Record Configuration**

### **Step 1: Update MX Record**

The MX record tells the internet where to deliver emails for your domain. We'll route everything through Proofpoint first.

```dns
Type: MX
Name: yourdomain.com
Value: mx2-us1.ppe-hosted.com
Priority: 10
```

#### **Why This Matters:**
- All inbound emails will go to Proofpoint first for filtering
- Proofpoint will then forward clean emails to Office 365
- This prevents bad actors from bypassing your security by sending directly to O365

---

## 🛡️ **SPF Record Configuration**

### **The Challenge: Character Limits**

SPF records have a 255-character limit, but we need to include many IP addresses and services. The solution is to split our SPF record across multiple DNS entries.

### **Step 2: Main SPF Record**

```dns
Type: TXT
Name: yourdomain.com
Value: "v=spf1 a:dispatch-us.ppe-hosted.com ip4:20.81.4.12 include:spf.protection.outlook.com include:19543953.spf07.hubspotemail.net include:_spf1.yourdomain.com include:_spf2.yourdomain.com include:sendgrid.net ~all"
```

#### **Breaking Down This Record:**
- **`v=spf1`**: SPF version identifier
- **`a:dispatch-us.ppe-hosted.com`**: Allow Proofpoint's dispatch server
- **`ip4:XX.XX.XX.XX`**: Specific IP address (likely internal system)
- **`include:spf.protection.outlook.com`**: Allow Office 365 to send
- **`include:19543953.spf07.hubspotemail.net`**: Allow HubSpot to send
- **`include:_spf1.yourdomain.com`**: Reference to our first IP list
- **`include:_spf2.yourdomain.com`**: Reference to our second IP list
- **`include:sendgrid.net`**: Allow SendGrid to send
- **`~all`**: Soft fail for all other sources (monitoring mode)

### **Step 3: First IP Address Block (_spf1)**

```dns
Type: TXT
Name: _spf1.yourdomain.com
Value: "v=spf1 ip4:XXX.YYY.XX.YYY ip4:XXX.XXX.XXX.XXX"
```

### **Step 4: Second IP Address Block (_spf2)**

```dns
Type: TXT
Name: _spf2.yourdomain.com
Value: "v=spf1 ip4:XXX.YYY.XX.YYY ip4:XXX.XXX.XXX.XXX"
```

#### **What These IPs Represent:**
These are your company's trusted locations and public IP addresses, including:
- Office locations
- Data centers
- Remote offices
- Any systems that need to send email directly

> **⚠️ Important Note**: These same IP addresses will appear in your Office 365 SMTP Relay connector configuration. This alignment is crucial for proper email flow.

---

## 🔑 **DKIM Configuration**

DKIM requires both public and private keys. The private keys stay on your email servers, while public keys go in DNS.

### **Step 5: Office 365 DKIM Keys (CNAMEs)**

Office 365 manages these keys for you, so we create CNAME records that point to Microsoft's infrastructure:

```dns
Type: CNAME
Name: hs1-19543953._domainkey
Value: hs1-19543953._domainkey.yourdomain.onmicrosoft.com

Type: CNAME
Name: hs2-19543953._domainkey
Value: hs2-19543953._domainkey.yourdomain.onmicrosoft.com
```

#### **Finding Your O365 DKIM Values:**
1. Go to Microsoft 365 Admin Center
2. Navigate to **Setup** > **Domains**
3. Select your domain
4. Look for DKIM configuration section
5. Copy the CNAME values provided

### **Step 6: Proofpoint DKIM Key (TXT)**

This is a TXT record with the public key that Proofpoint generates:

```dns
Type: TXT
Name: selector-1678913997._domainkey
Value: "v=DKIM1; k=rsa; t=s; n=core; p=publickeygoeshere"
```

#### **How to Get Your Proofpoint DKIM Key:**
1. Log into Proofpoint Essentials admin portal
2. Navigate to **Email** > **Domains**
3. Select your domain
4. Look for DKIM configuration section
5. Generate or copy the public key
6. The selector name will be provided by Proofpoint

---

## 📊 **DMARC Configuration**

DMARC ties SPF and DKIM together and provides valuable reporting.

### **Step 7: DMARC Policy Record**

```dns
Type: TXT
Name: _dmarc.yourdomain.com
Value: "v=DMARC1; p=quarantine; fo=1; rua=mailto:84c81b71e65344cfb4a5900d6c64d628@dmarc-reports.cloudflare.net,mailto:admin@yourdomain.com"
```

#### **Breaking Down This Record:**
- **`v=DMARC1`**: DMARC version
- **`p=quarantine`**: Policy for emails that fail authentication (send to spam)
- **`fo=1`**: Forensic reporting options (generate reports on failure)
- **`rua=mailto:...`**: Where to send aggregate reports

#### **DMARC Policy Evolution:**
Start with `p=none` for monitoring, then gradually move to:
1. **`p=none`** → Monitor and collect data (recommended start)
2. **`p=quarantine`** → Send suspicious emails to spam
3. **`p=reject`** → Completely block suspicious emails (final goal)

---

## 🛠️ **Implementation Steps**

### **Phase 1: Preparation**
1. **Document existing records** - Take screenshots of current DNS
2. **Lower TTL values** - Set TTL to 300 (5 minutes) for faster changes
3. **Plan timing** - Implement during low-traffic hours

### **Phase 2: Implementation Order**
1. **Add the split SPF records first** (_spf1 and _spf2)
2. **Update the main SPF record**
3. **Add MX record**
4. **Configure DKIM records**
5. **Add DMARC record** (start with `p=none`)

### **Phase 3: Verification**
After each record, verify using online tools:
- **SPF**: `dig TXT yourdomain.com`
- **DKIM**: `dig TXT selector._domainkey.yourdomain.com`
- **DMARC**: `dig TXT _dmarc.yourdomain.com`

---

## 🔍 **DNS Verification Commands**

### **Using dig (Linux/Mac/Windows with WSL):**
```bash
# Check SPF record
dig TXT yourdomain.com

# Check DKIM records
dig TXT hs1-19543953._domainkey.yourdomain.com
dig TXT selector-1678913997._domainkey.yourdomain.com

# Check DMARC record
dig TXT _dmarc.yourdomain.com

# Check MX record
dig MX yourdomain.com
```

### **Using nslookup (Windows):**
```cmd
# Check SPF record
nslookup -type=TXT yourdomain.com

# Check DMARC record
nslookup -type=TXT _dmarc.yourdomain.com
```

---

## ⚠️ **Common Pitfalls and Solutions**

### **SPF Issues:**
- **Too many DNS lookups**: SPF has a 10-lookup limit
- **Multiple SPF records**: Only one SPF record per domain allowed
- **Character limits**: Use includes and split records as shown

### **DKIM Issues:**
- **Selector mismatch**: Ensure selector names match between DNS and service
- **Key formatting**: Remove spaces and line breaks from public keys

### **DMARC Issues:**
- **Invalid syntax**: Use DMARC validators before publishing
- **Missing prerequisites**: SPF and DKIM must work before DMARC is effective

---

## ✅ **Verification Checklist**

Before moving to Part 3, ensure:
- [ ] All DNS records are published and propagated
- [ ] SPF record includes all necessary services and IPs
- [ ] DKIM keys are properly formatted and accessible
- [ ] DMARC record has correct syntax and reporting addresses
- [ ] MX record points to Proofpoint
- [ ] You have access to DMARC reports

---

## 🎯 **What's Next**

With DNS configured, we'll move to **Part 3** where we'll set up the Office 365 connectors that work with these DNS records to ensure proper mail flow and security.

---

### 📖 **Series Navigation**
- [← Part 1: Understanding SPF, DKIM, and DMARC](email-o365-proofpoint-part1.md)
- **Part 2: DNS Configuration and Setup** *(Current)*
- [Part 3: Office 365 Connector Configuration →](email-o365-proofpoint-part3.md)

---

*Remember to always test DNS changes in a non-production environment first and monitor email flow carefully during implementation.*