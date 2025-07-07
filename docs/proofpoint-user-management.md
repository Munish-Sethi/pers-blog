# Automating User Management in Proofpoint Essentials 

## Introduction

Proofpoint Essentials provides robust APIs for managing users and optimizing licensing. Marking certain users as "functional accounts" (such as service, shared, or terminated accounts) can help reduce licensing costs and improve compliance. This article demonstrates how to:

- Connect to the Proofpoint Essentials API using an API user and key
- Retrieve active users from Proofpoint
- Compare users to your HR system (e.g., ADP or any HRIS)
- Mark users as functional accounts via API

All code is provided in Python, and the approach is company-agnostic and suitable for any enterprise environment.

---

## Prerequisites

- Proofpoint Essentials administrator access
- An API user and API key (see below)
- Python 3.8+ and the `requests` library
- Access to your HR system data (e.g., via SQL, API, or CSV)

---

## How to Create an API Key in Proofpoint Essentials

1. Log in to the Proofpoint Essentials admin portal.
2. Navigate to **Account Management > API Keys**.
3. Click **Create API Key**.
4. Assign the key to a dedicated API user with appropriate permissions.
5. Save the API key securely (e.g., in Azure Key Vault or a secrets manager).

*For more details, refer to the official [Proofpoint Essentials API documentation](https://us1.proofpointessentials.com/api/v1/docs/index.php).*  

---

## Step 1: Connect to the Proofpoint Essentials API

```python
import requests
from your_utils_module import get_azure_kv_sceret  # Replace with your actual secret retrieval function

PROOFPOINT_BASE_API = 'https://<your-region>.proofpointessentials.com/api/v1/'
PROOFPOINT_API_USER = get_azure_kv_sceret('pp-api-user')
PROOFPOINT_API_PASSWORD = get_azure_kv_sceret('pp-api-key')

# Example: Get all users in your organization
url = PROOFPOINT_BASE_API + 'orgs/<your-domain>/users'
response = requests.get(
    url=url,
    headers={'X-user': PROOFPOINT_API_USER, 'X-password': PROOFPOINT_API_PASSWORD},
)
response.raise_for_status()
users = response.json().get('users', [])
```

**Explanation:**
- Credentials are retrieved securely.
- The API call retrieves all users for your organization.

---

## Step 2: Retrieve User Data from Your HR System

Assume you have a function to get user data from your HR system (e.g., via SQL):

```python
def get_latest_hr_data():
    sql_statement = """
        SELECT status, email, company_code, worker_category_code, location_code
        FROM hr_employees WHERE email IS NOT NULL
    """
    return execute_sql_fetch_dicts(sql_statement)
```

---

## Step 3: Compare and Mark Users as Functional Accounts

The following function compares Proofpoint users to your HR data and marks users as functional accounts via the API:

```python
def mark_users_as_functional(hr_users):
    try:
        # Get active users from Proofpoint
        url_to_invoke = PROOFPOINT_BASE_API + 'orgs/<your-domain>/users'
        response = requests.get(
            url=url_to_invoke,
            headers={'X-user': PROOFPOINT_API_USER, 'X-password': PROOFPOINT_API_PASSWORD},
        )
        response.raise_for_status()
        active_users_from_pp = response.json().get('users', [])

        hr_emails = {user['email'].lower(): user for user in hr_users}
        users_to_mark_functional = []

        for user in active_users_from_pp:
            if user.get('type') == 'end_user':
                email = user['primary_email'].lower()
                hr_user = hr_emails.get(email)
                # Example logic: mark as functional if not in HR or if terminated
                if not hr_user or hr_user['status'].lower() == 'terminated':
                    users_to_mark_functional.append(user)

        for user in users_to_mark_functional:
            email_to_lookup = user['primary_email']
            url_update = PROOFPOINT_BASE_API + f'orgs/<your-domain>/users/{email_to_lookup}'
            json_update_values = {
                "uid": user['uid'],
                "primary_email": email_to_lookup,
                "is_active": True,
                "type": "functional_account"
            }
            try:
                requests.put(
                    url_update,
                    json=json_update_values,
                    headers={'X-user': PROOFPOINT_API_USER, 'X-password': PROOFPOINT_API_PASSWORD}
                ).raise_for_status()
            except requests.RequestException:
                pass
        return True
    except Exception as e:
        print(f"Error: {e}")
        return False
```

**Explanation:**
- Retrieves all active users from Proofpoint.
- Compares each user to the HR system.
- Marks users as functional accounts if they are not in HR or are terminated.
- Updates are made via the Proofpoint API.

---

## Full Example: Orchestrating the Process

```python
def main():
    hr_data = get_latest_hr_data()
    mark_users_as_functional(hr_data)

if __name__ == "__main__":
    main()
```

---

## Conclusion

By following this guide, you can automate the process of marking functional accounts in Proofpoint Essentials, optimizing your licensing and compliance posture. The approach is secure, repeatable, and adaptable to any enterprise environment.

For more details, consult the [Proofpoint Essentials API documentation](https://us1.proofpointessentials.com/api/v1/docs/index.php).
