# Certificate-Based Authentication for Azure AD: Why and How

## Creating a Certificate for Azure AD Authentication

To use certificate-based authentication with Azure Active Directory (Azure AD), you first need to generate a certificate. Certificates provide a secure, manageable, and standards-based way to authenticate applications. A `.pfx` certificate may be required because Azure AD expects a certificate in Personal Information Exchange (PFX) format when uploading via the portal or for certain SDKs. The `.pfx` file contains both the public and private keys, protected by a password, and is suitable for import/export scenarios.

### Steps to Generate a Certificate Using OpenSSL

1. **Generate a Private Key:**
   ```sh
   openssl genrsa -out my-app-auth.key 2048
   ```
2. **Create a Certificate Signing Request (CSR):**
   ```sh
   openssl req -new -key my-app-auth.key -out my-app-auth.csr
   ```
3. **Generate a Self-Signed Certificate:**
   ```sh
   openssl x509 -req -days 730 -in my-app-auth.csr -signkey my-app-auth.key -out my-app-auth.crt
   ```
4. **Export to PFX (if needed for Azure):**
   ```sh
   openssl pkcs12 -export -out my-app-auth.pfx -inkey my-app-auth.key -in my-app-auth.crt
   ```
   > **Note:** The `.pfx` format is required if you want to upload the certificate via the Azure Portal or use it with some SDKs/tools. The `.crt` file is the public certificate, and the `.key` file is your private key (keep it secure!).

---

## Uploading the Certificate to Your Entra (Azure AD) Application

1. Go to the [Microsoft Entra admin center](https://entra.microsoft.com/) and select **Azure Active Directory**.
2. Navigate to **App registrations** and select your application.
3. In the left menu, click **Certificates & secrets**.
4. Under **Certificates**, click **Upload certificate**.
5. Select your `.crt` or `.pfx` file and upload it.
6. After uploading, Azure will display the certificate thumbprint. Save this value for use in your application code.

---

## Assigning Permissions to the Application

After uploading the certificate, you must assign the necessary API permissions to your application:

1. In your application's **App registration** page, go to **API permissions**.
2. Click **Add a permission** and select the required Microsoft APIs (e.g., Microsoft Graph, Azure Service Management, etc.).
3. Choose the appropriate permission type (Application or Delegated) and select the required permissions.
4. Click **Add permissions**.
5. If required, click **Grant admin consent** to approve the permissions for your organization.

> **Note:** The application will only be able to access resources for which it has been granted permissions. Make sure to review and assign only the permissions your app needs.

---

## Why Use a Certificate Instead of an Application Secret?

### 1. **Security**
- **Application secrets** are essentially passwords. They are susceptible to accidental exposure (e.g., in code repositories, logs, or configuration files).
- **Certificates** use asymmetric cryptography. The private key never leaves your environment, and only the public key is uploaded to Azure AD. This makes certificates much harder to compromise.

### 2. **Lifecycle Management**
- **Secrets** typically expire every 6-12 months, requiring regular rotation and updates in all dependent systems.
- **Certificates** can have longer lifespans (e.g., 1-2 years), and their expiration is easier to track and automate.

### 3. **Compliance and Best Practices**
- Microsoft and most security frameworks recommend certificates for service-to-service authentication.
- Certificates support better auditing and can be managed centrally (e.g., via Azure Key Vault).

---

## Why Use the MSAL Library (and Not a Specific Azure SDK)?

The [MSAL (Microsoft Authentication Library) for Python](https://github.com/AzureAD/microsoft-authentication-library-for-python) is a lightweight, flexible library for acquiring tokens from Azure AD. It supports a wide range of authentication scenarios, including certificate-based authentication for confidential clients.

- **Why MSAL?**
  - MSAL is the official library for handling authentication and token acquisition with Azure AD.
  - It is not tied to a specific Azure service, making it ideal for generic authentication scenarios.
  - It supports advanced scenarios like certificate-based authentication, multi-tenant apps, and more.

- **Why Not Use a Specific Azure SDK?**
  - Some Azure SDKs (e.g., for Storage, Key Vault, etc.) provide their own authentication mechanisms, but they may not support all advanced scenarios or may require additional dependencies.
  - Using MSAL directly gives you full control over the authentication flow and token management, and is more transparent for troubleshooting and customization.

---

## Code Example: Certificate-Based Authentication in Python

Below is the function used in this project to acquire an Azure AD access token using a certificate:

```python
from msal import ConfidentialClientApplication

def get_access_token_from_azure(client_id, authority, tenant_id, resource_scopes):
    """
    Retrieves an access token from Azure Active Directory using a confidential client application.
    This function uses certificate-based authentication to acquire an access token for the specified resource.
    """
    try:
        with open(f"certs/{PFX_CERTIFICATE_NAME}.key", "r") as key_file:
            private_key = key_file.read()

        app = ConfidentialClientApplication(
            client_id=client_id,
            authority=f"{authority}{tenant_id}",
            client_credential={
                "thumbprint": PFX_CERTIFICATE_NAME_TP,
                "private_key": private_key,
            },
        )

        result = app.acquire_token_for_client(scopes=resource_scopes)
        if "access_token" in result:
            return result["access_token"]

    except Exception as exception:
        handle_global_exception(sys._getframe().f_code.co_name, exception)
    finally:
        pass
```

### Key Points:
- The private key is read from a secure file (`certs/*.key`).
- The certificate thumbprint and private key are passed to MSAL's `ConfidentialClientApplication`.
- No secrets or passwords are stored in code or configuration.

---

## Conclusion

**Certificate-based authentication** is the recommended and most secure way to authenticate service applications with Azure AD. It reduces risk, simplifies management, and aligns with industry best practices. Migrating from secrets to certificates is straightforward and well-supported by both Azure and the MSAL Python library.

---

## References
- [MSAL Python Certificate Auth Sample](https://github.com/AzureAD/microsoft-authentication-library-for-python/tree/dev/sample)
- [Azure AD App Registration: Certificates & Secrets](https://learn.microsoft.com/en-us/azure/active-directory/develop/app-objects-and-service-principals)
- [OpenSSL Documentation](https://www.openssl.org/docs/)
