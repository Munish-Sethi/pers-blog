# Munish Sethi(s) Technical Blog

This project is a professional technical blog built with [MkDocs](https://www.mkdocs.org/) and the Material for MkDocs theme. It showcases business problem solutions, technical guides, and automation scripts, with a focus on Azure and SAP integration topics.

[![Open in Dev Containers](https://img.shields.io/static/v1?style=for-the-badge&label=Dev%20Containers&message=Open&color=blue&logo=visualstudiocode)](https://vscode.dev/redirect?url=vscode://ms-vscode-remote.remote-containers/cloneInVolume?url=https://github.com/Munish-Sethi/pers-blog)


> **Note:** This project is designed to be developed and run inside a [VS Code Dev Container](https://containers.dev/). All dependencies and environment setup are managed automatically when you open the project in a compatible environment (such as GitHub Codespaces or locally with VS Code and the Dev Containers extension).

## Features
- **Flat Markdown Structure:** Each article is a single Markdown file under the `docs/` folder for easy management and navigation.
- **Modern UI:** Powered by Material for MkDocs for a clean, responsive, and user-friendly experience.
- **Easy Navigation:** Articles are grouped by topic (Azure, SAP) and cross-referenced for seamless reading.
- **Production-Ready Examples:** Includes real-world code samples for Azure authentication, billing automation, resource inventory, and SAP integration.

## Project Structure
```
PERS-BLOG/
├── docs/
│   ├── azure-ad-certificate.md
│   ├── azure-billing.md
│   ├── azure-resources.md
│   ├── sap-rfc-python-container.md
│   ├── index.md
│   └── assets/
├── mkdocs.yml
├── requirements.txt
└── README.md
```

## Getting Started

1. Install Python and the required packages (see `requirements.txt`).
2. To preview the blog locally in your Dev Container or local environment, run:
   ```bash
   mkdocs serve --dev-addr=0.0.0.0:8000
   ```
   This will start a local server accessible at `http://localhost:8000`.
3. To build and deploy the site directly to GitHub Pages, use:
   ```bash
   mkdocs gh-deploy --force
   ```
   This command will build the static site and push it to the `gh-pages` branch of your repository.

## Adding New Articles
- Add a new Markdown file to the `docs/` folder (e.g., `my-new-article.md`).
- Add a placeholder entry in `mkdocs.yml` under the appropriate section, for example:
  ```yaml
  nav:
    - Azure:
        - My New Article: my-new-article.md
  ```
- Optionally, add a link to your new article in `docs/index.md` for easy access:
  ```markdown
  - [My New Article](my-new-article.md)
  ```
- Write your article content in the new Markdown file.

## Customization
- Custom CSS and JS can be added in `docs/assets/` and referenced in `mkdocs.yml`.
- The theme and navigation structure can be adjusted in `mkdocs.yml`.

## Custom Domain Setup

To use your custom domain (munishsethi.com) with GitHub Pages:

1. **DNS Configuration (AWS Route 53):**
   - In the AWS Route 53 console, select your hosted zone for `munishsethi.com`.
   - Add or update a record:
     - For the root domain, add an **A record (Alias)** pointing to GitHub Pages IPs:
       - 185.199.108.153
       - 185.199.109.153
       - 185.199.110.153
       - 185.199.111.153
     - For `www.munishsethi.com`, add a **CNAME** record pointing to `Munish-Sethi.github.io`.

2. **Repository Configuration:**
   - Ensure the `CNAME` file in your repo contains your domain: `munishsethi.com`.
   - Set `site_url` in `mkdocs.yml` to `https://munishsethi.com/` for correct sitemap and SEO.
   - A `robots.txt` and sitemap will be generated automatically.

3. **Wait for DNS propagation** (can take up to 24 hours).

For more details, see [GitHub Pages custom domain docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages).

## License
This project is for educational and professional demonstration purposes. Please review individual article content for any additional licensing or attribution requirements.
