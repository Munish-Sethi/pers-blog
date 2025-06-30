# Automating SAP Concur Expense Report Aggregation and Adaptive Card Notifications

## Introduction

This article provides a comprehensive, company-agnostic walkthrough for automating SAP Concur expense report aggregation and delivering actionable, interactive notifications to managers using Adaptive Cards. We’ll cover:

- Securely connecting to SAP Concur with OAuth2
- Fetching and processing users and expense reports
- Aggregating by employee and by full management chain (organization-wide rollup)
- Creating and sending Adaptive Card emails with summary/detail toggles
- All supporting functions, with code and explanations

By the end, you’ll be able to connect to your own SAP Concur instance and deliver organization-wide expense insights to managers in a modern, interactive format.

---

## 1. Connecting to SAP Concur API

To fetch expense reports, you need to:
- Obtain an OAuth2 access token using your SAP Concur client credentials and refresh token.
- Use the access token to call the Concur API endpoints for users and expense reports.

### Supporting Function: `get_scope()`
SAP Concur APIs require a specific OAuth2 scope string. This function returns the required scope for all expense and user operations:

```python
def get_scope():
    return (
        "openid USER user.read user.write LIST spend.list.read spend.listitem.read CONFIG EXPRPT FISVC "
        "creditcardaccount.read IMAGE expense.exchangerate.writeonly profile.user.generaluser.read "
        "profile.user.generalemployee.read expense.report.read expense.report.readwrite spend.list.write "
        "spend.listitem.write identity.user.ids.read identity.user.core.read identity.user.coresensitive.read "
        "identity.user.enterprise.read identity.user.event.read"
    )
```

### Supporting Function: `get_access_token()`
This function retrieves an OAuth2 access token using your client ID, secret, and refresh token:

```python
def get_access_token():
    try:
        return get_authentication_token(
            client_id=SAP_CONCUR_CLIENT_APP_ID,
            client_secret=SAP_CONCUR_CLIENT_SECRET,
            refresh_token=SAP_CONCUR_REFRESH_TOKEN,
            scope=get_scope(),
        )
    except Exception as e:
        handle_global_exception(sys._getframe().f_code.co_name, e)
        return None
```

### Supporting Function: `get_authentication_token()`
Handles the actual OAuth2 token request:

```python
def get_authentication_token(client_id, client_secret, refresh_token, scope):
    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    data = {
        "grant_type": "refresh_token",
        "refresh_token": refresh_token,
        "scope": scope,
        "client_id": client_id,
        "client_secret": client_secret,
    }
    response = requests.post(SAP_CONCUR_OAUTH_END_POINT, headers=headers, data=data)
    response.raise_for_status()
    return response.json().get("access_token")
```

### Supporting Function: `get_cached_access_token()`
Caches the access token to avoid unnecessary requests:

```python
access_token_cache = {"token": None, "expires_at": None}

def get_cached_access_token():
    if access_token_cache["token"] and access_token_cache["expires_at"] > datetime.now(timezone.utc):
        return access_token_cache["token"]
    new_token = get_access_token()
    if new_token:
        access_token_cache["token"] = new_token
        access_token_cache["expires_at"] = datetime.now(timezone.utc) + timedelta(hours=1)
    return new_token
```

---

## 2. Fetching Users and Expense Reports

### Supporting Function: `get_all_sap_concur_users()`
Fetches all users from SAP Concur (with pagination):

```python
def get_all_sap_concur_users():
    try:
        access_token = get_cached_access_token()
        base_url = "https://us.api.concursolutions.com/profile/identity/v4.1/Users"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json"
        }
        all_users = []
        next_cursor = None
        while True:
            url = base_url
            if next_cursor:
                url += f"?cursor={next_cursor}"
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()
            all_users.extend(data.get("items", []))
            next_cursor = data.get("nextCursor")
            if not next_cursor:
                break
        return all_users
    except Exception as e:
        handle_global_exception(sys._getframe().f_code.co_name, e)
        return []
```

### Supporting Function: `fetch_expense_reports()`
Fetches all expense reports for a given user:

```python
def fetch_expense_reports(user_name, query_parameters):
    access_token = get_cached_access_token()
    base_url = f"https://us.api.concursolutions.com/api/v3.0/expense/reports"
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
    reports = []
    next_page = f"{base_url}?user={user_name}{query_parameters}"
    while next_page:
        response = requests.get(next_page, headers=headers)
        response.raise_for_status()
        data = response.json()
        reports.extend(data.get("Items", []))
        next_page = data.get("NextPage")
    return reports
```

### Supporting Function: `fetch_all_expense_reports()`
Fetches all reports for all users:

```python
def fetch_all_expense_reports(user_mappings, query_parameters):
    all_reports = []
    for user in user_mappings:
        reports = fetch_expense_reports(user, query_parameters)
        for report in reports:
            report["UserId"] = user
        all_reports.extend(reports)
    return all_reports
```

---

## 3. Processing and Aggregating Reports

### Supporting Function: `process_reports()`
Normalizes report data for aggregation:

```python
def process_reports(all_reports):
    return [
        {
            "UserId": report.get("UserId"),
            "Name": report.get("Name"),
            "Total": report.get("Total"),
            "CurrencyCode": report.get("CurrencyCode"),
            "SubmitDate": report.get("SubmitDate"),
            "OwnerLoginID": report.get("OwnerLoginID"),
            "OwnerName": report.get("OwnerName"),
            "ApproverLoginID": report.get("ApproverLoginID"),
            "ApproverName": report.get("ApproverName"),
            "ApprovalStatusName": report.get("ApprovalStatusName"),
            "ApprovalStatusCode": report.get("ApprovalStatusCode"),
            "PaymentStatusName": report.get("PaymentStatusName"),
            "PaymentStatusCode": report.get("PaymentStatusCode"),
            "LastModifiedDate": report.get("LastModifiedDate"),
            "AmountDueEmployee": report.get("AmountDueEmployee"),
            "AmountDueCompanyCard": report.get("AmountDueCompanyCard"),
            "TotalClaimedAmount": report.get("TotalClaimedAmount"),
            "TotalApprovedAmount": report.get("TotalApprovedAmount"),
            "LedgerName": report.get("LedgerName"),
            "PolicyID": report.get("PolicyID"),
            "EverSentBack": report.get("EverSentBack"),
            "HasException": report.get("HasException"),
            "URI": report.get("URI"),
        }
        for report in all_reports
    ]
```

### Aggregating by Employee: `aggregate_expense_reports_by_employee()`
Groups and sums expense reports for each employee, optionally by approval status or by individual report.

```python
def aggregate_expense_reports_by_employee(processed_reports, summary):
    employee_reports = {}
    for report in processed_reports:
        user_name = str(report.get("OwnerLoginID", "") or "").lower()
        report_name = report.get("Name", "")
        report_id = report.get("ReportID", "")
        approval_status_code = str(report.get("ApprovalStatusCode", "") or "").lower()
        approval_status_name = report.get("ApprovalStatusName", "")
        key = (
            f"{approval_status_code}-({approval_status_name})"
            if summary
            else f"{report_name}-({report_id})-{approval_status_code}-({approval_status_name})"
        )
        total = report.get("Total", 0)
        employee_reports.setdefault(user_name, {}).setdefault(key, 0)
        employee_reports[user_name][key] += total
    return employee_reports
```

### Aggregating by Organization: `aggregate_expense_reports_by_full_oraganization()`
Rolls up expense totals for each manager, including all direct and indirect reports, using a recursive helper.

```python
def aggregate_expense_reports_by_full_oraganization(processed_reports, management_upns, summary):
    object_organization_reports = {}
    # Build a reverse mapping of manager to their direct reports
    manager_to_reports = {}
    for employee, details in management_upns.items():
        manager = details.get("manager")
        if manager:
            manager_to_reports.setdefault(manager.lower(), []).append(employee.lower())
    def aggregate_totals_upwards(manager, visited):
        if manager in visited:
            return
        visited.add(manager)
        if manager not in object_organization_reports:
            object_organization_reports[manager] = {}
        for employee in manager_to_reports.get(manager, []):
            aggregate_totals_upwards(employee, visited)
            for status, total in object_organization_reports.get(employee, {}).items():
                if status not in object_organization_reports[manager]:
                    object_organization_reports[manager][status] = 0
                object_organization_reports[manager][status] += total
    # Populate initial totals for each employee based on processed reports
    for report in processed_reports:
        if report.get("UserManager"):
            user_manager = report.get("UserManager", "").lower()
        else:
            continue
        approval_status_code = report.get("ApprovalStatusCode", "").lower()
        approval_status_name = report.get("ApprovalStatusName", "")
        user_name = report.get("OwnerLoginID", "")
        key = f"{approval_status_code}-({approval_status_name})" if summary else f"{user_name}-{approval_status_code}-({approval_status_name})"
        total = report.get("Total", 0)
        if user_manager not in object_organization_reports:
            object_organization_reports[user_manager] = {}
        if key not in object_organization_reports[user_manager]:
            object_organization_reports[user_manager][key] = 0
        object_organization_reports[user_manager][key] += total
    # Aggregate totals upwards starting from all unique managers
    visited = set()
    for manager in manager_to_reports.keys():
        aggregate_totals_upwards(manager, visited)
    return object_organization_reports
```

---

## 4. Creating Adaptive Card Emails (Summary vs. Detail Toggle)

Adaptive Cards are JSON payloads that Outlook and Teams can render as interactive UI. Here’s how to create a card with a summary and a toggle for details:

```python
def create_adaptive_info_card_for_manager(manager_email, summary_by_employee, summary_by_organization, detail_by_organization, user_expense_reports):
    try:
        summary_total = summary_by_organization.get(manager_email, 0)
        detail_items = [
            {
                "type": "TextBlock",
                "text": f"{user}: {summary_by_employee.get(user, 0):,.2f}",
                "wrap": True
            }
            for user in detail_by_organization.get(manager_email, [])
        ]
        adaptive_card = {
            "type": "AdaptiveCard",
            "version": "1.4",
            "body": [
                {"type": "TextBlock", "text": "Expense Report Summary", "weight": "Bolder", "size": "Large"},
                {"type": "TextBlock", "text": f"Total for your organization: {summary_total:,.2f}", "wrap": True},
                {
                    "type": "TextBlock",
                    "text": "Click below to view details.",
                    "wrap": True,
                    "spacing": "Medium"
                },
                {
                    "type": "Container",
                    "id": "detailsContainer",
                    "isVisible": False,
                    "items": detail_items
                }
            ],
            "actions": [
                {
                    "type": "Action.ToggleVisibility",
                    "title": "Show/Hide Details",
                    "targetElements": ["detailsContainer"]
                }
            ]
        }
        return adaptive_card
    except Exception as e:
        handle_global_exception(sys._getframe().f_code.co_name, e)
        return None
```

### Sending the Adaptive Card Email

```python
def send_adaptive_info_email_to_manager(manager_email, summary_by_employee, summary_by_organization, detail_by_organization, user_expense_reports):
    adaptive_card = create_adaptive_info_card_for_manager(
        manager_email, summary_by_employee, summary_by_organization, detail_by_organization, user_expense_reports
    )
    email_payload = {
        "message": {
            "subject": "Expense Report Summary",
            "body": {
                "contentType": "HTML",
                "content": (
                    f"<html><head><meta http-equiv='Content-Type' content='text/html; charset=utf-8'>"
                    f"<script type='application/adaptivecard+json'>{json.dumps(adaptive_card, indent=4)}</script>"
                    f"</head><body><p></p></body></html>"
                )
            },
            "from": {"emailAddress": {"address": SMTP_FROM_SEND_EMAIL}},
            "toRecipients": [{"emailAddress": {"address": manager_email}}],
        }
    }
    send_adaptive_card_email(email_payload)
```

---

## 5. End-to-End Workflow Example

Here’s a high-level workflow you can adapt:

```python
def main():
    # 1. Fetch management hierarchy from your HR system
    management_upns = fetch_management_upns()  # {employee: {"manager": manager_email, ...}}
    # 2. Fetch all SAP Concur users
    sap_concur_users = get_all_sap_concur_users()
    # 3. Fetch all expense reports for all users
    all_reports = fetch_all_expense_reports(sap_concur_users, "&submitDateAfter=2025-01-01")
    # 4. Normalize and process reports
    processed_reports = process_reports(all_reports)
    # 5. Aggregate by employee and organization
    summary_by_employee = aggregate_expense_reports_by_employee(processed_reports, True)
    summary_by_organization = aggregate_expense_reports_by_full_oraganization(processed_reports, management_upns, True)
    detail_by_organization = aggregate_expense_reports_by_full_oraganization(processed_reports, management_upns, False)
    # 6. Send Adaptive Card emails to each manager
    for manager_email in summary_by_organization:
        send_adaptive_info_email_to_manager(
            manager_email, summary_by_employee, summary_by_organization, detail_by_organization, processed_reports
        )
```

---

## References
- [SAP Concur API Reference](https://developer.concur.com/api-reference/)
- [Microsoft Adaptive Cards](https://adaptivecards.io/)
- [Microsoft Graph API for Sending Mail](https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview)

---

## Conclusion

With these patterns and supporting functions, you can connect to your own SAP Concur instance, fetch and aggregate expense reports by employee and by full reporting chain, and deliver actionable, interactive notifications to managers using Adaptive Cards. This enables powerful, organization-wide financial insights and automated reporting for managers at every level.
