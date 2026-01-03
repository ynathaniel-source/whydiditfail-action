# Why Did It Fail? - GitHub Action

> AI-powered GitHub Actions failure analysis that explains *why* your workflow failed and *how* to fix it.

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-Why%20Did%20It%20Fail-blue?logo=github)](https://github.com/marketplace/actions/whydiditfail)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
![No API Keys](https://img.shields.io/badge/No%20API%20Keys-Needed-brightgreen)
![Open Source](https://img.shields.io/badge/Open-Source-orange)
![Free Tier](https://img.shields.io/badge/Free-20%2Fmonth-blue)

**🔒 No Secrets. No Code Sent. Only Failure Logs Analyzed.**

## 🎯 What It Does

When your GitHub Actions workflow fails, this action automatically:
1. 🔍 Fetches the failure logs
2. 🤖 Analyzes them with AI
3. 📝 Posts a clear explanation with:
   - **Root cause** (what went wrong)
   - **Fix suggestions** (how to resolve it)
   - **Confidence score** (how certain the AI is)

## 🚀 Quick Start

### Installation

Just add this to your workflow - **no setup required**:

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
```

That's it! No API keys, no secrets, no deployment needed.

### 📊 Example Output

When a workflow fails, you'll see a summary like this in your GitHub Actions UI:

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

### Advanced Usage

Customize the behavior with optional inputs:

```yaml
- name: Explain failure with custom settings
  if: failure()
  uses: ynathaniel-source/whydiditfail-action@v1
  with:
    mode: summary              # or 'comment' for PR comments
    max_log_kb: 500           # increase log size limit
    redact: true              # redact secrets (recommended)
```

#### Self-Hosted Service

Want to use your own service? Just provide the URL:

```yaml
- name: Explain failure
  if: failure()
  uses: ynathaniel-source/whydiditfail-action@v1
  with:
    service_url: ${{ secrets.WHYDIDITFAIL_SERVICE_URL }}
```

## 📋 Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github_token` | No | `${{ github.token }}` | GitHub token for authentication (auto-configured) |
| `service_url` | No | `https://api.whydiditfail.com` | URL of the analysis service (uses hosted service by default) |
| `mode` | No | `summary` | Output mode: `summary` (job summary) or `comment` (PR comment) |
| `max_log_kb` | No | `400` | Maximum log size in KB to send to service (hard cap: 400 KB) |
| `redact` | No | `true` | Redact secrets from logs before analysis |

## 💡 Limits & Fair Use

We want everyone to benefit from AI-powered debugging, so we've set some reasonable limits:

- **Free tier**: 20 failure analyses per repository per month
- **Log size**: We analyze the last 400 KB of logs (where errors usually are)
- **Response time**: Analysis completes in under 60 seconds

These limits keep the service fast and reliable for everyone. If you need more, consider self-hosting or reach out to discuss options.

## 🔐 Authentication

**No API keys required!** The action uses GitHub's built-in authentication:

- Uses `GITHUB_TOKEN` automatically (no configuration needed)
- Token is sent as a Bearer token to verify the request
- Only failure logs are analyzed - no repository contents are accessed

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

## 🔒 Privacy & Security

Your code and data are safe:

- ✅ **We never store your logs** - Analysis is ephemeral and discarded immediately
- ✅ **We never access your code** - Only failure logs are sent, never repository contents
- ✅ **Secrets are automatically redacted** - Common patterns filtered before analysis
- ✅ **No API keys or signup required** - Uses GitHub's built-in authentication
- ✅ **Open source** - Audit the code yourself, or self-host for complete control

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
