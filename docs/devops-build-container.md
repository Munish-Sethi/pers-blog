# Building the Container Image: Dockerfile Explained

This article explains how to build the container image for your Azure Container Instance, focusing on the `Dockerfile` and `requirements.txt`. This is the foundation for running your application in the cloud. For deploying and running the image using Bicep and GitHub Actions, see the related articles linked below.

---

## Overview

The container image is built using a `Dockerfile` and a `requirements.txt` file. The Dockerfile defines the environment, dependencies, and setup steps, while `requirements.txt` lists the Python packages needed by your application.

---

## Dockerfile Walkthrough

The main Dockerfile is located at `compute/ci/interface/container/Dockerfile`.

### Key Sections

```dockerfile
# Use a specific version of the base image
FROM mcr.microsoft.com/devcontainers/python:3

# Keeps Python from generating .pyc files in the container
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install necessary packages
RUN apt-get update && \
    apt-get install -y \
    supervisor \
    unzip \
    build-essential \
    python3-dev \
    git \
    curl \
    gnupg \
    snmp 

# Add Microsoft GPG key and SQL Server repository
RUN curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg
RUN curl https://packages.microsoft.com/config/debian/12/prod.list | tee /etc/apt/sources.list.d/mssql-release.list

# Install Microsoft SQL Server related packages
RUN apt-get update && \
    ACCEPT_EULA=Y apt-get install -y \
    msodbcsql18 \
    mssql-tools18 

# Install PowerShell Core and modules
RUN curl -fsSL https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -o packages-microsoft-prod.deb && \
dpkg -i packages-microsoft-prod.deb && \
rm packages-microsoft-prod.deb && \
apt-get update && \
apt-get install -y powershell

RUN pwsh -Command Install-Module PnP.PowerShell -Force -AllowClobber -SkipPublisherCheck
RUN pwsh -Command Install-Module ExchangeOnlineManagement -Force -AllowClobber -SkipPublisherCheck
RUN pwsh -Command Install-Module MicrosoftTeams -Force -AllowClobber -SkipPublisherCheck

# Clean up
RUN apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Add MS SQL Server tools to PATH
RUN echo 'export PATH="$PATH:/opt/mssql-tools18/bin"' >> ~/.bashrc

# Supervisor configuration
RUN mkdir -p /etc/supervisor/conf.d
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Copy and install Python dependencies
COPY requirements.txt .
RUN python -m pip install -r requirements.txt

# Clone the private repository using a build argument
ARG GITHUB_PAT
RUN git clone https://$GITHUB_PAT@github.com/GDEnergyproducts/GDEP-INTFC.git /app

WORKDIR /app

RUN chmod +x scripts/container/setuppyrfc.sh
RUN chmod +x scripts/container/mountstorage.sh
RUN ./scripts/container/setuppyrfc.sh

# Run tests
RUN pytest

# Start supervisor
CMD ["/usr/bin/supervisord"]
```

**Explanation:**
- **Base Image:** Uses a Python dev container as the base.
- **System Packages:** Installs tools for Python, SQL Server, PowerShell, and more.
- **PowerShell Modules:** Installs modules for Azure and Microsoft 365 automation.
- **Python Dependencies:** Installs all Python packages listed in `requirements.txt`.
- **Source Code:** Clones the application code from a private GitHub repository using a build argument for authentication.
- **Setup Scripts:** Makes and runs setup scripts executable.
- **Testing:** Runs `pytest` to ensure the build is valid.
- **Supervisor:** Uses Supervisor to manage processes in the container.

---

## requirements.txt

This file lists all Python dependencies needed by your application. It is copied into the image and installed with pip. Keeping dependencies in this file makes builds reproducible and easy to update.

---

## Building the Image Locally

To build the image locally, run:

```sh
docker build --build-arg GITHUB_PAT=your_token_here -t myacr.azurecr.io/myimage:latest compute/ci/interface/container
```

Replace `your_token_here` with a valid GitHub personal access token.

---

## Related Articles
- [How to Deploy an Azure Container Instance Using Bicep (IaC)](devops-deploy-container-iac.md)
- [How to Run Your Azure Container Instance Bicep Deployment](devops-deploy-container-github-action.md)
