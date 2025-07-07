# How to Run Your Azure Container Instance Bicep Deployment

This article explains how to execute your Bicep-based Azure Container Instance deployment, both via GitHub Actions and from the command line.

---

## Running with GitHub Actions

The workflow file `.github/workflows/ciinterface.yml` automates the build, push, and deployment process.

### Key Steps in the Workflow

```yaml
name: Interface Container Instance

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
  build-and-push-image:
    runs-on: ubuntu-latest
    environment: ${{ github.event.inputs.environment }}

    steps:
      - name: Checkout repository
        uses: actions/checkout@v2

      - name: Login to Azure
        uses: azure/login@v2
        with:
          creds: ${{ secrets.AZURE_CREDENTIALS }}

      - name: Azure key vault - Get Secret
        uses: Azure/get-keyvault-secrets@v1
        with:
          keyvault: ${{ vars.AZURE_KEY_VAULT_NAME }}
          secrets: patgdepintfcrepo
        id: getAZKVpatgdepiacrepo
      
      - name: Build Docker image
        run: |
          docker build --build-arg GITHUB_PAT="${{ steps.getAZKVpatgdepiacrepo.outputs.patgdepintfcrepo }}" \
                       -t ${{ vars.CONTAINER_REGISTRY_LOGIN_SERVER }}/${{ vars.IMAGE_NAME }}:latest \
                       compute/ci/interface/container

      - name: Login to Azure Container Registry
        run: |
          echo $ACR_PASSWORD | docker login ${{ vars.CONTAINER_REGISTRY_LOGIN_SERVER }} -u $ACR_USERNAME --password-stdin
        env:
          ACR_USERNAME: ${{ vars.ACR_USERNAME }}
          ACR_PASSWORD: ${{ secrets.ACR_PASSWORD }}
      
      - name: Push Docker image to Azure Container Registry
        run: docker push ${{ vars.CONTAINER_REGISTRY_LOGIN_SERVER }}/${{ vars.IMAGE_NAME }}:latest

      - name: Deploy the bicep file
        if: ${{ github.event.inputs.environment == 'Development' }}
        uses: azure/arm-deploy@v1
        with:
          scope: 'resourcegroup'
          subscriptionId: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
          resourceGroupName: rg-gdep-peus-2delete
          template: ./compute/ci/interface/interface.bicep
          parameters: ./compute/ci/interface/interface-dev.parameters.json
```

**Explanation:**  
- **Build and Push:** Docker image is built and pushed to Azure Container Registry.
- **Secrets:** Pulled securely from Azure Key Vault.
- **Deploy:** The Bicep template is deployed using the specified parameters file.

---

## Running from the Command Line

You can also deploy the Bicep template directly using Azure CLI:

```sh
az login
az account set --subscription "<your-subscription-id>"
az deployment group create \
  --resource-group <your-resource-group> \
  --template-file ./compute/ci/interface/interface.bicep \
  --parameters @./compute/ci/interface/interface-dev.parameters.json
```

**Tips:**
- Make sure you have the [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) and [Bicep CLI](https://docs.microsoft.com/en-us/azure/azure-resource-manager/bicep/install) installed.
- Use Key Vault references in your parameters file for secrets.

---

## Related Articles
- [How to Build Your Container Image](devops-build-container.md)
- [How to Deploy an Azure Container Instance Using Bicep (IaC)](devops-deploy-container-iac.md)