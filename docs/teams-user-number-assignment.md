# Retrieving Teams Phone Number Assignments 

## Introduction

This guide demonstrates how to programmatically retrieve Microsoft Teams phone number assignments for users in Entra (Azure AD), combining Python and PowerShell. The approach is modular, production-ready, and company-agnostic. All code is explained step by step, with constants and endpoints included for clarity.

---

## Why Use PowerShell for Teams Phone Assignments?

Some Microsoft Teams telephony data, such as direct phone number assignments, is not always available via the Microsoft Graph API or may require additional permissions and modules. PowerShell modules (such as `MicrosoftTeams` or `SkypeOnlineConnector`) provide richer access to Teams telephony configuration and are often used in enterprise automation for this purpose.

---

## Prerequisites

- Python 3.8+
- The following Python packages:
  - `subprocess` (standard library)
  - `requests`
- PowerShell installed on the system (with the required Teams modules)
- An Azure AD application (service principal) with permissions to read user information
- Secure storage for credentials (e.g., Azure Key Vault)

---

## Step 1: Retrieve Teams Phone Number Assignments

### Function: `get_teams_phone_number_assignments`

This function combines user data from Entra (Azure AD) with Teams phone number assignments, which are typically retrieved via a PowerShell script/module.

```python
def get_teams_phone_number_assignments(aad_users):
    try:
        user_dict = {user['id']: user for user in aad_users}  # Dictionary for faster lookups
        phone_assignments = get_teams_phone_numbers()  # Calls PowerShell to get assignments
        teams_phone_assignments = []
        for assignment in phone_assignments:
            user_id = assignment['AssignedPstnTargetId']
            if user_id in user_dict:
                formatted_assignment = {
                    'assigned_to_entra_account': 'yes',
                    'entra_user': user_dict[user_id].get('displayName','') or '',
                    'teams_telephoneNumber': assignment.get('TelephoneNumber','') or '',
                    'entra_businessPhones': user_dict[user_id].get('businessPhones','') or '',
                    'entra_mobilePhone': user_dict[user_id].get('mobilePhone','') or '',
                    'entra_accountEnabled': user_dict[user_id].get('accountEnabled','') or '',
                    'entra_employeeType': user_dict[user_id].get('employeeType','') or '',
                    'entra_city': user_dict[user_id].get('city','') or '',
                    'entra_officeLocation': user_dict[user_id].get('officeLocation','') or '',
                    'teams_assignmentCategory': assignment.get('AssignmentCategory','') or '',
                    'teams_city': assignment.get('City','') or '',
                    'teams_isosubdivision': assignment.get('IsoSubdivision','') or '',
                    'teams_numbertype': assignment.get('NumberType','') or '',
                    'teams_pstnassignmentstatus': assignment.get('PstnAssignmentStatus','') or '',
                }
            else:
                formatted_assignment = {
                    'assigned_to_entra_account': 'no',
                    'entra_user': '',
                    'teams_telephoneNumber': assignment.get('TelephoneNumber','') or '',
                    'entra_businessPhones': '',
                    'entra_mobilePhone': '',
                    'entra_accountEnabled': '',
                    'entra_employeeType': '',
                    'entra_city': '',
                    'entra_officeLocation': '',
                    'teams_assignmentCategory': assignment.get('AssignmentCategory','') or '',
                    'teams_city': assignment.get('City','') or '',
                    'teams_isosubdivision': assignment.get('IsoSubdivision','') or '',
                    'teams_numbertype': assignment.get('NumberType','') or '',
                    'teams_pstnassignmentstatus': assignment.get('PstnAssignmentStatus','') or '',
                }
            teams_phone_assignments.append(formatted_assignment)
        return teams_phone_assignments
    except Exception as error:
        handle_global_exception(sys._getframe().f_code.co_name, error)
```

**Explanation:**
- Builds a dictionary of users for fast lookup.
- Calls `get_teams_phone_numbers` to retrieve phone assignments (see next step).
- Combines user and phone assignment data into a unified list for reporting or export.

---

## Step 2: Retrieve Teams Phone Numbers via PowerShell

### Function: `get_teams_phone_numbers`

This function (not shown in full here) typically uses Python's `subprocess` module to invoke a PowerShell script or command that retrieves Teams phone number assignments. The PowerShell script should output data in a format that Python can parse (e.g., JSON or CSV).

**Example (conceptual):**

```python
import subprocess
import json

def get_teams_phone_numbers():
    # Example PowerShell command to get Teams phone assignments as JSON
    ps_command = [
        'pwsh', '-Command',
        'Import-Module MicrosoftTeams; Get-CsPhoneNumberAssignment | ConvertTo-Json'
    ]
    result = subprocess.run(ps_command, capture_output=True, text=True)
    if result.returncode != 0:
        raise Exception(f"PowerShell error: {result.stderr}")
    return json.loads(result.stdout)
```

**Explanation:**
- Uses PowerShell to access Teams telephony data not available via Graph API.
- Returns a list of phone assignment dictionaries for further processing in Python.

---

## Step 3: Export or Store the Results

After combining the data, you can export the results to CSV or store them in a database for reporting or compliance purposes.

---

## Conclusion

By following this approach, you can programmatically retrieve and correlate Teams phone number assignments with Entra (Azure AD) user data, using a combination of Python and PowerShell. This enables automated reporting, compliance, and inventory workflows for Teams telephony in your organization.

For more details, see the [Microsoft Teams PowerShell documentation](https://learn.microsoft.com/en-us/powershell/module/teams/?view=teams-ps) and [Microsoft Graph API documentation](https://learn.microsoft.com/en-us/graph/api/resources/user?view=graph-rest-beta).
