# Validating Employee Data Consistency Between UKG and Your HR System

## Introduction

When integrating HR data between systems such as ADP (or any HRIS) and UKG Dimensions, it's critical to ensure that the data loaded into UKG matches the source-of-truth in your HR system. This is especially important when using middleware (like Dell Boomi) for automated data loads. This article provides a step-by-step, company-agnostic guide to:

- Connect securely to the UKG API
- Retrieve employee data from UKG
- Retrieve employee data from your HR system (e.g., ADP)
- Compare the two datasets for validation
- Report discrepancies for remediation

All code is provided in Python, and the approach is suitable for any enterprise environment.

---

## Why Validate Data After Integration?

Automated integrations (e.g., via Dell Boomi) can occasionally result in mismatches due to mapping errors, transformation issues, or upstream data changes. Validating data post-load ensures:

- Data integrity between systems
- Early detection of integration or mapping issues
- Compliance with audit requirements
- Improved trust in downstream business processes

---

## Solution Overview

1. **Connect to UKG API**: Use secure credentials (ideally from Azure Key Vault or similar) to authenticate and retrieve employee data from UKG.
2. **Connect to HR System**: Query your HR system (e.g., ADP) for the same set of employees.
3. **Compare Data**: Match employees by a unique identifier (e.g., email or employee ID) and compare key fields.
4. **Report Results**: Output a report of discrepancies for review and correction.

---

## Step 1: Securely Connect to the UKG API

UKG Dimensions provides a REST API for programmatic access. Authentication typically uses OAuth2 with client credentials. Credentials should be stored securely (e.g., Azure Key Vault).

```python
import requests
import urllib.parse
from your_utils_module import get_azure_kv_sceret  # Replace with your actual secret retrieval function

def get_ukg_environment_credentials(environment):
    if environment == 'PROD':
        return (
            get_azure_kv_sceret('ukg-base-uri'),
            get_azure_kv_sceret('ukg-api-username'),
            get_azure_kv_sceret('ukg-api-password'),
            get_azure_kv_sceret('ukg-api-key'),
            get_azure_kv_sceret('ukg-api-client-id'),
            get_azure_kv_sceret('ukg-api-client-secret')
        )
    else:
        # Use your non-production secrets
        ...

def get_token_apikey_and_uri(environment):
    base_uri, username, password, api_key, client_id, client_secret = get_ukg_environment_credentials(environment)
    access_token_uri = base_uri + 'api/authentication/access_token'
    payload = (
        f"username={urllib.parse.quote(username)}&"
        f"password={urllib.parse.quote(password)}&"
        f"client_id={urllib.parse.quote(client_id)}&"
        f"client_secret={urllib.parse.quote(client_secret)}&"
        "grant_type=password&auth_chain=OAuthLdapService"
    )
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'appkey': api_key
    }
    response = requests.post(access_token_uri, headers=headers, data=payload)
    response.raise_for_status()
    response_json = response.json()
    return response_json["access_token"], base_uri, api_key
```

**Explanation:**
- Credentials are retrieved securely.
- The function requests an OAuth2 access token from UKG.
- The token is used for all subsequent API calls.

---

## Step 2: Retrieve Employee Data from UKG

Once authenticated, you can call the UKG API to retrieve employee details. The following function demonstrates how to fetch all employees and their details:

```python
import requests

def get_all_employees(environment):
    access_token, base_uri, api_key = get_token_apikey_and_uri(environment)
    headers = {
        'Content-Type': 'application/json',
        'appkey': api_key,
        'Authorization': access_token
    }
    employees = []
    # Example endpoint for listing employees (adjust as needed for your UKG tenant)
    url = base_uri + 'api/v1/commons/persons'
    response = requests.get(url, headers=headers)
    response.raise_for_status()
    employees = response.json().get('persons', [])
    return employees
```

**Explanation:**
- Calls the UKG API endpoint to list all employees.
- Returns a list of employee records as dictionaries.

---

## Step 3: Retrieve Employee Data from Your HR System (e.g., ADP)

Assuming you have a database or API access to your HR system, you can retrieve employee data for comparison. Here is a sample function for fetching from a SQL database:

```python
def fetch_users_from_hr():
    sql_query = """
        SELECT email, position_id, status, associate_id, last_name, first_name, location, pay_rate_code, reports_to
        FROM hr_employees
    """
    # Replace with your actual DB query logic
    results = execute_Select_SQL_statement(sql_query)[0]
    return {
        row[0].lower(): {
            "position_id": row[1],
            "status": row[2],
            "associate_id": row[3],
            "last_name": row[4],
            "first_name": row[5],
            "location": row[6],
            "pay_rate_code": row[7],
            "reports_to": row[8]
        } for row in results
    }
```

**Explanation:**
- Queries the HR system for employee data.
- Returns a dictionary keyed by email for easy lookup.

---

## Step 4: Compare and Validate Employee Data

Now, compare the two datasets and report any discrepancies. Here is a function that does this and saves the results to a CSV file:

```python
def compare_ukg_and_hr_employees(ukg_employees, hr_employees):
    processed_details = []
    for employee in ukg_employees:
        username = employee.get('user', {}).get('userAccount', {}).get('userName', None)
        if username and username.lower() in hr_employees:
            hr_user = hr_employees[username.lower()]
            # Compare fields as needed
            processed_details.append({
                'ukg_username': username,
                'ukg_status': employee.get('status'),
                'hr_status': hr_user.get('status'),
                # Add more fields as needed
            })
        else:
            processed_details.append({
                'ukg_username': username,
                'ukg_status': employee.get('status'),
                'hr_status': 'Not Found',
            })
    # Save to CSV for review
    save_list_to_csv(processed_details, 'ukg_hr_comparison.csv')
```

**Explanation:**
- For each UKG employee, attempts to find a match in the HR system by email/username.
- Compares relevant fields and records the results.
- Outputs a CSV file for review.

---

## Step 5: Full Example – Putting It All Together

Here is a complete example that ties all the steps together:

```python
def main(environment='PROD'):
    ukg_employees = get_all_employees(environment)
    hr_employees = fetch_users_from_hr()
    compare_ukg_and_hr_employees(ukg_employees, hr_employees)
    print("Comparison complete. Results saved to ukg_hr_comparison.csv.")

if __name__ == "__main__":
    main()
```

---

## Benefits of Post-Load Validation

- **Data Quality:** Ensures that the data loaded into UKG matches your HR system.
- **Early Issue Detection:** Quickly identifies mapping or integration errors.
- **Audit Readiness:** Provides evidence of data integrity for compliance.
- **Continuous Improvement:** Enables ongoing monitoring and process improvement.

---

## Conclusion

By following this guide, you can automate the validation of employee data between UKG and your HR system, regardless of your integration platform. This approach is scalable, secure, and adaptable to any enterprise environment.

For further enhancements, consider automating the process to run after each integration cycle and integrating with your alerting or ticketing system for proactive remediation.
