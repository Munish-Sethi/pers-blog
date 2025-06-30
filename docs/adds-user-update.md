# Updating Active Directory User Attributes

## Introduction

Active Directory Domain Services (ADDS) is the backbone of identity management in many organizations. While user creation and group assignment are common automation tasks, updating user attributes—both standard (delivered) and custom—is equally important for keeping directory data accurate and useful. This article explains, with practical Python code, how to update ADDS user attributes using the `ldap3` library, focusing on the function `update_existing_users_adds`.

---

## Understanding ADDS Attributes: Delivered vs. Custom

- **Delivered (Standard) Attributes:**
  - These are built-in attributes provided by Microsoft, such as `givenName`, `sn`, `title`, `department`, `telephoneNumber`, etc.
  - They are part of the default AD schema and are widely supported by tools and scripts.
- **Custom Attributes:**
  - Organizations can extend the AD schema to include custom attributes (e.g., `extensionAttribute1`, `departmentNumber`).
  - These are used for business-specific data not covered by standard attributes.

Both types can be updated using the same LDAP operations.

---

## The Python Approach: Using ldap3

The `ldap3` library provides a high-level, Pythonic interface for interacting with ADDS. The function `update_existing_users_adds` demonstrates how to:

1. Build a dictionary of user attributes to update (both standard and custom).
2. Connect to ADDS securely.
3. Use the `modify` method to update attributes for each user.
4. Handle errors and notify administrators if updates fail.

---

## Step-by-Step: Updating User Attributes

### 1. Prepare the Attribute Dictionary

For each user, a dictionary is built with the attributes to update. This can include both delivered and custom attributes:

```python
item = {
    'displayName': display_name,           # Standard
    'givenName': first_name,               # Standard
    'sn': last_name,                       # Standard
    'title': title,                        # Standard
    'department': department,              # Standard
    'employeeType': employee_type,         # Standard
    'extensionAttribute1': is_mgmt_position, # Custom
    'manager': manager_dn,                 # Standard (DN of manager)
    # ... add more as needed ...
}
```

### 2. Connect to ADDS

```python
from ldap3 import Server, Connection, MODIFY_REPLACE

server = Server('your_dc_ip', use_ssl=True)
conn = Connection(server, user='your_user', password='your_password')
conn.bind()
```

### 3. Update Attributes with `modify`

The `modify` method is used to update one or more attributes for a user. The changes dictionary maps attribute names to a tuple specifying the operation (e.g., `MODIFY_REPLACE`) and the new value(s):

```python
changes = {key: (MODIFY_REPLACE, [value]) for key, value in item.items() if value}
conn.modify(dn=distinguished_name, changes=changes)
```
- `dn`: The distinguished name of the user to update.
- `changes`: A dictionary of attribute updates.

### 4. Error Handling and Notification

After each modify operation, the result is checked. If the update fails, an email notification is sent to administrators:

```python
if conn.result['result'] != 0:
    send_email(
        recipients=['admin@example.com'],
        subject=f'Error while updating user {distinguished_name}',
        plain_message=f"An error occurred while modifying user: {conn.result}",
    )
```

---

## Example: Updating a User's Attributes

Here is a simplified, generalized example:

```python
from ldap3 import Server, Connection, MODIFY_REPLACE

server = Server('your_dc_ip', use_ssl=True)
conn = Connection(server, user='your_user', password='your_password')
conn.bind()

dn = 'CN=John Doe,OU=Users,DC=example,DC=com'
changes = {
    'title': (MODIFY_REPLACE, ['Senior Engineer']),
    'department': (MODIFY_REPLACE, ['Engineering']),
    'extensionAttribute1': (MODIFY_REPLACE, ['Project Lead'])
}
conn.modify(dn=dn, changes=changes)

if conn.result['result'] != 0:
    print(f"Error updating user: {conn.result}")

conn.unbind()
```

---

## Best Practices

- **Batch Updates:** You can update multiple attributes in a single `modify` call for efficiency.
- **Custom Attributes:** Ensure custom attributes exist in your AD schema before attempting to update them.
- **Error Handling:** Always check the result of LDAP operations and log or notify on failure.
- **Security:** Never hardcode credentials; use secure storage.

---

## Conclusion

Updating user attributes in ADDS with Python and `ldap3` is straightforward and powerful. Whether you are updating standard or custom attributes, the process is the same. By following the approach in `update_existing_users_adds`, you can automate directory maintenance and ensure your AD data stays current and accurate.

---

## References
- [ldap3 Documentation](https://ldap3.readthedocs.io/en/latest/)
- [Microsoft ADDS Schema](https://docs.microsoft.com/en-us/windows/win32/adschema/attributes-all)
- [Python ADDS Automation Examples](https://github.com/cannatag/ldap3)
