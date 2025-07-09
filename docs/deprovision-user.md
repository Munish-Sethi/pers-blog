# Automating User Deprovisioning in Microsoft 365: OneDrive and Mailbox Reassignment

When an employee leaves an organization, it's critical to deprovision their accounts securely and efficiently, while ensuring business continuity. This article demonstrates a Python-based approach to automate user deprovisioning in Microsoft 365, focusing on:

- Disabling accounts in Active Directory (AD/ADDS)
- Disabling accounts in Entra ID (Azure AD)
- Assigning the user's OneDrive and mailbox access to their manager

We will walk through the following functions:
- `terminate_employees_adds`
- `terminate_employees_entra`
- `grant_access_to_users_mailbox`

## Prerequisites

- Python 3.8+
- Required libraries:
  - `requests`
  - `msal` (Microsoft Authentication Library)
  - `subprocess` (standard library)
  - `PnP.PowerShell` and `ExchangeOnlineManagement` PowerShell modules installed on a system with PowerShell Core
- Service principal with appropriate permissions in Microsoft 365
- Certificate-based authentication for automation

---

## 1. Disabling Users in Active Directory (AD/ADDS)

The function `terminate_employees_adds` connects to AD and disables user accounts. This is typically done using the `ldap3` library, but the code can be adapted for other libraries or direct PowerShell calls.

```python
def terminate_employees_adds(terminated_employees):
    try:
        conn = get_adds_Connection()
        if not conn:
            return
        for employee in terminated_employees:
            # Example: Disable the user account
            user_dn = employee['distinguishedName']
            conn.modify(user_dn, {'userAccountControl': [(ldap3.MODIFY_REPLACE, [514])]})
    except Exception as e:
        handle_global_exception(sys._getframe().f_code.co_name, e)
    finally:
        if conn:
            conn.unbind()
```

- **Explanation:**
  - Connects to AD using a service account.
  - Iterates through the list of terminated employees.
  - Sets the `userAccountControl` attribute to `514` (disabled).

---

## 2. Disabling Users in Entra ID (Azure AD)

The function `terminate_employees_entra` disables the user in Entra ID and then delegates OneDrive and mailbox access to the user's manager.

```python
def terminate_employees_entra(terminated_employees, existing_employees):
    try:
        existing_employee_dict = {str(employee['hr_PositionID']).lower(): employee for employee in existing_employees}
        for terminated_employee in terminated_employees:
            terminated_user_reportsto_id = terminated_employee['hr_ReportsToPositionID']
            if str(terminated_user_reportsto_id).lower() in existing_employee_dict:
                manager = existing_employee_dict[str(terminated_user_reportsto_id).lower()]
                manager_email = manager['entra_mail']

            entra_id = terminated_employee.get('entra_id')
            terminated_user_email = terminated_employee.get('entra_userPrincipalName')
            if entra_id:
                entra_onedrive_url = grant_access_to_users_onedrive(
                                        terminated_user_email, 
                                        manager_email)
                grant_access_to_users_mailbox(
                                        terminated_user_email, 
                                        manager_email)  
                terminated_employee['entra_onedrive_url'] = entra_onedrive_url
    except Exception as e:
        handle_global_exception(sys._getframe().f_code.co_name, e)
        return False
```

- **Explanation:**
  - Looks up the manager for each terminated employee.
  - Calls helper functions to delegate OneDrive and mailbox access to the manager.

---

## 3. Assigning OneDrive Access to the Manager

The function `grant_access_to_users_onedrive` uses Microsoft Graph API to get the user's OneDrive URL, then uses PowerShell to assign the manager as the site owner.

```python
def grant_access_to_users_onedrive(terminated_user_email, manager_email):
    try:
        access_token = get_access_token_API_Access_AAD()
        url = f"https://graph.microsoft.com/v1.0/users/{terminated_user_email}/drive"
        response = requests.get(url, headers={'Authorization': f'Bearer {access_token}'})
        response.raise_for_status()
        graph_data = response.json()
        user_onedrive_url = graph_data['webUrl']

        command_to_run = f'''
        Import-Module PnP.PowerShell
        Connect-PnPOnline -Url <SharePointRootUrl> -ClientId <AppId> -Tenant <TenantName> -CertificatePath <CertPath>
        $OneDriveSiteUrl = "{user_onedrive_url.replace('/Documents', '')}"
        $SiteCollAdmin = "{manager_email}"
        Set-PnPTenantSite -Url $OneDriveSiteUrl -Owners $SiteCollAdmin
        '''
        command_result = execute_powershell_command(command_to_run)
        if command_result.returncode != 0:
            return ''
        return user_onedrive_url
    except Exception as e:
        handle_global_exception(sys._getframe().f_code.co_name, e)
        return ''
```

- **Explanation:**
  - Retrieves the user's OneDrive URL via Microsoft Graph.
  - Uses PnP PowerShell to assign the manager as the site owner.
  - Requires certificate-based authentication for automation.

---

## 4. Assigning Mailbox Access to the Manager

The function `grant_access_to_users_mailbox` uses PowerShell to grant the manager full access to the user's mailbox.

```python
def grant_access_to_users_mailbox(terminated_user_email, manager_email):
    try:
        command_to_run = f'''
        Import-Module ExchangeOnlineManagement
        Connect-ExchangeOnline -CertificateFilePath <CertPath> -AppID <AppId> -Organization <TenantName>
        Add-MailboxPermission -Identity {terminated_user_email} -User {manager_email} -AccessRights FullAccess -InheritanceType All
        '''
        command_result = execute_powershell_command(command_to_run)
        if command_result.returncode != 0:
            return ''
        return command_result
    except Exception as e:
        handle_global_exception(sys._getframe().f_code.co_name, e)
        return None
```

- **Explanation:**
  - Connects to Exchange Online using certificate-based authentication.
  - Grants the manager full access to the terminated user's mailbox.

---

## 5. Methodology and Best Practices

- **Automation:** All steps are automated to reduce manual errors and speed up offboarding.
- **Security:** Uses certificate-based authentication for all automated PowerShell and Graph API calls.
- **Separation of Duties:** The terminated user's data is not deleted immediately, but access is reassigned to their manager for business continuity.
- **Error Handling:** All functions use a global exception handler to log and notify on errors.

---

## 6. Required Libraries and Tools

- `requests` for REST API calls
- `msal` for Microsoft authentication
- `ldap3` for AD/LDAP operations
- `PnP.PowerShell` and `ExchangeOnlineManagement` PowerShell modules
- Service principal with delegated permissions and certificate

---

## 7. Conclusion

Automating user deprovisioning in Microsoft 365 ensures compliance, security, and business continuity. By delegating OneDrive and mailbox access to managers, organizations can maintain access to critical data while protecting sensitive information.

**Note:**
- Replace placeholders like `<SharePointRootUrl>`, `<AppId>`, `<TenantName>`, and `<CertPath>` with your actual values.
- Always test automation in a non-production environment before rolling out to production.
