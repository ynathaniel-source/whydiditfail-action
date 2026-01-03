# Why Did It Fail? - GitHub Action

> AI-powered GitHub Actions failure analysis that explains *why* your workflow failed and *how* to fix it.

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-Why%20Did%20It%20Fail-blue?logo=github)](https://github.com/marketplace/actions/whydiditfail)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## 🎯 What It Does

When your GitHub Actions workflow fails, this action automatically:
1. 🔍 Fetches the failure logs
2. 🤖 Analyzes them with AI
3. 📝 Posts a clear explanation with:
   - **Root cause** (what went wrong)
   - **Fix suggestions** (how to resolve it)
   - **Confidence score** (how certain the AI is)

## 🚀 Quick Start

### Prerequisites

1. **Deploy the service** (see [service repo](https://github.com/ynathaniel-source/whydiditfail-service))
2. **Add service URL to secrets**: `Settings → Secrets → Actions → New secret`
   - Name: `WHYDIDITFAIL_SERVICE_URL`
   - Value: Your deployed service URL (e.g., `https://your-api.execute-api.us-east-1.amazonaws.com`)

### Basic Usage

Add this to your workflow after any step that might fail:

```yaml
name: CI
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run tests
        run: npm test
      
      - name: Explain failure
        if: failure()
        uses: ynathaniel-source/whydiditfail-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          service_url: ${{ secrets.WHYDIDITFAIL_SERVICE_URL }}
```

### Advanced Usage

```yaml
- name: Explain failure with custom settings
  if: failure()
  uses: ynathaniel-source/whydiditfail-action@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
    service_url: ${{ secrets.WHYDIDITFAIL_SERVICE_URL }}
    mode: summary              # or 'comment' for PR comments
    max_log_kb: 500           # increase log size limit
    redact: true              # redact secrets (recommended)
```

## 📋 Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github_token` | ✅ Yes | - | GitHub token for API access (use `${{ secrets.GITHUB_TOKEN }}`) |
| `service_url` | ✅ Yes | - | URL of the deployed analysis service |
| `mode` | No | `summary` | Output mode: `summary` (job summary) or `comment` (PR comment) |
| `max_log_kb` | No | `400` | Maximum log size in KB to send to service |
| `redact` | No | `true` | Redact secrets from logs before analysis |

## 🔧 Setup

### 1. Deploy the Service

You need to deploy the analysis service (private repo). See the [service deployment guide](https://github.com/ynathaniel-source/whydiditfail-service#deployment).

### 2. Add Service URL to Secrets

Once deployed, add the service URL to your repository secrets:

```
Settings → Secrets and variables → Actions → New repository secret
Name: WHYDIDITFAIL_SERVICE_URL
Value: https://your-service-url.com
```

### 3. Add Action to Workflow

Use the action in your workflow with `if: failure()` to run only when a step fails.

## 📊 Example Output

When a workflow fails, you'll see a summary like this:

```markdown
## 🔍 Failure Analysis

**Category:** Dependency Installation Failure
**Confidence:** High (0.92)

### Root Cause
The build failed because `node-sass` requires Python 2.7, but the runner has Python 3.x.

### How to Fix
1. Switch to `sass` (the pure JavaScript implementation):
   ```bash
   npm uninstall node-sass
   npm install sass
   ```
2. Or install Python 2.7 in your workflow:
   ```yaml
   - uses: actions/setup-python@v4
     with:
       python-version: '2.7'
   ```

### Evidence
- Line 45: `gyp ERR! find Python`
- Line 47: `gyp ERR! Python is not set from command line or npm configuration`
```

## 🎨 Output Modes

### Summary Mode (Default)
Posts a job summary visible in the Actions UI.

```yaml
- uses: ynathaniel-source/whydiditfail-action@v1
  with:
    mode: summary
```

### Comment Mode
Posts a comment on the PR (if triggered by a PR).

```yaml
- uses: ynathaniel-source/whydiditfail-action@v1
  with:
    mode: comment
```

## 🔒 Security

- **Secrets are redacted** from logs before analysis
- **No logs are stored** by the service
- **Analysis is ephemeral** - results are returned immediately
- **GitHub token** is only used to fetch logs and post results

## 🛠️ Development

### Build

```bash
npm install
npm run build
```

This compiles TypeScript and creates `dist/` which must be committed for the action to work.

### Test

```bash
npm test
```

### Local Testing

```bash
# Set environment variables
export GITHUB_TOKEN=your-token
export WHYDIDITFAIL_SERVICE_URL=http://localhost:3000

# Run the action
node dist/index.js
```

## 📝 License

MIT - See [LICENSE](LICENSE) for details.

## 🤝 Contributing

Contributions welcome! Please open an issue or PR.

## 💬 Support

- 🐛 [Report a bug](https://github.com/ynathaniel-source/whydiditfail-action/issues)
- 💡 [Request a feature](https://github.com/ynathaniel-source/whydiditfail-action/issues)
- 📖 [Read the docs](https://github.com/ynathaniel-source/whydiditfail-service)

---

Made with ❤️ to make debugging GitHub Actions less painful.
