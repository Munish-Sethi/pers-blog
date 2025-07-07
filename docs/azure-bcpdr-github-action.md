# Azure BCP/DR with GitHub Actions: Fully Automated Disaster Recovery

This article demonstrates how to automate the entire Azure Business Continuity/Disaster Recovery (BCP/DR) process using GitHub Actions. If you want to understand the step-by-step process, rationale, and all code involved, first review:

- [Part 1: Resource Group, Storage, and Network Foundation](./azure-bcpdr-part1.md)
- [Part 2: Compute, Firewall, VPN, and Restore](./azure-bcpdr-part2.md)

Those articles walk through each step and code block manually. Here, you will see how to run the same process end-to-end with a single click using GitHub Actions.

---

## Why Automate with GitHub Actions?
- **Consistency:** Every DR run is identical and repeatable.
- **Speed:** Deploy all infrastructure and restore VMs with minimal manual intervention.
- **Auditability:** All actions are logged in GitHub for compliance and troubleshooting.
- **Integration:** Easily tie into your existing CI/CD and approval workflows.

---

## Prerequisites
- Service Principal with Owner rights on the subscription (see Part 1).
- Manual creation of the DR deployment resource group (`dr-rg-gdep-pwus-deployment`) in West US.
- Valid and up-to-date VM list JSON files.

---

## Overview of the Automated Process
The automation is split into three GitHub Actions workflows:

1. **BCP-DR Infrastructure:** Deploys all Azure infrastructure (resource groups, storage, network, firewall, VPN, etc.)
2. **BCP-DR Restore VMs:** Restores VMs from backup into the DR region.
3. **BCP-DR Attach NIC(s):** Ensures restored VMs have the correct NICs and IPs.

Each workflow can be triggered manually from the GitHub Actions tab.

---

## Step 1: Deploy Infrastructure with GitHub Actions

**Workflow File:** `.github/workflows/bcpdrinfrastructure.yml`

```yaml
name: 01-BCP-DR Build Infrastructure

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment'
        required: true
        default: 'Development'
        type: 'choice'
        options:
          - 'Development'
          - 'Production'

jobs:
  build-bcp-dr-infrastructure:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v2
      - name: Login to Azure
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      # ...existing code for deploying Bicep files for all resources (see full YAML above)...
```

**Explanation:**
- This workflow deploys all BCP/DR infrastructure using the same Bicep files as in Part 1 and Part 2.
- Each step uses the `azure/arm-deploy@v1` action to deploy a specific Bicep template.
- You can select the environment (Development or Production) when running the workflow.

---

## Step 2: Restore VMs in the DR Region

**Workflow File:** `.github/workflows/bcpdrvms.yml`

```yaml
name: 02-BCP-DR Restore VMs

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment'
        required: true
        default: 'Development'
        type: 'choice'
        options:
          - 'Development'
          - 'Production'

jobs:
  build-bcp-dr-infrastructure-restore-vms:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v2
      - name: Login to Azure
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - name: Install PowerShell
        run: |
          curl https://packages.microsoft.com/keys/microsoft.asc | sudo apt-key add -
          curl https://packages.microsoft.com/config/ubuntu/$(lsb_release -rs)/prod.list | sudo tee /etc/apt/sources.list.d/mssql-release.list
          sudo apt-get update
          sudo apt-get install -y powershell
      - name: Install Azure CLI
        run: |
          curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
      - name: Create the VM(s) based on vmlist1.json
        if: ${{ github.event.inputs.environment == 'Development' }}
        run: |
          pwsh ./scripts/bcpdr/vm/restorevms.ps1 -restorediskonly "false" -numberofhours2wait 5 -vmlist './scripts/bcpdr/vm/vmlist.json'
        env:
          AZURE_SUBSCRIPTION_ID: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
          AZURE_CREDENTIALS: ${{ secrets.AZURE_CREDENTIALS }}
```

**Explanation:**
- This workflow restores VMs from backup using the provided PowerShell script and VM list.
- Installs PowerShell Core and Azure CLI as needed.
- All restore operations are logged in GitHub Actions.

---

## Step 3: Attach NICs to Restored VMs

**Workflow File:** `.github/workflows/bcpdrvmnics.yml`

```yaml
name: 03-BCP-DR Attach NIC(s)

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment'
        required: true
        default: 'Development'
        type: 'choice'
        options:
          - 'Development'
          - 'Production'

jobs:
  build-bcp-dr-infrastructure-restore-vmnics:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment }}
    steps:
      - name: Checkout repository
        uses: actions/checkout@v2
      - name: Login to Azure
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}
      - name: Install PowerShell
        run: |
          curl https://packages.microsoft.com/keys/microsoft.asc | sudo apt-key add -
          curl https://packages.microsoft.com/config/ubuntu/$(lsb_release -rs)/prod.list | sudo tee /etc/apt/sources.list.d/mssql-release.list
          sudo apt-get update
          sudo apt-get install -y powershell
      - name: Install Azure CLI
        run: |
          curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
      - name: Create and Attach NIC(s) to restored VM(s)
        if: ${{ github.event.inputs.environment == 'Development' }}
        run: |
          pwsh ./scripts/bcpdr/vm/attachnics.ps1 -vaultname "rsv-prod-eus-01" -vaultresourcegroupname "rg-gdep-peus-backup" -vmlist './scripts/bcpdr/vm/vmlist.json'
        env:
          AZURE_SUBSCRIPTION_ID: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
          AZURE_CREDENTIALS: ${{ secrets.AZURE_CREDENTIALS }}
```

**Explanation:**
- This workflow ensures that all restored VMs have the correct NICs and IP addresses, matching the original environment.
- Can be run multiple times to ensure NICs are correct.

---

## How to Run the Workflows
1. Go to your GitHub repository's **Actions** tab.
2. Select the workflow you want to run (Infrastructure, Restore VMs, Attach NICs).
3. Click **Run workflow**, select the environment, and start the workflow.
4. Monitor progress and logs directly in GitHub.

---

## Summary
- This approach automates the entire Azure BCP/DR process described in Part 1 and Part 2.
- All code, infrastructure, and restore steps are executed via GitHub Actions for speed, repeatability, and auditability.
---

**Ready to automate your DR? Trigger your first workflow in GitHub Actions!**