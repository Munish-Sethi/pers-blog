# Automating GitHub Deployment Cleanup with Bash, GitHub CLI, and jq

Managing deployments in GitHub can be tedious, especially when you want to delete all deployments and there is no UI option to do so. This article explains how to automate the cleanup of deployments in a GitHub repository using a Bash script, the GitHub CLI, and the `jq` tool for JSON parsing.

> **Note:** This is a focused, practical solution for a common DevOps quirk—bulk deleting deployments from a GitHub repo when no UI exists for this action.

---

## Prerequisites

1. **GitHub CLI**: Install the GitHub CLI (`gh`) for interacting with GitHub from the command line.
2. **jq**: Install `jq` for parsing JSON responses.
3. **Personal Access Token (PAT)**: Export your GitHub PAT as an environment variable:
   ```sh
   export GITHUB_TOKEN="<YOUR_PERSONAL_ACCESS_TOKEN>"
   ```
4. **Make the Script Executable**:
   ```sh
   chmod +x ./scripts/github/deployments.sh
   ```

---

## The Script: `deployments.sh`

Below is the full code for the script that automates the deletion of deployments in a GitHub repository:

```bash
#!/bin/sh

# Set your repository and token
# Save the token in the environment variable GITHUB_TOKEN
# Example: export GITHUB_TOKEN="<PAT GOES HERE>"

# Ensure the script is executable
# Example: chmod +x ./scripts/deployments.sh

# Ensure GitHub CLI and jq libraries are available
# They should be included in your Dockerfile or build environment

# Repository to manage deployments
REPO="GDEnergyproducts/GDEP-IAC"

# Retrieve the GitHub token from environment variable
TOKEN="${GITHUB_TOKEN}"

# Fetch the list of deployments and extract deployment IDs
echo "Fetching deployment IDs..."
DEPLOYMENTS=$(curl -s -H "Authorization: token $TOKEN" \
                    -H "Accept: application/vnd.github.v3+json" \
                    https://api.github.com/repos/$REPO/deployments \
                    | jq -r '.[] | .id')

# Check if there are any deployments
if [ -z "$DEPLOYMENTS" ]; then
  echo "No deployments found."
  exit 0
fi

# Print the list of deployment IDs
echo "Deployments found:"
echo "$DEPLOYMENTS"

# Determine the active deployment ID
ACTIVE_DEPLOYMENT_ID=$(curl -s -H "Authorization: token $TOKEN" \
                             -H "Accept: application/vnd.github.v3+json" \
                             https://api.github.com/repos/$REPO/deployments \
                             | jq -r '.[] | select(.status == "active") | .id')

echo "Active Deployment ID: $ACTIVE_DEPLOYMENT_ID"

# Loop through each deployment ID and delete it, skipping the active deployment
echo "Deleting deployments..."
for ID in $DEPLOYMENTS; do
  if [ "$ID" != "$ACTIVE_DEPLOYMENT_ID" ]; then
    echo "Deleting deployment $ID"
    curl -X DELETE -H "Authorization: token $TOKEN" \
         -H "Accept: application/vnd.github.v3+json" \
         https://api.github.com/repos/$REPO/deployments/$ID
  else
    echo "Skipping active deployment $ID"
  fi
 done
```

---

## Step-by-Step Explanation

1. **Set Up Environment Variables**
   - The script expects your GitHub Personal Access Token to be set as `GITHUB_TOKEN` in your environment.

2. **Fetch Deployment IDs**
   - Uses `curl` to call the GitHub API and retrieve all deployments for the specified repository.
   - Pipes the JSON response to `jq` to extract all deployment IDs.

3. **Check for Deployments**
   - If no deployments are found, the script exits gracefully.

4. **Identify the Active Deployment**
   - Fetches deployments again and uses `jq` to find the deployment with status `active` (if any).
   - This deployment is skipped during deletion to avoid disrupting an active deployment.

5. **Delete Deployments**
   - Loops through all deployment IDs.
   - For each deployment, if it is not the active deployment, sends a DELETE request to the GitHub API to remove it.
   - Prints a message for each deletion or if skipping the active deployment.

---

## Why Use jq?
- `jq` is a lightweight and flexible command-line JSON processor.
- It allows you to extract, filter, and manipulate JSON data returned by the GitHub API with ease.
- In this script, `jq` is used to:
  - List all deployment IDs: `.[] | .id`
  - Find the active deployment: `.[] | select(.status == "active") | .id`

---

## Usage

1. Export your GitHub token:
   ```sh
   export GITHUB_TOKEN="<YOUR_PERSONAL_ACCESS_TOKEN>"
   ```
2. Make the script executable:
   ```sh
   chmod +x ./scripts/github/deployments.sh
   ```
3. Run the script from your project root:
   ```sh
   ./scripts/github/deployments.sh
   ```

---

## Summary
- This script provides a simple, automated way to clean up deployments in a GitHub repository.
- It leverages the GitHub API, `curl`, and `jq` for powerful, flexible automation.
- There is no UI in GitHub to bulk delete deployments—this script fills that gap for DevOps teams.

---

**Automate your GitHub deployment cleanup today!**
