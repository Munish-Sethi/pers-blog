# Cleaning Up Obsolete FSLogix Profiles in Azure

Obsolete FSLogix profile containers can consume significant storage and increase costs in Azure environments. This article explains how to identify and delete outdated profiles using a Bash script, helping you save space and reduce expenses. The approach is multi-step: first, list and analyze profiles, then safely delete those that are no longer needed. This process is ideal for automation and can be run in a container for portability and security.

---

## Why Clean Up Obsolete Profiles?
- **Cost Savings:** Old FSLogix profile containers can accumulate and consume large amounts of Azure Files storage, leading to unnecessary costs.
- **Performance:** Removing unused profiles can improve performance and reduce clutter.
- **Compliance:** Regular cleanup helps maintain a tidy, compliant environment.

---

## Multi-Step Approach
1. **List and Analyze Profiles:** Identify which profiles are old and candidates for deletion.
2. **Delete Obsolete Profiles:** Remove only those that are confirmed to be outdated.

This article covers the first step—identifying obsolete profiles. (You can extend the script to perform deletions after review.)

---

## Example Script: Identify Obsolete FSLogix Profiles

Below is a Bash script that lists FSLogix profile containers in an Azure Files share, checks their last modified date, and logs those that haven't been updated in a specified number of days. All sensitive values are masked for security.

```bash
#!/bin/bash

# Define the output log files
deleteLogFile="step1-verbose.log"
sizeLogFile="step1-filesize.log"
deleteFile="step1-input4step2.txt"

# Variables (replace with your own values)
resourceGroupName="<your-resource-group>"
storageAccountName="<your-storage-account>"
fileShareName="<your-file-share>"
daysThreshold=30
maxProfiles=500  # Limit the number of profiles to process

# Determine the script directory
scriptDir="$(dirname \"$(realpath \"$0\")\")"
deleteFile="$scriptDir/$deleteFile"
sizeFile="$scriptDir/$sizeLogFile"
deleteLogFile="$scriptDir/$deleteLogFile"

# Delete existing files if they exist
if [ -f "$deleteFile" ]; then
    echo "Deleting existing delete file: $deleteFile"
    rm "$deleteFile"
fi

if [ -f "$deleteLogFile" ]; then
    echo "Deleting existing delete log file: $deleteLogFile"
    rm "$deleteLogFile"
fi

if [ -f "$sizeFile" ]; then
    echo "Deleting existing size log file: $sizeFile"
    rm "$sizeFile"
fi

# Redirect all echo output to the delete log file
exec > "$deleteLogFile" 2>&1

echo "Starting script..."

echo "Variables set: resourceGroupName=$resourceGroupName, storageAccountName=$storageAccountName, fileShareName=$fileShareName, daysThreshold=$daysThreshold, deleteFile=$deleteFile, sizeFile=$sizeFile"

# Get the storage account key
echo "Fetching storage account key..."
storageAccountKey=$(az storage account keys list --resource-group $resourceGroupName --account-name $storageAccountName --query '[0].value' --output tsv)
if [ $? -ne 0 ]; then
    echo "Failed to fetch storage account key."
    exit 1
fi
echo "Storage account key fetched successfully."

# Get the current date in seconds since epoch and human-readable format
currentDate=$(date +%s)
humanReadableCurrentDate=$(date -d @$currentDate +"%Y-%m-%d %H:%M:%S")
echo "Current date (epoch): $currentDate"
echo "Current date (human-readable): $humanReadableCurrentDate"

# Calculate the threshold date (30 days ago)
thresholdDate=$((currentDate - daysThreshold * 24 * 60 * 60))
humanReadableThresholdDate=$(date -d @$thresholdDate +"%Y-%m-%d %H:%M:%S")
echo "Threshold date (epoch): $thresholdDate"
echo "Threshold date (human-readable): $humanReadableThresholdDate"

# Initialize arrays to store profile directories, sizes, last modified dates, and delete candidates
oldProfiles=()
profileSizes=()
deleteCandidates=()

# List all directories in the file share
echo "Listing profile directories..."
profileDirs=$(az storage file list --account-name $storageAccountName --account-key $storageAccountKey --share-name $fileShareName --output tsv --query '[].name')
if [ $? -ne 0 ]; then
    echo "Failed to list profile directories."
    exit 1
fi

# Loop through each profile directory
profileCount=0
for profileDir in $profileDirs; do
    if [ $profileCount -ge $maxProfiles ]; then
        echo "Processed $maxProfiles profiles. Exiting loop."
        break
    fi

    echo "Processing profile directory: $profileDir"
    
    # List files in the profile directory
    files=$(az storage file list --account-name $storageAccountName --account-key $storageAccountKey --share-name $fileShareName --path $profileDir --output tsv --query '[].name')
    if [ $? -ne 0 ]; then
        echo "Failed to list files in $profileDir."
        continue
    fi

    for file in $files; do
        if [[ $file == *.vhdx ]]; then
            echo "Processing file: $file"
            
            # Get the properties of the .vhdx file
            fileProperties=$(az storage file show --account-name $storageAccountName --account-key $storageAccountKey --share-name $fileShareName --path $profileDir/$file --query '{properties: properties}' --output json)
            if [ $? -ne 0 ]; then
                echo "Failed to get properties for $file."
                continue
            fi

            # Get file size
            fileSize=$(echo "$fileProperties" | jq -r '.properties.contentLength')
            if [ $? -ne 0 ]; then
                echo "Failed to get file size for $file."
                continue
            fi
            echo "File size: $fileSize bytes"

            # Convert file size from bytes to GB
            fileSizeGB=$(echo "scale=2; $fileSize / (1024 * 1024 * 1024)" | bc)
            echo "File size: $fileSizeGB GB"

            # Add profile directory and size to the arrays
            profileSizes+=("$fileSizeGB $profileDir")
            
            # Get the last modified date of the file
            lastModified=$(echo "$fileProperties" | jq -r '.properties.lastModified')
            lastModifiedDate=$(date -d "$lastModified" +%s)
            if [ $? -ne 0 ]; then
                echo "Failed to convert last modified date."
                continue
            fi
            echo "Last modified date (epoch): $lastModifiedDate"

            # Check if the last modified date is older than the threshold
            if [[ $lastModifiedDate -lt $thresholdDate ]]; then
                echo "Profile $profileDir has not been updated in the last $daysThreshold days. Last modified: $lastModified"
                
                # Convert last modified date to human-readable format
                humanReadableLastModifiedDate=$(date -d "$lastModified" +"%Y-%m-%d %H:%M:%S")

                # Add profile directory to the delete candidates array
                deleteCandidates+=("$profileDir - Last Modified: $humanReadableLastModifiedDate")
            fi
        fi
    done
    profileCount=$((profileCount + 1))
done

# Sort and write the profile sizes to the size log file
if [ ${#profileSizes[@]} -ne 0 ]; then
    echo "Writing profile sizes to $sizeFile..."
    {
        echo "Profile directories and their .vhdx file sizes (in GB):"
        echo "-------------------------------------"
        for i in "${profileSizes[@]}"; do
            echo "$i"
        done | sort -nr -k1 > "$sizeFile"
    }
    echo "Done writing to $sizeFile."
else
    echo "No profiles found with .vhdx files."
fi

# Write the outdated profiles to the delete file
if [ ${#deleteCandidates[@]} -ne 0 ]; then
    echo "Writing outdated profiles to $deleteFile..."
    {
        echo "Profiles that haven't been updated in the last $daysThreshold days:"
        echo "Threshold Date (human-readable): $humanReadableThresholdDate"
        echo "Current Date (human-readable): $humanReadableCurrentDate"
        echo "-------------------------------------"
        for i in "${deleteCandidates[@]}"; do
            echo "$i"
        done
    } > "$deleteFile"
    echo "Done writing to $deleteFile."
else
    echo "No profiles found that are outdated."
fi

echo "Script completed."
```

---

## Step-by-Step Explanation

1. **Setup and Variable Initialization:**
   - The script sets up log file names and variables for the resource group, storage account, and file share (all masked for security).
   - It determines the script directory and ensures log files are fresh for each run.

2. **Fetch Storage Account Key:**
   - Uses the Azure CLI to retrieve the storage account key for authentication.

3. **Date Calculations:**
   - Gets the current date and calculates the threshold date (e.g., 30 days ago) to identify old profiles.

4. **List Profile Directories:**
   - Uses `az storage file list` to enumerate all profile directories in the file share.

5. **Analyze Each Profile:**
   - For each profile directory, lists files and looks for `.vhdx` files (FSLogix containers).
   - Retrieves file size and last modified date for each `.vhdx` file.
   - If the file hasn't been updated in the threshold period, adds it to the delete candidates list.

6. **Log Results:**
   - Writes a sorted list of profile sizes to a log file for review.
   - Writes a list of outdated profiles to a separate file for potential deletion.

7. **Output:**
   - All output is logged for auditing and review before any deletion is performed.

---

## Benefits of Running in a Container
- **Isolation:** Keeps dependencies and credentials isolated from your local environment.
- **Portability:** Easily run the script in any environment with Docker or container support.
- **Security:** Credentials and logs are contained within the container.

---

## Next Steps: Deleting Obsolete Profiles
- Review the generated log files to confirm which profiles are safe to delete.
- You can extend this script to delete profiles by using `az storage file delete` for each candidate.
- Always back up or confirm with stakeholders before deleting user data.

---

## Usage Example
This script is typically run as part of a maintenance workflow, either manually or on a schedule. For example, you might:
- Run the script in a container or Azure Cloud Shell.
- Review the output files (`step1-filesize.log` and `step1-input4step2.txt`).
- Use a follow-up script to delete the confirmed obsolete profiles.

---

**By regularly cleaning up obsolete FSLogix profiles, you can save on Azure storage costs and keep your environment healthy and efficient.**
