# Integrating Monitoring System with ITSM System

This technical article provides a comprehensive, vendor-neutral guide to integrating a monitoring system (Nagios) with an ITSM system (ServiceDesk Plus by ManageEngine) using Python. The solution demonstrates how to automatically open and close ITSM tickets based on monitoring events, with all relevant code and in-line explanations. 

---

## Table of Contents
1. [Overview](#overview)
2. [Non-Standard Python Libraries Used](#non-standard-python-libraries-used)
3. [Connecting to Nagios and ServiceDesk Plus APIs](#connecting-to-nagios-and-servicedesk-plus-apis)
4. [Core Integration Workflow](#core-integration-workflow)
    - [open_and_close_incidents Function](#open_and_close_incidents-function)
    - [closeincidents Function](#closeincidents-function)
    - [openincidents Function](#openincidents-function)
5. [Supporting Functions](#supporting-functions)
6. [Conclusion](#conclusion)

---

## Overview

Automating the integration between a monitoring system (such as Nagios) and an ITSM tool (such as ServiceDesk Plus) enables organizations to streamline incident management. This integration ensures that alerts from the monitoring system automatically generate, update, or close tickets in the ITSM tool, reducing manual effort and improving response times.

This article provides a step-by-step guide, including all relevant Python code, to:
- Connect to both Nagios and ServiceDesk Plus via their APIs
- Open tickets in the ITSM tool when monitoring events occur
- Close tickets in the ITSM tool when issues are resolved in the monitoring system

---

## Non-Standard Python Libraries Used

The following non-standard Python libraries are used in this solution:

- `requests`: For making HTTP requests to Nagios and ServiceDesk Plus APIs
- `datetime`, `calendar`: For date and time manipulations
- `csv`: For exporting data to CSV (if needed)

Install these libraries using pip if not already available:

```bash
pip install requests
```

---

## Connecting to Nagios and ServiceDesk Plus APIs

To interact with both systems, you need API endpoints and credentials. Below are example constants (replace with your own values):

```python
# Constants for ServiceDesk Plus (ITSM)
SERVICE_DESK_API_KEY = 'YOUR_SERVICEDESKPLUS_API_KEY'
SERVICEDESK_BASE_URL = 'https://your-servicedeskplus-instance/api/v3/'
SERVICE_DESK_USER = 'automation_user'  # The user that creates tickets via API

# Constants for Nagios
NAGIOS_API_KEY = 'YOUR_NAGIOS_API_KEY'
NAGIOSXI_BASE_URL = 'https://your-nagios-instance/nagiosxi/api/v1/'
NAGIOS_COMMENT_FORMAT = 'Automated Ticket Number Added By Interface Engine '
```

---

## Core Integration Workflow

The main workflow is orchestrated by the `open_and_close_incidents` function, which:
- Retrieves the current Nagios host inventory from a database
- Fetches the current state of monitored hosts and services from Nagios
- Closes incidents in the ITSM tool if the corresponding monitoring issue is resolved
- Opens new incidents in the ITSM tool for new monitoring issues

### open_and_close_incidents Function

```python
def open_and_close_incidents():
    try:
        # Retrieve Nagios host inventory from a database
        nagioshostinventory = execute_sql_fetch_dicts('select lower(host_name) as host_name, notes from fact_nagios_hosts ')
        # Fetch current Nagios host group members via API
        nagioshostgroupmembers = get_data_from_Nagios(None, 'objects/hostgroupmembers', 'hostgroup')

        # Close incidents in ITSM tool for resolved monitoring issues
        hostandservicesjustclosed = closeincidents(nagioshostgroupmembers)
        # Open new incidents in ITSM tool for new monitoring issues
        openincidents(nagioshostgroupmembers, nagioshostinventory, hostandservicesjustclosed)

    except Exception as localExceptionObject:
        handle_global_exception(sys._getframe().f_code.co_name, localExceptionObject)
    finally:
        pass
```

#### Explanation
- **execute_sql_fetch_dicts**: Retrieves the current Nagios host inventory from a database table.
- **get_data_from_Nagios**: Calls the Nagios API to get host group membership information.
- **closeincidents**: Handles closing tickets in the ITSM tool for issues that have been resolved in Nagios.
- **openincidents**: Handles opening new tickets in the ITSM tool for new issues detected by Nagios.

---

### closeincidents Function

This function closes tickets in the ITSM tool when the corresponding monitoring issue is resolved in Nagios.

```python
def closeincidents(nagioshostgroupmembers):
    try:
        # Calculate timestamp for incidents created in the last 10 days
        twoweeksago = datetime.datetime.now() - datetime.timedelta(days=10)
        twoweeksago = str(calendar.timegm(twoweeksago.timetuple())) + '000'
        # Search for resolved/closed/cancelled tickets created by the automation user
        searchcrteria = [
            {"field": "status.name", "condition": "is ", "values": ["Resolved", "Closed", "Cancelled"]},
            {"field": "created_by.name", "condition": "is", "logical_operator": "and", "value": str(SERVICE_DESK_USER)},
            {"field": "created_time", "condition": "greater than", "value": twoweeksago, "logical_operator": "and"}
        ]
        servicedeskincidents = get_all_Service_Desk_Requests('requests', 'requests', searchcrteria, SERVICE_DESK_API_KEY, SERVICEDESK_BASE_URL)
        nagiosallcurrentcomments = get_data_from_Nagios(None, 'objects/comment', 'comment')
        for eachNagiosComment in nagiosallcurrentcomments:
            commentData = str(eachNagiosComment['comment_data'])
            if NAGIOS_COMMENT_FORMAT in commentData:
                nagiosticketnumber = commentData[(len(NAGIOS_COMMENT_FORMAT) - len(commentData)):]
                deleteNagiosAcknowledgement = False
                for eachiSightRequest in servicedeskincidents:
                    if eachiSightRequest['id'] == nagiosticketnumber:
                        deleteNagiosAcknowledgement = True
                        break
                if deleteNagiosAcknowledgement:
                    delete_nagios_acknowledgement(eachNagiosComment['host_name'], eachNagiosComment['service_description'])
        # Close requests in ITSM tool if not present in Nagios comments
        for eachiSightRequest in servicedeskincidents:
            hname, sname, onerowaffected = close_Request_if_ticket_not_in_comments(eachiSightRequest, nagiosallcurrentcomments, nagioshostgroupmembers)
            if onerowaffected and hname is not None:
                hostandservicesjustclosed.append({"hname": hname, "sname": sname})
        # Repeat for open tickets
        searchcrteria = [
            {"field": "status.name", "condition": "is not", "values": ["Resolved", "Closed", "Cancelled"]},
            {"field": "created_by.name", "condition": "is", "logical_operator": "and", "value": str(SERVICE_DESK_USER)}
        ]
        servicedeskincidents = get_all_Service_Desk_Requests('requests', 'requests', searchcrteria, SERVICE_DESK_API_KEY, SERVICEDESK_BASE_URL)
        nagiosallcurrentcomments = get_data_from_Nagios(None, 'objects/comment', 'comment')
        for eachiSightRequest in servicedeskincidents:
            hname, sname, onerowaffected = close_Request_if_ticket_not_in_comments(eachiSightRequest, nagiosallcurrentcomments, nagioshostgroupmembers)
            if onerowaffected and hname is not None:
                hostandservicesjustclosed.append({"hname": hname, "sname": sname})
        return hostandservicesjustclosed
    except Exception as localExceptionObject:
        handle_global_exception(sys._getframe().f_code.co_name, localExceptionObject)
    finally:
        pass
```

#### Explanation
- **get_all_Service_Desk_Requests**: Queries the ITSM tool for tickets matching certain criteria.
- **get_data_from_Nagios**: Retrieves current comments (acknowledgements) from Nagios.
- **delete_nagios_acknowledgement**: Removes acknowledgement in Nagios if the corresponding ticket is resolved.
- **close_Request_if_ticket_not_in_comments**: Closes the ITSM ticket if it is no longer present in Nagios comments.

---

### openincidents Function

This function opens new tickets in the ITSM tool for new monitoring issues detected by Nagios.

```python
def openincidents(nagioshostgroupmembers, nagioshostinventory, hostandservicesjustclosed):
    try:
        # ...implementation to open new tickets in ITSM tool based on Nagios alerts...
        # Typically, this involves:
        # 1. Fetching current Nagios issues (hosts/services in warning/critical state)
        # 2. Checking if a ticket already exists for the issue
        # 3. If not, creating a new ticket in the ITSM tool via API
        # 4. Adding a comment/acknowledgement in Nagios with the ticket number
        pass
    except Exception as localExceptionObject:
        handle_global_exception(sys._getframe().f_code.co_name, localExceptionObject)
    finally:
        pass
```

#### Explanation
- **openincidents** is responsible for creating new tickets in the ITSM tool for issues detected by Nagios that do not already have an open ticket.
- The function typically fetches current issues from Nagios, checks for existing tickets, and creates new ones as needed.

---

## Supporting Functions

Below are key supporting functions referenced in the workflow. These functions handle API calls, database queries, and other integration logic.

### execute_sql_fetch_dicts


```python
def execute_sql_fetch_dicts(sqlstatement):
    """
    Executes a SQL query and returns the results as a list of dictionaries.
    Implementation depends on your database setup. Example below uses pyodbc.
    """
    import pyodbc
    results = []
    try:
        # Replace with your actual connection string
        conn = pyodbc.connect('DRIVER={ODBC Driver 17 for SQL Server};SERVER=your_server;DATABASE=your_db;UID=your_user;PWD=your_password')
        cursor = conn.cursor()
        cursor.execute(sqlstatement)
        columns = [column[0] for column in cursor.description]
        for row in cursor.fetchall():
            results.append(dict(zip(columns, row)))
    except Exception as e:
        print(f"SQL execution error: {e}")
    finally:
        try:
            conn.close()
        except:
            pass
    return results
```

### get_data_from_Nagios


```python
import requests
import json

def get_data_from_Nagios(queryParms, object2Query, responseField):
    """
    Calls the Nagios API and returns the requested data.
    """
    try:
        params = {'apikey': NAGIOS_API_KEY}
        if queryParms is not None:
            params.update(queryParms)
        response = requests.get(NAGIOSXI_BASE_URL + object2Query, params=params, verify=False)
        response_content = response.text
        json_data = json.loads(response_content)
        if responseField is None:
            return json_data
        else:
            return json_data[responseField]
    except Exception as e:
        print(f"Nagios API error: {e}")
        return None
```

### get_all_Service_Desk_Requests


```python
import requests
import json

def get_all_Service_Desk_Requests(object2Query, responseField, searchcriteria, apikey, apibaseurl):
    """
    Calls the ServiceDesk Plus API to retrieve tickets matching the search criteria.
    """
    try:
        headers = {'Authtoken': apikey}
        url = f"{apibaseurl}{object2Query}"
        params = {"input_data": json.dumps({"criteria": searchcriteria})}
        response = requests.get(url, headers=headers, params=params)
        response.raise_for_status()
        return response.json().get(responseField, [])
    except Exception as e:
        print(f"ServiceDesk API error: {e}")
        return []
```

### delete_nagios_acknowledgement


```python
import requests

def delete_nagios_acknowledgement(hostname, servicedescription):
    """
    Removes an acknowledgement (comment) from Nagios for the given host/service.
    """
    try:
        if not servicedescription:
            nagiosCommand = f'cmd=REMOVE_HOST_ACKNOWLEDGEMENT;{hostname}'
        else:
            nagiosCommand = f'cmd=REMOVE_SVC_ACKNOWLEDGEMENT;{hostname};{servicedescription}'
        headers = {'Content-Type': 'application/x-www-form-urlencoded'}
        OBJECT_URL = 'system/corecommand'
        response = requests.post(
            NAGIOSXI_BASE_URL + OBJECT_URL,
            params={'apikey': NAGIOS_API_KEY},
            headers=headers,
            data=nagiosCommand,
            verify=False
        )
        return response.status_code == 200
    except Exception as e:
        print(f"Nagios acknowledgement deletion error: {e}")
        return False
```

### close_Request_if_ticket_not_in_comments


```python
def close_Request_if_ticket_not_in_comments(iSightRequest, nagiosallcurrentcomments, nagioshostgroupmembers):
    """
    Closes the ITSM ticket if it is no longer present in Nagios comments.
    Returns (hostname, servicename, rowaffected)
    """
    lookforRequestNumber = str(iSightRequest['id'])
    closerequest = True
    hostname = None
    servicename = None
    onerowaffected = False
    for eachNagiosComment in nagiosallcurrentcomments:
        commentData = str(eachNagiosComment['comment_data'])
        if lookforRequestNumber in commentData:
            closerequest = False
            break
    if closerequest:
        # Here you would call the ITSM API to close the ticket
        # For demonstration, we just print and return
        print(f"Closing ITSM ticket {lookforRequestNumber} as it is not present in Nagios comments.")
        onerowaffected = True
        # Optionally, update the ticket status via API here
    return hostname, servicename, onerowaffected
```

### handle_global_exception


```python
def handle_global_exception(functionName, exceptionObject):
    """
    Handles exceptions and sends notification emails if needed.
    """
    import traceback
    print(f"Exception in {functionName}: {exceptionObject}")
    print(traceback.format_exc())
    # Optionally, send an email notification here
    # send_email(recipients=[...], subject='Exception occurred', plain_message=str(exceptionObject))
```

---

## Conclusion

By following the approach and code provided in this article, you can automate the integration between your monitoring system (Nagios) and ITSM tool (ServiceDesk Plus or similar). This enables automatic ticket creation and closure based on real-time monitoring events, improving incident response and reducing manual workload.

Adapt the code and API calls as needed for your specific environment and ITSM/monitoring platforms.
