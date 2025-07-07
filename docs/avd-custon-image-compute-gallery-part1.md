# Part 1: Building and Publishing an Custom Image to Azure Compute Gallery

This article provides a comprehensive, step-by-step guide to creating a custom Azure Virtual Desktop (AVD) image using Infrastructure as Code (IaC), and publishing it to the Azure Compute Gallery. This is the foundation for deploying consistent, secure, and up-to-date AVD environments. For deploying AVD desktops from this image, see [Part 2](avd-publish-part2.md).

---

## Overview

The process involves:
- Cleaning up old images in the Azure Compute Gallery
- Determining the latest Microsoft 365 image SKU
- Creating an image template using Bicep and Azure CLI
- Building the image and publishing it to the Compute Gallery

---

## Step 1: Clean Out Old Images in Azure Compute Gallery

1. Navigate to your Azure Compute Gallery (e.g., `GDEP_Azure_Compute_Gallery`).
2. Identify and delete old images (sort by published date descending).
3. Keep only the most recent image (from last month) for rollback purposes.
4. Log in to Azure CLI as an administrator:

```bash
az login
```

> **Note:** Use an account with sufficient permissions (e.g., Contributor or higher on the resource group). Masked example: `user.name@domain.com`.

---

## Step 2: Determine the Latest Microsoft 365 Image SKU

To ensure your template uses the latest Microsoft 365 image, run:

```bash
az vm image list-skus --location eastus --publisher MicrosoftWindowsDesktop --offer office-365 --output table
```

- This command lists all available SKUs for Microsoft 365 images in the East US region.
- Update your Bicep or parameter file to reference the latest SKU as needed.

---

## Step 3: Create the Image Template Using Bicep

You can define your image template as code using a Bicep file (e.g., `avd.bicep`).

### Example Bicep Snippet

```bicep
param location string = 'eastus'
param imageTemplateName string = 'GDEPAVDWin11Template'
param galleryName string = 'GDEP_Azure_Compute_Gallery'
param resourceGroupName string = 'rg-gdep-peus-avd'
param sourceImagePublisher string = 'MicrosoftWindowsDesktop'
param sourceImageOffer string = 'office-365'
param sourceImageSku string = 'latest-sku-here'
param storageAccountUrl string = 'https://<maskedstorageaccount>.blob.core.windows.net/software/'

// ...other parameters as needed...

resource imageTemplate 'Microsoft.VirtualMachineImages/imageTemplates@2022-02-14' = {
  name: imageTemplateName
  location: location
  properties: {
    source: {
      type: 'PlatformImage'
      publisher: sourceImagePublisher
      offer: sourceImageOffer
      sku: sourceImageSku
      version: 'latest'
    }
    customize: [
      {
        type: 'PowerShell'
        name: 'InstallSoftware'
        scriptUri: '${storageAccountUrl}install.ps1'
      }
      // Add more customization steps as needed
    ]
    distribute: [
      {
        type: 'SharedImage'
        galleryImageId: '/subscriptions/<sub-id>/resourceGroups/${resourceGroupName}/providers/Microsoft.Compute/galleries/${galleryName}/images/GDEPAVDWin11Image'
        runOutputName: 'GDEPAVDWin11ImageOutput'
        artifactTags: {
          source: 'avd-image-builder'
        }
      }
    ]
  }
}
```

### Parameter File Example (`avdp.json`)

```json
{
  "location": { "value": "eastus" },
  "imageTemplateName": { "value": "GDEPAVDWin11Template" },
  "galleryName": { "value": "GDEP_Azure_Compute_Gallery" },
  "resourceGroupName": { "value": "rg-gdep-peus-avd" },
  "sourceImagePublisher": { "value": "MicrosoftWindowsDesktop" },
  "sourceImageOffer": { "value": "office-365" },
  "sourceImageSku": { "value": "latest-sku-here" },
  "storageAccountUrl": { "value": "https://<maskedstorageaccount>.blob.core.windows.net/software/" }
}
```

**Parameter Explanations:**
- `location`: Azure region for deployment.
- `imageTemplateName`: Name for the image template resource.
- `galleryName`: Name of the Azure Compute Gallery.
- `resourceGroupName`: Resource group for the template and gallery.
- `sourceImagePublisher`, `sourceImageOffer`, `sourceImageSku`: Define the base image.
- `storageAccountUrl`: URL to a non-secure storage account containing install scripts and software (mask this in documentation).

---

## Step 4: Deploy the Image Template

Run the following command to deploy the image template:

```bash
az deployment group create --name GDEPAVDImage --resource-group rg-gdep-peus-avd --template-file ./compute/img/avd/avd.bicep --parameters @./compute/vm/avd/avdp.json
```

- This command creates the image template in the specified resource group.

---

## Step 5: Build the Image and Publish to Compute Gallery

After the template is created, build the image and publish it:

```bash
az image builder run --resource-group rg-gdep-peus-avd --name GDEPAVDWin11Template --no-wait
```

- This command starts the image build process and publishes the resulting image to the Azure Compute Gallery.

---


## Step 6: Automate Software Installation and Configuration with avd.ps1

The `avd.ps1` PowerShell script is used during image creation to automate the installation and configuration of all required software and settings on the AVD image. Below is a detailed breakdown of its structure and key functions, with code examples and explanations for each part.

### Key Functions in avd.ps1

#### 1. `InvokeStartProcess`
Runs a command (such as an installer) in a specified working directory with arguments, waits for completion, and logs the result.

```powershell
Function InvokeStartProcess {
    Param([string]$Command,[string]$WorkingDirectory,[string]$Arguments)
    try {
        $InstallProcess = Start-Process -FilePath $Command `
                                        -WorkingDirectory $WorkingDirectory `
                                        -ArgumentList $Arguments `
                                        -Wait `
                                        -Passthru
        Write-Log "Installed successfully  using command ", $Command, $Arguments -join
    } catch {
        Write-Log "Error While running command ", $Command, $Arguments -join
        $InstallProcess.Kill()
    }
}
```

#### 2. `DownloadfilefromSA`
Downloads a file from a given URI to a destination filename and logs the result.

```powershell
Function DownloadfilefromSA {
    Param([string]$SourceURI,[string]$DestinationFileName)
    try {
        Invoke-WebRequest $SourceURI -OutFile $DestinationFileName        
        Write-Log "Downloaded successfully file ", $DestinationFileName -join
    } catch {
        Write-Log "Error While Downloading file ", $DestinationFileName -join
        $InstallProcess.Kill()
    }
}
```

#### 3. `Write-Log`
Writes a message to a log file and outputs it to the console.

```powershell
Function Write-Log {
    Param($message)
    Write-Output "$(get-date -format 'yyyyMMdd HH:mm:ss') $message" | Out-File -Encoding utf8 $logFile -Append
    Write-Output $message  
}
```

#### 4. `InstallandConfigureSoftware`
This is the main function that orchestrates all software installations, registry changes, and configuration steps. It uses Chocolatey (`choco`) to install a wide range of software and handles additional configuration for FSLogix, SAP, and more.

##### Chocolatey Installs (with code):

```powershell
choco install googlechrome -y --no-progress --limit-output --ignore-checksums >> $ChocoFileName
choco install notepadplusplus -y --no-progress --limit-output --ignore-checksums >> $ChocoFileName
choco install 7zip.install -y --no-progress --limit-output --ignore-checksums >> $ChocoFileName
choco install visioviewer -y --no-progress --limit-output --ignore-checksums >> $ChocoFileName
choco install vscode -y --no-progress --limit-output --ignore-checksums >> $ChocoFileName
choco install git -y --no-progress --limit-output --ignore-checksums >> $ChocoFileName
choco install powerbi -y --no-progress --limit-output --ignore-checksums >> $ChocoFileName
choco install winscp -y --no-progress --limit-output --ignore-checksums >> $ChocoFileName
choco install python -y --no-progress --limit-output --ignore-checksums >> $ChocoFileName
choco install wireshark -y --no-progress --limit-output --ignore-checksums >> $ChocoFileName
choco install sql-server-management-studio -y --no-progress --limit-output --ignore-checksums >> $ChocoFileName
choco install putty -y --no-progress --limit-output --ignore-checksums >> $ChocoFileName
```

**Explanation:**
- Each `choco install` command installs a specific application silently and logs the output.
- Chocolatey is a package manager for Windows, making it easy to automate software installation in your image builds.
- You can add or remove packages as needed for your own environment.

##### Additional Steps in `InstallandConfigureSoftware`:
- Configures FSLogix profile containers via registry.
- Applies local GPO and Office registry settings.
- Installs SAP, BPC Excel Add-In, and other business software.
- Creates desktop shortcuts for SAP, Notepad++, and a graceful logoff.
- Installs endpoint protection (Crowdstrike) and other utilities.
- All actions are logged for troubleshooting.

---

### Example: Downloading and Installing Software

```powershell
$StorageAccountDownloadURI = "https://<maskedstorageaccount>.blob.core.windows.net/software4avd/"
$SoftwarefolderName = "C:\\Software\\"

# Download a file
$file2Download = "ComputerGPO.cmd"
$fileURL2DownloadFrom = $StorageAccountDownloadURI + $file2Download
Invoke-WebRequest $fileURL2DownloadFrom -OutFile $SoftwarefolderName\$file2Download

# Install Chrome using Chocolatey
choco install googlechrome -y --no-progress --limit-output --ignore-checksums
```

### Security Note
- The storage account used for downloads should be read-only and not contain sensitive data.
- All user accounts and credentials should be masked in documentation.

---

## Additional Notes
- All scripts (e.g., `avd.ps1`) should be reviewed for security and idempotency.
- Use service principals or user accounts with Contributor or higher permissions for these operations. Mask actual usernames in documentation.


## Related Articles
- [Part 2: Deploying AVD Desktops](avd-publish-part2.md)
