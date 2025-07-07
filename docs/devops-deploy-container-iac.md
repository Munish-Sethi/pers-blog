# Deploying Azure Container Instances with BICEP (IaC)

This article demonstrates how to use Infrastructure as Code (IaC) with BICEP to deploy an Azure Container Instance (ACI). We'll walk through the main BICEP template, explain each section, and highlight best practices such as using Azure Key Vault for secrets management.

---

## Introduction

Azure Container Instances provide a fast and simple way to run containers in Azure, without managing virtual machines. Using BICEP, you can define your container infrastructure as code, making deployments repeatable and version-controlled.

---

## BICEP Template Overview

The main BICEP file is `compute/ci/interface/interface.bicep`. It defines all the parameters, secrets, and resources needed to deploy an ACI.

### Parameters

```bicep
param image_name string 
param image_tag string 
param container_registry_name string 
param aci_name string
param subnet_name string
param tags object
param subnet_id string
param volume_name string 

@secure()
param azure_file_share_name string
@secure()
param azure_file_share_user_name string
@secure()
param application_interface_clientid string
@secure()
param application_interface_clientsecret string
@secure()
param application_interface_tenantid string
@secure()
param container_registry_password string
@secure()
param azure_file_share_password string
@secure()
param ukg_encrypt_passphrase string
param location string = resourceGroup().location
param containerRegistryServer string = '${container_registry_name}.azurecr.io' 
```

**Explanation:**  
- Parameters allow you to customize the deployment.  
- `@secure()` marks secrets so they are not logged or exposed.  
- Many parameters are injected from Azure Key Vault for security.

### Variables

```bicep
var container_registry_username  = container_registry_name
```

**Explanation:**  
- Sets the registry username to the registry name for convenience.

### Resource Definition

```bicep
resource aci 'Microsoft.ContainerInstance/containerGroups@2023-05-01' = {
  name: aci_name
  location: location
  tags: tags

  properties: {
    containers: [
      {
        name: aci_name
        properties: {
          image: '${containerRegistryServer}/${image_name}:${image_tag}'
          ports: [
            {
              port: 80
              protocol: 'TCP'
            }
          ]
          resources: {
            limits: {
              cpu: 4
              memoryInGB: json('16')
            }
            requests: {
              cpu: 4
              memoryInGB: json('16')
            }
          }
          environmentVariables:[
            {
              name:'application_interface_clientid'
              secureValue:application_interface_clientid
            }
            {
              name:'application_interface_clientsecret'
              secureValue:application_interface_clientsecret
            }
            {
              name:'application_interface_tenantid'
              secureValue:application_interface_tenantid
            }
            {
              name:'azure_file_share_name'
              secureValue:azure_file_share_name
            }
            {
              name:'azure_file_share_user_name'
              secureValue:azure_file_share_user_name
            }
            {
              name:'azure_file_share_password'
              secureValue:azure_file_share_password
            }
            {
              name:'ukg_encrypt_passphrase'
              secureValue:ukg_encrypt_passphrase
            }
          ]
          volumeMounts: [
            {
              name: volume_name
              mountPath: '/mnt/azure'
              readOnly: false
            }
          ]
        }
      }
    ]
    osType: 'Linux'
    imageRegistryCredentials: [
      {
        server: containerRegistryServer
        username: container_registry_username
        password: container_registry_password
      }
    ]
    volumes: [
      {
        name: volume_name 
        azureFile: {
          shareName: azure_file_share_name
          storageAccountName: azure_file_share_user_name
          storageAccountKey: azure_file_share_password
        }
      }
    ]
    priority: 'Regular'
    restartPolicy: 'Never'
    sku: 'Standard'
    subnetIds: [
      {
        id: subnet_id
        name: subnet_name
      }
    ]
    dnsConfig: {
      nameServers: [
        '10.27.11.4'
        '10.27.11.5'
        '168.63.129.16'  
      ]
    }
  }
}
```

**Explanation:**  
- **Container Definition:** Specifies the image, ports, resources, environment variables, and volume mounts.
- **Resources:** Both `limits` and `requests` are set to 4 CPUs and 16GB RAM.
- **Environment Variables:** Secure values are injected from Key Vault.
- **Volumes:** Azure File Share is mounted for persistent storage.
- **Image Registry Credentials:** Pulled securely from parameters.
- **Networking:** Subnet and DNS configuration are specified.

---

### Parameters File

The `interface-dev.parameters.json` file provides all parameter values for deployment. This keeps secrets and environment-specific values out of the main template.

**Advantages:**
- **Separation of Concerns:** Code and configuration are separated.
- **Reusability:** Use different parameter files for different environments.

---

### Why Use Azure Key Vault?

- **Security:** Secrets like passwords and client secrets are never stored in source control.
- **Centralized Management:** Rotate secrets in one place without updating code.
- **Integration:** BICEP and Azure Resource Manager can reference Key Vault secrets directly.

---

## Related Articles
- [How to Build Your Container Image](devops-build-container.md)
- [How to Run Your Azure Container Instance Bicep Deployment](devops-deploy-container-github-action.md)