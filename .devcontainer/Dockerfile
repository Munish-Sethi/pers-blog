# Devcontainer for MkDocs (Material theme)
FROM python:3.11-slim

# Install git and clean up apt cache
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install MkDocs and Material theme
RUN pip install --no-cache-dir mkdocs mkdocs-material mkdocs-git-revision-date-localized-plugin mkdocs-awesome-pages-plugin

# Set workdir
WORKDIR /workspace
