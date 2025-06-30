# Reviewing Consultants via Adaptive Card (Actionable Outlook Messages) – Part 1

In this article, we’ll walk through a real-world Python implementation for reviewing consultants using Adaptive Cards in Outlook. This solution enables managers to receive an actionable email, review their consultants, and submit decisions directly from their inbox. We'll cover the end-to-end process, focusing on how to build and send an actionable Adaptive Card email using Python and Microsoft Graph.

**In Part 2, we’ll cover how to process the manager’s response when they submit the Adaptive Card. [Read Part 2 &rarr;](adaptive-card-consultant-review-part2.md)**

---

## Overview

The workflow consists of the following steps:

1. **Fetch consultants grouped by manager** using `fetch_manager_consultants`.
2. **Build an Adaptive Card** for each manager using `create_adaptive_card_outlook`.
3. **Send the Adaptive Card email** using `send_adaptive_card_email`.

Let’s dive into each step and the code behind it.

---

## 1. Fetching Consultants Grouped by Manager

The function `fetch_manager_consultants(frequency)` retrieves consultants from the database and groups them by their manager’s email.

```python
def fetch_manager_consultants(frequency):
    """Fetch consultants grouped by their manager's email."""
    get_consultants_sql_statement = get_consultants_sql(frequency)
    consultants_data = execute_Select_SQL_statement(get_consultants_sql_statement)[0]
    manager_to_consultants = {}

    try:
        for row in consultants_data:
            manager_email = row[5]
            consultant_info = {
                "in_adp": row[0],
                "name": row[1],
                "last_logon": row[2],
                "email": row[3],
                "last_password_change": row[4],
                "hire_date": row[6],
            }
            manager_to_consultants.setdefault(manager_email, []).append(consultant_info)
    except Exception as error:
        handle_global_exception(sys._getframe().f_code.co_name, Exception)

    return manager_to_consultants
```

- **Key Points:**
  - The function queries the database for consultant data.
  - It organizes consultants by their manager’s email, returning a dictionary mapping each manager to their consultants.

---

## 2. Building the Adaptive Card

The function `create_adaptive_card_outlook(manager_email, consultants)` constructs an Adaptive Card JSON payload for Outlook. This card allows managers to review each consultant and select an action (keep active or deactivate).

```python
def create_adaptive_card_outlook(manager_email, consultants):
    """Create an Adaptive Card with consultant details and actions."""
    try:
        manager_name = manager_email.split('@')[0].split('.')[0]  # Extract manager's first name
        inputs = []
        action_data = {}

        for consultant in consultants:
            consultant_id = consultant["email"].replace("@", "_").replace(".", "_")
            last_logon = consultant['last_logon'] or 'N/A'
            hire_date = consultant['hire_date'] or 'N/A'

            inputs.extend([
                {
                    "type": "TextBlock",
                    "wrap": True,
                    "weight": "Bolder",
                    "color": "Warning",
                    "spacing": "Medium",
                    "text": "****"
                },
                {
                    "type": "Container",
                    "padding": "None",
                    "spacing": "None",
                    "items": [
                        {
                            "type": "TextBlock",
                            "text": f"**{consultant['name']}** ({consultant['email']}), with Last Logon: {last_logon} and Hire Date: {hire_date}",
                            "weight": "Bolder",
                            "wrap": True
                        },
                        {
                            "type": "Input.ChoiceSet",
                            "id": f"decision_{consultant_id}",
                            "isMultiSelect": False,
                            "value": "keep",
                            "choices": [
                                {"title": "Keep Active", "value": "keep"},
                                {"title": "Deactivate", "value": "deactivate"}
                            ],
                            "style": "expanded",
                            "spacing": "None",
                        }
                    ]
                }
            ])
            action_data[consultant_id] = {
                "decision": f"{{{{decision_{consultant_id}.value}}}}",
                "email": consultant["email"],
                "manageremail": manager_email,
                "managername": manager_name,
            }

        inputs.append({
            "type": "TextBlock",
            "wrap": True,
            "weight": "Bolder",
            "color": "Warning",
            "spacing": "Medium",
            "text": "****"
        })

        adaptive_card = {
            "type": "AdaptiveCard",
            "version": "1.0",
            "originator": ORGINATOR_ID,
            "body": [
                {
                    "type": "TextBlock",
                    "text": "Consultant Review",
                    "weight": "bolder",
                    "size": "extraLarge",
                    "color": "attention",
                    "separator": True,
                    "horizontalAlignment": "center",
                    "spacing": "small",
                    "wrap": True
                },
                {
                    "type": "TextBlock",
                    "text": (
                        f"Hello {manager_name}, please review the details of your consultants and select the appropriate action. "
                        "Some consultants may not be in the HR system as they were set up directly as Guest accounts, so their hire date will show as N/A. "
                        "Please review all consultants and provide feedback so that appropriate action can be taken if they no longer require network access."
                    ),
                    "wrap": True,
                    "color": "Default",
                    "spacing": "Medium",
                    "weight": "Bolder"
                }
            ] + inputs,
            "actions": [
                {
                    "type": "Action.Http",
                    "title": "Submit Consultant Actions",
                    "headers": [
                        {"name": "Content-Type", "value": "application/json"},
                        {"name": "Authorization", "value": ""}
                    ],
                    "method": "POST",
                    "url": "https://api.example.com/consultant-review-confirmation",
                    "body": ""
                }
            ],
            "style": "default"
        }
        
        # Prepare the action data for the body
        action_data_str = json.dumps(action_data)
        adaptive_card['actions'][0]['body'] = action_data_str
        
        email_payload = {
            "message": {
            "subject": "Consultant Review - Action Required",
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
            "bccRecipients": [{"emailAddress": {"address": "audit@example.com"}}]
            }
        }

        return email_payload

    except Exception as error:
        handle_global_exception(sys._getframe().f_code.co_name, error)
        return None
```

- **Key Points:**
  - The card is dynamically built for each manager and their consultants.
  - Each consultant has a choice set for the manager to select "Keep Active" or "Deactivate".
  - The card is embedded in the email as a `<script type='application/adaptivecard+json'>...</script>` block, which is required for actionable messages in Outlook.
  - The card uses an `Action.Http` action to POST the manager’s decisions to a specified endpoint.

---

## 3. Sending the Adaptive Card Email

The function `send_adaptive_card_email(email_payload)` sends the constructed Adaptive Card email using the Microsoft Graph API.

```python
def send_adaptive_card_email(email_payload):
    """Send an email with an embedded Adaptive Card using Microsoft Graph API."""
    try:
        user_id = "your-user-guid"
        graph_api_url = f"https://graph.microsoft.com/v1.0/users/{user_id}/sendMail"
        access_token = get_access_token_API_Access_AAD()

        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}

        response = requests.post(graph_api_url, json=email_payload, headers=headers)

        if response.status_code == 202:
            print("Email sent successfully!")
        else:
            print(f"Failed to send email: {response.status_code}, {response.text}")

    except requests.exceptions.RequestException as req_error:
        handle_global_exception(sys._getframe().f_code.co_name, req_error)
        print(f"Request error occurred: {req_error}")

    except Exception as error:
        handle_global_exception(sys._getframe().f_code.co_name, error)
        print(f"An unexpected error occurred: {error}")
```

- **Key Points:**
  - The function authenticates using an Azure AD access token.
  - It sends the email via the Microsoft Graph `/sendMail` endpoint.
  - The Adaptive Card is delivered as an actionable message in Outlook.

---

## End-to-End Example

Here’s how you might orchestrate the process:

```python
def process_consultants(frequency):
    manager_to_consultants = fetch_manager_consultants(frequency)
    for manager_email, consultants in manager_to_consultants.items():
        email_payload = create_adaptive_card_outlook(manager_email, consultants)
        if email_payload:
            send_adaptive_card_email(email_payload)
```

---

## Conclusion

This article (Part 1) demonstrated how to:

- Fetch consultants grouped by manager.
- Build an Adaptive Card for actionable review in Outlook.
- Send the Adaptive Card email using Microsoft Graph.

**In Part 2, we’ll cover how to process the manager’s response when they submit the Adaptive Card. [Read Part 2 &rarr;](adaptive-card-consultant-review-part2.md)**

---