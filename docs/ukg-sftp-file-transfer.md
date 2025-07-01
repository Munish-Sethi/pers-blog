# Secure File Transfer with UKG Dimensions SFTP

---

## Introduction

UKG Dimensions (Kronos) provides SFTP endpoints for secure file exchange. For additional security, files are often encrypted (e.g., with PGP/GPG) before upload and must be decrypted after download. This article demonstrates how to:

- Connect to a UKG SFTP server using Python
- Download and decrypt files from UKG
- Encrypt and upload files to UKG
- Use Azure Storage (or any local mount) as your working directory
- Securely manage all credentials and keys using Azure Key Vault
- Import and manage GPG keys for file encryption/decryption

We use Python libraries such as `pysftp`, `paramiko`, `gnupg`, and Azure SDKs to accomplish these tasks.

---

## Prerequisites

- Python 3.7+
- The following Python packages:
  - `pysftp` (SFTP client)
  - `paramiko` (SSH key handling)
  - `python-gnupg` (PGP encryption/decryption)
  - `azure-identity`, `azure-keyvault-secrets` (Azure Key Vault access)
- Access to your UKG SFTP credentials and keys (public/private, passphrase)
- GPG/PGP keys for file encryption/decryption
- A local directory (e.g., Azure Storage mount) for file staging
- **Azure Key Vault for Secrets:** Store all sensitive credentials (SFTP username, private key, passphrase, GPG passphrase, etc.) in [Azure Key Vault](https://learn.microsoft.com/en-us/azure/key-vault/general/overview) and retrieve them securely at runtime. This avoids hardcoding secrets in your code or environment variables.

Install dependencies:
```bash
pip install pysftp paramiko python-gnupg azure-identity azure-keyvault-secrets
```

---

## Key Constants and Their Secure Retrieval

All SFTP credentials and keys are securely retrieved from Azure Key Vault using the `get_azure_kv_sceret` function. Here are the main constants and how they are constructed:

- **SFTP_UKG_DATA_HOST_NAME**: The SFTP server hostname (e.g., `'your-ukg-sftp-host.com'`).
- **SFTP_UKG_DATA_USER_NAME**: The SFTP username.
- **SFTP_UKG_PUBLIC_KEY**: The SFTP server's public key, retrieved and decoded as bytes:
  ```python
  SFTP_UKG_PUBLIC_KEY = bytes(get_azure_kv_sceret('ukg-sftp-host-public-key'), encoding='utf-8')
  ```
- **SFTP_UKG_PRIVATE_KEY**: The private key for SFTP authentication, retrieved as a base64-encoded string from Key Vault, then decoded to a PEM string:
  ```python
  SFTP_UKG_PRIVATE_KEY = base64.b64decode(get_azure_kv_sceret('ukg-sftp-host-private-key')).decode('utf-8')
  ```
  **Why base64.b64decode?**
  > When storing sensitive files like private keys in Azure Key Vault, it is common to first encode them using Base64. This ensures the key is stored as a plain string (since Key Vault secrets are always strings) and avoids issues with special characters or line breaks. When retrieving the key, you must decode it back to its original binary (or PEM) format using `base64.b64decode`. This allows you to safely store and retrieve binary data (like private keys) in a text-only secret store.
- **SFTP_UKG_PRIVATE_KEY_PASSPHRASE**: The passphrase for the private key, also retrieved from Key Vault.

---

## How `get_azure_kv_sceret` Works

This function retrieves secrets from Azure Key Vault using the Azure SDK. It authenticates using environment variables for client ID, client secret, and tenant ID, then fetches the secret value by name:

```python
def get_azure_kv_sceret(name):
    secret = None
    try:
        vault_url = "https://<your-key-vault-name>.vault.azure.net/"
        client_id = os.environ.get("application_interface_clientid")
        client_secret = os.environ.get("application_interface_clientsecret")
        tenant_id = os.environ.get("application_interface_tenantid")
        credential = ClientSecretCredential(client_id=client_id, client_secret=client_secret, tenant_id=tenant_id)
        secret_client = SecretClient(vault_url=vault_url, credential=credential)
        retrieved_secret = secret_client.get_secret(name)
        secret = retrieved_secret.value
    except Exception as e:
        print("Error:", str(e))
    finally:
        return secret
```

---

## Importing and Managing GPG Keys for UKG File Encryption/Decryption

When your container is first provisioned, you should import the GPG keys required for file encryption and decryption. The following function, typically run at container startup, retrieves the GPG public and private keys from Azure Key Vault, decodes them, saves them to disk, and imports them into the GPG keyring:

```python
def download_and_import_gpg_keys():
    try:
        ukg_sftp_public_encrypt = base64.b64decode(get_azure_kv_sceret('ukg-sftp-public-encrypt')).decode('utf-8')
        ukg_sftp_private_decrypt = base64.b64decode(get_azure_kv_sceret('ukg-sftp-private-decrypt')).decode('utf-8')
        # Save public key
        public_key_file = "certs/public_ukg_encrypt.asc"
        with open(public_key_file, "w") as file:
            file.write(ukg_sftp_public_encrypt)
        # Save private key
        private_key_file = "certs/private_ukg_decrypt.asc"
        with open(private_key_file, "w") as file:
            file.write(ukg_sftp_private_decrypt)
        # Import the public key
        subprocess.run(["gpg", "--batch", "--yes", "--import", public_key_file], check=True)
        # Import the private key with passphrase
        subprocess.run([
            "gpg", "--batch", "--yes", "--pinentry-mode=loopback",
            "--passphrase", os.environ["ukg_encrypt_passphrase"],
            "--import", private_key_file
        ], check=True)
        os.remove(public_key_file)
        os.remove(private_key_file)
    except Exception as e:
        print(f"Failed to import GPG keys: {e}")
```

**When to run this:**
- Run this function once at container startup (or as part of your provisioning script) to ensure the GPG keys are available for all encryption/decryption operations in your UKG SFTP workflows.
- This ensures that all subsequent file transfers (upload/download) can use GPG seamlessly at the OS level.

---

## SFTP Connection Function (with Explanation)

The following function establishes a secure SFTP connection to the UKG server using all the above constants. It supports both production and non-production environments:

```python
import pysftp
import paramiko
import base64
import io
import warnings

def get_sftp_connection(environment: str) -> Optional[pysftp.Connection]:
    """
    Establish an SFTP connection to the UKG server.
    Returns a pysftp.Connection object if successful, otherwise None.
    """
    localConnection: Optional[pysftp.Connection] = None
    try:
        hostname = (SFTP_UKG_DATA_HOST_NAME if environment == 'PROD' else SFTP_UKG_DATA_HOST_NAME_NON_PROD)
        username = (SFTP_UKG_DATA_USER_NAME if environment == 'PROD' else SFTP_UKG_DATA_USER_NAME_NON_PROD)
        hostkey = (SFTP_UKG_PUBLIC_KEY if environment == 'PROD' else SFTP_UKG_PUBLIC_KEY_NON_PROD)
        warnings.filterwarnings('ignore', '.*Failed to load HostKeys.*')
        hostKey = paramiko.RSAKey(data=base64.decodebytes(hostkey))
        cnopts = pysftp.CnOpts()
        cnopts.hostkeys.add(hostname, 'ssh-rsa', hostKey)
        # Convert private key string to file-like object
        with io.StringIO(SFTP_UKG_PRIVATE_KEY) as private_key_file:
            private_key = paramiko.RSAKey.from_private_key(private_key_file, password=SFTP_UKG_PRIVATE_KEY_PASSPHRASE)
            localConnection = pysftp.Connection(host=hostname, username=username, private_key=private_key, cnopts=cnopts)
    except Exception as e:
        print(f"SFTP connection failed: {e}")
    return localConnection
```

This function:
- Retrieves all connection parameters and keys from Azure Key Vault.
- Decodes and loads the SFTP server's public key for host verification.
- Loads the private key and passphrase for authentication.
- Returns a live SFTP connection object for use in upload/download operations.

---

## Downloading and Decrypting Files from UKG

UKG may deliver files encrypted with PGP/GPG. Use `python-gnupg` to decrypt after download.

```python
import gnupg

gpg = gnupg.GPG()
LOCAL_DOWNLOAD_DIR = '/mnt/azure/UKG/Download/'  # Example: Azure Storage mount
REMOTE_UKG_FOLDER = './Outbound/'

def download_and_decrypt_files():
    with get_sftp_connection('PROD') as sftp:
        sftp.cwd(REMOTE_UKG_FOLDER)
        for filename in sftp.listdir():
            if filename.endswith('.gpg'):
                local_path = os.path.join(LOCAL_DOWNLOAD_DIR, filename)
                sftp.get(filename, local_path)
                print(f"Downloaded: {filename}")
                # Decrypt the file
                with open(local_path, 'rb') as f:
                    decrypted_data = gpg.decrypt_file(f, passphrase=os.environ["ukg_encrypt_passphrase"])
                if decrypted_data.ok:
                    decrypted_path = local_path.replace('.gpg', '')
                    with open(decrypted_path, 'w', encoding='utf-8') as out:
                        out.write(str(decrypted_data))
                    print(f"Decrypted: {decrypted_path}")
                else:
                    print(f"Decryption failed for {filename}: {decrypted_data.status}")
```

---

## Encrypting and Uploading Files to UKG

Before uploading, files must be encrypted with UKG's public key.

```python
def encrypt_and_upload_file(local_file, remote_folder='./Inbound/'):
    with open(local_file, 'rb') as f:
        encrypted_data = gpg.encrypt_file(
            f,
            recipients=['UKG_PUBLIC_KEY_NAME'],  # Replace with UKG's GPG key name
            always_trust=True
        )
    if not encrypted_data.ok:
        print(f"Encryption failed: {encrypted_data.status}")
        return
    encrypted_file = local_file + '.gpg'
    with open(encrypted_file, 'wb') as ef:
        ef.write(encrypted_data.data)
    print(f"Encrypted: {encrypted_file}")
    with get_sftp_connection('PROD') as sftp:
        sftp.cwd(remote_folder)
        sftp.put(encrypted_file)
        print(f"Uploaded: {encrypted_file} to {remote_folder}")
```

---

## Putting It All Together

You can automate the full workflow:

```python
def main():
    download_and_import_gpg_keys()  # Ensure GPG keys are imported at container startup
    download_and_decrypt_files()
    file_to_upload = '/mnt/azure/UKG/Upload/myfile.csv'
    encrypt_and_upload_file(file_to_upload)

if __name__ == "__main__":
    main()
```

---

## Key Points and Best Practices

- **Key Management:** Never hardcode sensitive keys or passphrases in your code. Use environment variables or a secure vault.
- **File Cleanup:** Remove decrypted/encrypted files after processing if not needed.
- **Error Handling:** Add robust error handling for production use.
- **Azure Storage:** If using Azure Files, ensure your container mounts the share with correct permissions.
- **Security:** Only trust files from known sources and validate signatures if possible.
- **GPG Key Import:** Always import GPG keys at the OS level before running any file encryption/decryption operations.

---

## References

- [pysftp Documentation](https://pysftp.readthedocs.io/en/release_0.2.9/)
- [python-gnupg Documentation](https://pythonhosted.org/python-gnupg/)
- [UKG Dimensions Integration Guides](https://community.kronos.com/s/)
- [Azure Key Vault Documentation](https://learn.microsoft.com/en-us/azure/key-vault/)
