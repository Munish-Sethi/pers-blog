# Orchestrating Scheduled Jobs in a Python Container Using a Scheduler Script

This article demonstrates how to build a robust job scheduler in a Python-based container environment. The scheduler coordinates the execution of various Python scripts at specific times or intervals, ensuring that business processes run reliably and in the correct timezone. The approach is suitable for any containerized environment, such as those running in Azure, AWS, or on-premises.

---

## Table of Contents
1. [Overview](#overview)
2. [Key Concepts](#key-concepts)
3. [Core Scheduler Script](#core-scheduler-script)
    - [Scheduling Jobs](#scheduling-jobs)
    - [Running Jobs in the Background](#running-jobs-in-the-background)
    - [Timezone Aware Scheduling](#timezone-aware-scheduling)
4. [Container Startup with Supervisor](#container-startup-with-supervisor)
5. [Conclusion](#conclusion)

---

## Overview

In many automation and integration scenarios, you need to run a set of scripts or jobs on a schedule—some daily, some every few minutes, and some only on certain days. When running in a container, you want the scheduler to start automatically and keep running, launching jobs as needed. This article explains how to implement such a scheduler in Python, using the `schedule` library, and how to ensure it starts with your container using Supervisor.

---

## Key Concepts

- **Job Scheduling:** Use the `schedule` library to define when each job should run (e.g., every day at a certain time, every N minutes).
- **Background Execution:** Use Python's `threading` module to run jobs asynchronously, so the scheduler loop is never blocked.
- **Timezone Awareness:** Use the `pytz` library to ensure jobs run at the correct local time, even if the container's system time is UTC.
- **Error Handling:** Use try/except blocks and logging to capture and report errors without stopping the scheduler.
- **Container Startup:** Use Supervisor to ensure the scheduler script starts automatically when the container is created and restarts if it fails.

---

## Core Scheduler Script

Below is a simplified and generic version of a Python scheduler script suitable for containerized environments. All company-specific details have been removed.

### Importing Required Libraries

```python
import schedule
import time
import subprocess
import threading
import sys
import pytz
from datetime import datetime, timedelta
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("scheduler")
```

### Helper Functions

#### Timezone Aware Scheduling

```python
def get_next_utc_for_local(hour, minute=0, timezone_str='America/Chicago'):
    """Calculate the next occurrence of the specified hour in the given timezone and convert to UTC."""
    tz = pytz.timezone(timezone_str)
    now = datetime.now(tz)
    target_time = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if now >= target_time:
        target_time += timedelta(days=1)
    return target_time.astimezone(pytz.utc).strftime('%H:%M')
```

#### Running Jobs in the Background

```python
def run_in_background(target_function):
    """Runs the given function asynchronously in a background thread."""
    thread = threading.Thread(target=target_function, daemon=True)
    thread.start()
```

#### Executing Python Scripts

```python
def execute_script(script_path, *args):
    """Helper function to execute a Python script with optional arguments."""
    subprocess.run(['python', script_path, *args])
```

### Defining Job Functions

Each job function can call a different Python script or perform a specific task. For example:

```python
def job_example():
    logger.info("Running example job...")
    execute_script('path/to/your_script.py', 'optional_arg')
```

### Scheduling Jobs

You can schedule jobs at specific times or intervals. Here are some examples:

```python
if __name__ == "__main__":
    try:
        # Schedule daily jobs at specific local times (converted to UTC)
        schedule.every().day.at(get_next_utc_for_local(7)).do(lambda: run_in_background(job_example)).tag('job_example', 'daily_task')
        schedule.every().day.at(get_next_utc_for_local(12, 30)).do(lambda: run_in_background(job_example)).tag('job_example', 'daily_task')

        # Schedule jobs at regular intervals
        schedule.every(15).minutes.do(lambda: run_in_background(job_example)).tag('job_example', 'frequent_task')

        # Main scheduler loop
        while True:
            try:
                schedule.run_pending()
            except Exception as e:
                logger.error(f"Scheduler Error: {e}")
            time.sleep(1)
    except Exception as e:
        logger.error(f"Fatal Scheduler Error: {e}")
```

#### Explanation
- **get_next_utc_for_local:** Ensures jobs run at the correct local time, regardless of the container's timezone.
- **run_in_background:** Prevents long-running jobs from blocking the scheduler loop.
- **execute_script:** Launches other Python scripts as subprocesses, optionally with command-line arguments.
- **schedule.every().day.at(...):** Schedules jobs at specific times.
- **schedule.every(N).minutes.do(...):** Schedules jobs at regular intervals.
- **Infinite Loop:** The script runs forever, checking for jobs to run every second.

---

## Container Startup with Supervisor

To ensure your scheduler script starts automatically when the container is created and restarts if it fails, use Supervisor. Add a `supervisord.conf` file to your container image with the following content:

```
[program:scheduler]
command=python /app/src/gdepscheduler.py
autostart=true
autorestart=true
```

- **[program:scheduler]:** Defines a program called "scheduler".
- **command:** The command to run your scheduler script.
- **autostart=true:** Start the program automatically when Supervisor starts.
- **autorestart=true:** Restart the program if it exits unexpectedly.

Supervisor will keep your scheduler running, even if it crashes or the container restarts.

---

## Conclusion

By combining the `schedule` library, background threading, timezone handling, and Supervisor, you can build a reliable, container-friendly job scheduler in Python. This approach ensures your automation and integration jobs run on time, every time, with minimal manual intervention.

Adapt the code and configuration to your own scripts and business requirements. This pattern is suitable for any containerized environment where scheduled automation is needed.
