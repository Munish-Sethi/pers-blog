# Company-Agnostic Adaptive Card Consultant Review Blog (Part 2, Deep Dive)

## Introduction
In [Part 1](./adaptive-card-consultant-review-part1.md), we covered how to send actionable Adaptive Card emails for consultant review. In this Part 2, we focus on the backend: how to securely receive, verify, and process the manager's response when the Adaptive Card is submitted. This article recursively examines each function involved in the request processing chain, providing a complete, end-to-end understanding of how an incoming Adaptive Card request is handled—with all relevant Python code included and all company-specific references replaced with generic placeholders (e.g., `mycompany.com`).

---

## 1. Endpoint: `/consultant-review-confirmation`

When a manager submits the Adaptive Card, the card's action posts the data to the `/consultant-review-confirmation` endpoint:

```python
@app.route('/consultant-review-confirmation', methods=['POST'])
def consultant_review_confirmation():
    try:
        payload, client_ip, error_response, status_code = process_request_headers_and_payload(request)
        if error_response:
            return error_response, status_code
        process_adaptive_card_payload(payload, client_ip)
        return jsonify({"status": "success", "message": "Actions processed successfully"}), 200
    except Exception as error:
        handle_global_exception(sys._getframe().f_code.co_name, error)
```

This route does two things:
1. **Verifies the request and extracts the payload** using `process_request_headers_and_payload`.
2. **Processes the submitted data** using `process_adaptive_card_payload`.

---

## 2. Deep Dive: `process_request_headers_and_payload`

This function is responsible for:
- Extracting and logging request headers.
- Validating the JWT Bearer token in the `Action-Authorization` header.
- Decoding the token and verifying its authenticity.
- Extracting the JSON payload from the request.

```python
def process_request_headers_and_payload(request):
    headers = dict(request.headers)
    logger.info(f"Request headers: {headers}")
    action_auth_header = headers.get("Action-Authorization", "")
    client_ip = headers.get("X-Forwarded-For", "")
    logger.info(f"Incoming request from IP: {client_ip}")
    logger.info(f"Action Authorization: {action_auth_header}")
    if not action_auth_header.startswith("Bearer "):
        logger.error(f"Missing or invalid Bearer token in Action-Authorization header from {client_ip}")
        return None, None, jsonify({"error": "Unauthorized - Missing Bearer token"}), 401
    token = action_auth_header.split(" ", 1)[1]
    log_jwt_payload(token)
    public_key = fetch_public_key(token)
    if not public_key:
        logger.error("Public key not found!")
        return None, None, jsonify({"error": "Unauthorized - Invalid Bearer token"}), 401
    if not validate_token(token, public_key):
        return None, None, jsonify({"error": "Unauthorized - Invalid Bearer token"}), 401
    payload = request.get_json()
    logger.info(f"Payload: {payload}")
    return payload, client_ip, None, None
```

### 2.1. `log_jwt_payload(token)`
Logs the decoded JWT payload (without verifying the signature) for debugging and traceability.

```python
def log_jwt_payload(token):
    """Logs the decoded JWT payload without verification."""
    payload = jwt.decode(token, options={"verify_signature": False})
    for key, value in payload.items():
        logger.info(f"{key}: {value}")
```

### 2.2. `fetch_public_key(token)`
Extracts the key ID (`kid`) from the JWT header, fetches the public keys from the identity provider's JWKS endpoint, and finds the matching key for signature verification.

```python
def fetch_public_key(token):
    """Fetches the public key for the given token."""
    try:
        header = jwt.get_unverified_header(token)
        key_id = header.get("kid")
        jwks_url = 'https://substrate.office.com/sts/common/discovery/keys'  # Replace with your IdP's JWKS endpoint if needed
        jwks = requests.get(jwks_url).json()
        for key in jwks["keys"]:
            if key["kid"] == key_id:
                return RSAAlgorithm.from_jwk(json.dumps(key))
    except Exception as e:
        raise Exception(f"Error fetching public key: {e}")
    return None
```

### 2.3. `validate_token(token, public_key)`
Decodes and verifies the JWT signature using the public key, checks the token's issuer and audience, and raises an error if the token is expired or invalid.

```python
def validate_token(token, public_key):
    """Validates the JWT token using the public key."""
    try:
        decoded_token = jwt.decode(
            token, public_key, algorithms=["RS256"], audience="https://api.mycompany.com"
        )
        if decoded_token.get("iss") != "https://substrate.office.com/sts/":  # Replace with your IdP's issuer if needed
            raise Exception("Invalid issuer!")
        return True
    except jwt.ExpiredSignatureError:
        raise Exception("Token has expired")
    except jwt.InvalidTokenError:
        raise Exception("Invalid token!")
```

**Summary:** Only requests with a valid JWT token (issued by your identity provider) are accepted. The payload is only processed if authentication passes. All actions are logged for traceability.

---

## 3. Deep Dive: `process_adaptive_card_payload`

This function is responsible for:
- Iterating through the submitted consultant actions.
- Extracting manager and consultant details from the payload.
- Taking the appropriate action (e.g., sending confirmation emails, saving to disk, triggering downstream automation).

```python
def process_adaptive_card_payload(payload, client_ip):
    for consultant_id, values in payload.items():
        manager_email = values.get("manageremail")
        manager_name = values.get("managername")
        # ... process each consultant's action ...
    send_email_to_manager(payload, manager_email, manager_name)
    save_payload_to_disk(payload, manager_email)
```

### 3.1. `send_email_to_manager(payload, manager_email, manager_name)`
Builds an HTML summary of the manager's actions for all consultants and sends a confirmation email to the manager with a table of decisions (keep/deactivate).

```python
def send_email_to_manager(payload, manager_email, manager_name):
    """Sends an HTML formatted email to the manager."""
    try:
        subject = "Consultant Review Actions Summary"
        body = f"""
        <html>
        <body style=\"font-family:verdana,courier,serif; font-size: 13px;\">
            <p>Dear {manager_name},</p>
            <p>Thank you for reviewing the consultants. Below is a summary of your actions:</p>
            <table border=\"1\" style=\"border-collapse: collapse; width: 100%; font-family:verdana,courier,serif; font-size: 13px;\">
            <tr>
                <th>Consultant Email</th>
                <th>Decision</th>
            </tr>
        """
        for consultant_id, values in payload.items():
            body += f"<tr><td>{values.get('email')}</td><td>{values.get('decision')}</td></tr>"
        body += """
            </table>
        </body>
        </html>
        """
        send_email(recipients=[manager_email], subject=subject, html_message=body)
    except Exception as e:
        handle_global_exception(sys._getframe().f_code.co_name, e)
```

### 3.2. `save_payload_to_disk(payload, manager_email)`
Serializes the entire payload to a JSON file and saves it to a mounted share or persistent storage for auditing and further processing.

```python
def save_payload_to_disk(payload, manager_email):
    """Saves the entire payload to the mounted share as a single JSON file."""
    try:
        import os, json, datetime
        filename = f"{manager_email}_consultant_review_{datetime.datetime.now().strftime('%Y%m%d%H%M%S%f')}.json"
        path = os.path.join(UNPROCESSED_PATH, filename)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception as e:
        handle_global_exception(sys._getframe().f_code.co_name, e)
```

---

## 4. Downstream Automation: `process_deactived_consultants`

This function is typically run on a schedule to process all submitted consultant reviews:
- Loads all unprocessed review files from disk.
- For each consultant marked for deactivation, adds them to a deactivation list.
- Sends a summary email to HR and IT for further action.
- Moves processed files to an archive location.

```python
def process_deactived_consultants():
    deactivate_list = []
    manager_consultants_files = fetch_and_ignore_unprocessed_review_files()
    for file in manager_consultants_files:
        file_path, file_name = file.rsplit('/', 1)
        file_time_utc = os.path.getmtime(file)
        file_time = datetime.fromtimestamp(file_time_utc, pytz.utc).astimezone(pytz.timezone('America/Chicago'))
        with open(file, 'r') as f:
            file_content = f.read()
        consultants_data = json.loads(file_content)
        for consultant, details in consultants_data.items():
            if details.get('decision') == 'deactivate':
                deactivate_list.append({
                    'manager_email': details.get('manageremail'),
                    'consultant_email': details.get('email'),
                    'approval_time': file_time.strftime('%Y-%m-%d %H:%M:%S')
                })
    if deactivate_list:
        send_email_to_hr_and_it(deactivate_list)
    for file in manager_consultants_files:
        file_name = os.path.basename(file)
        processed_file_path = os.path.join(PROCESSED_PATH, file_name)
        os.rename(file, processed_file_path)
```

---

## 5. Error Handling: `handle_global_exception`

All major functions use `handle_global_exception` to log and report errors, ensuring that issues are traceable and do not silently fail.

```python
def handle_global_exception(function_name, exception_obj):
    logger.error(f"Exception in {function_name}: {exception_obj}")
    # Optionally, send an alert email or take other action
```

---

## 6. Recap: Full Request Processing Chain

1. **Adaptive Card submission** posts to `/consultant-review-confirmation`.
2. `process_request_headers_and_payload` authenticates and extracts the payload.
    - Calls `log_jwt_payload`, `fetch_public_key`, `validate_token`.
3. `process_adaptive_card_payload` processes the payload.
    - Calls `send_email_to_manager`, `save_payload_to_disk`.
4. `process_deactived_consultants` (scheduled) processes all reviews and notifies HR/IT.

---

## 7. Example: End-to-End Flow

1. Manager receives Adaptive Card, reviews consultants, and submits actions.
2. Submission is POSTed to `/consultant-review-confirmation` with a JWT Bearer token.
3. The backend verifies the token, extracts the payload, and logs all actions.
4. The manager receives a confirmation email summarizing their decisions.
5. The payload is saved for auditing and further automation (e.g., account deactivation).
6. HR/IT are notified of deactivation approvals as needed.

---

## Conclusion

By recursively examining each function and providing the full code, you can see how the system securely and reliably processes Adaptive Card submissions. This approach is company-agnostic and can be adapted to any workflow requiring secure, actionable messaging in Outlook.

- Always validate and log incoming requests.
- Process and audit all actions.
- Automate downstream actions as needed.

This completes the deep dive into the end-to-end workflow for actionable consultant review using Adaptive Cards and Python.
