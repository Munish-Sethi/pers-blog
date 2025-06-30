# Automating Active Directory User Creation and Group Assignment

## Introduction

Automating user provisioning in Active Directory Domain Services (ADDS) is a common requirement for IT teams managing large organizations. Python, with its rich ecosystem of libraries, makes it possible to programmatically create users and assign them to groups in ADDS. This article provides a detailed walkthrough of a working Python implementation for creating new ADDS users and adding them to groups, using the `ldap3` library and related tools.

## Overview of the Workflow

The core function, `create_new_users_adds`, orchestrates the process of:

1. Establishing a secure connection to the ADDS server.
2. Creating a new user account with the required attributes.
3. Setting the user's password and enabling the account.
4. Adding the user to one or more ADDS groups.

This workflow is modular, with each step handled by a dedicated function or library call, making it easy to adapt for different environments.

---

## Step 1: Establishing a Connection to ADDS

The function `get_adds_Connection` uses the `ldap3` library to connect to the ADDS server over SSL. Credentials are securely retrieved (in this codebase, from Azure Key Vault, but you can use environment variables or other secure stores):

```python
server = ldap3.Server(dc_ip, use_ssl=True)
conn = ldap3.Connection(server, user=LDAP_USER_ID, password=LDAP_USER_PASSWORD)
if not conn.bind():
    print('Error in bind', conn.result)
```

This returns a connection object used for all subsequent LDAP operations.

---

## Step 2: Creating a New User in ADDS

The function `create_adds_user` (called within `create_new_users_adds`) performs the following:

- **Adds the user object:**
  ```python
  conn.add(
      distinguished_name,
      ['top', 'person', 'organizationalPerson', 'user'],
      {
          'givenName': first_name,
          'sn': last_name,
          'sAMAccountName': sam_account_name,
          'userPrincipalName': upn_name,
          'mail': upn_name
      }
  )
  ```
  The `distinguished_name` (DN) specifies the user's location in the directory tree (OU). For generalization, replace any organization-specific OUs with your own structure.

- **Enables the account and sets the password:**
  ```python
  conn.modify(
      distinguished_name,
      {
          'userAccountControl': [(ldap3.MODIFY_REPLACE, [512])],  # Enable the account
          'unicodePwd': [(ldap3.MODIFY_REPLACE, [f'"{default_password}"'.encode('utf-16-le')])]
      }
  )
  ```
  The password must be encoded in UTF-16-LE and quoted. The `userAccountControl` value of 512 enables the account.

---

## Step 3: Adding the User to ADDS Groups

After the user is created, the code assigns them to one or more groups using the `add_members_to_group` function from `ldap3.extend.microsoft.addMembersToGroups`:

```python
add_members_to_group(conn, [distinguished_name], group_dns, fix=True)
```
- `conn`: The active LDAP connection.
- `[distinguished_name]`: A list of user DNs to add.
- `group_dns`: A list of group DNs (distinguished names) to which the user should be added.
- `fix=True`: Ensures the function will attempt to fix any inconsistencies in group membership.

This function performs the necessary LDAP modifications to add the user as a member of each specified group. It is robust and handles group membership updates according to Microsoft's AD schema.

---

## Error Handling and Best Practices

- **Error Handling:** Each step is wrapped in try/except blocks, and errors are logged or emailed to administrators. This is critical for production automation.
- **Security:** Credentials are not hardcoded. Use secure storage for service accounts and passwords.
- **Generalization:** Replace any organization-specific OUs or group names with your own. The logic is portable to any ADDS environment.

---

## Example: Creating and Assigning a User

Here is a simplified, generalized version of the workflow:

```python
from ldap3 import Server, Connection, MODIFY_REPLACE
from ldap3.extend.microsoft.addMembersToGroups import ad_add_members_to_groups as add_members_to_group

# Connect to ADDS
server = Server('your_dc_ip', use_ssl=True)
conn = Connection(server, user='your_user', password='your_password')
conn.bind()

# Create user
dn = 'CN=John Doe,OU=Users,DC=example,DC=com'
conn.add(dn, ['top', 'person', 'organizationalPerson', 'user'], {
    'givenName': 'John',
    'sn': 'Doe',
    'sAMAccountName': 'jdoe',
    'userPrincipalName': 'jdoe@example.com',
    'mail': 'jdoe@example.com'
})

# Enable account and set password
conn.modify(dn, {
    'userAccountControl': [(MODIFY_REPLACE, [512])],
    'unicodePwd': [(MODIFY_REPLACE, ['"YourPassword123!"'.encode('utf-16-le')])]
})

# Add to groups
group_dns = ['CN=YourGroup,OU=Groups,DC=example,DC=com']
add_members_to_group(conn, [dn], group_dns, fix=True)

conn.unbind()
```

---

## Conclusion

With Python and the `ldap3` library, you can fully automate the process of creating users and managing group memberships in Active Directory. This approach is scalable, secure, and adaptable to any ADDS environment. By modularizing each step and handling errors robustly, you can integrate this workflow into larger HR or IT automation pipelines.

---

## References
- [ldap3 Documentation](https://ldap3.readthedocs.io/en/latest/)
- [Microsoft ADDS Schema](https://docs.microsoft.com/en-us/windows/win32/adschema/attributes-all)
- [Python ADDS Automation Examples](https://github.com/cannatag/ldap3)
