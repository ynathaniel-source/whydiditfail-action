<p align="center">
  <img src="whydiditfail-logo.png" alt="Why Did It Fail Logo" width="96" height="96">
</p>

# Why Did It Fail? - GitHub Action

> Turn GitHub Actions failures into clear root-cause explanations + fixes.

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-Why%20Did%20It%20Fail-blue?logo=github)](https://github.com/marketplace/actions/whydiditfail)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
![No API Keys](https://img.shields.io/badge/No%20API%20Keys-Required-brightgreen)
![Free to Try](https://img.shields.io/badge/Free-to%20try-blue)
![Open Source Action](https://img.shields.io/badge/Open%20Source-Action-orange)

No API keys. No access to your code. Only failure logs are analyzed.

## 🚀 Quick Start

Add a failure analysis job to your workflow - **no setup required**:

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run tests
        run: npm test
  
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run linter
        run: npm run lint
  
  # Add this job to analyze failures
  analyze-failures:
    runs-on: ubuntu-latest
    needs: [test, lint]  # List all jobs you want to monitor
    if: failure()        # Only runs when a job fails
    permissions:
      contents: read
      pull-requests: write  # Optional: enables inline fix suggestions
    steps:
      - uses: actions/checkout@v4
      - uses: ynathaniel-source/whydiditfail-action@v1
```

That's it! No API keys, no secrets, no deployment needed.

**How it works:** When any job in `needs` fails, the `analyze-failures` job runs and analyzes all failures together in one comprehensive report.

> **Note:** The `pull-requests: write` permission enables inline fix suggestions on PRs. Without it, the action will still work and post summaries, but won't post PR review comments.

## What you'll see when CI fails

Instead of scrolling logs, you get a concise explanation directly in the workflow summary.

When a workflow fails, you'll see a summary like this in your GitHub Actions UI:

<p align="center">
  <img src="github_action_screenshot.png" alt="GitHub Action Failure Analysis Screenshot" width="800">
</p>

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

## 🎯 What It Does

When your GitHub Actions workflow fails, this action automatically:
1. 🔍 Fetches the failure logs
2. 🤖 Analyzes them with AI
3. 📝 Posts a clear explanation with:
   - **Root cause** (what went wrong)
   - **Fix suggestions** (how to resolve it)
   - **Confidence score** (how certain the AI is)
4. 🔧 **Posts inline code fix suggestions** (for PRs and commits)
   - One-click apply for PR reviews
   - Direct commit comments for pushes
   - Only for high-confidence, fixable errors

Ideal for teams tired of debugging flaky CI failures and dependency issues.

## 🔒 Privacy & Security

Your code and data are safe:

- ✅ **We never store your logs** - Analysis is ephemeral and discarded immediately
- ✅ **We never access your code** - Only failure logs are sent, never repository contents
- ✅ **Secrets are automatically redacted** - Common patterns filtered before analysis
- ✅ **No API keys or signup required** - Uses GitHub's built-in authentication
- ✅ **Open source** - Audit the code yourself, or self-host for complete control

## 📋 Inputs / Advanced Usage

Customize the behavior with optional inputs:

```yaml
analyze-failures:
  needs: [test, lint]
  if: failure()
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: ynathaniel-source/whydiditfail-action@v1
      with:
        mode: summary              # or 'comment' for PR comments
        max_log_kb: 500           # increase log size limit
        redact: true              # redact secrets (recommended)
```

### All Available Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github_token` | No | `${{ github.token }}` | GitHub token for authentication (auto-configured) |
| `service_url` | No | `https://api.whydiditfail.com` | URL of the analysis service (uses hosted service by default) |
| `mode` | No | `summary` | Output mode: `summary` (job summary) or `comment` (PR comment) |
| `max_log_kb` | No | `400` | Maximum log size in KB to send to service (hard cap: 400 KB) |
| `redact` | No | `true` | Redact secrets from logs before analysis |
| `suggest_fixes` | No | `true` | Post inline fix suggestions as PR review comments or commit comments |

---

## 🔧 Inline Fix Suggestions

WhyDidItFail can automatically post code fix suggestions for common errors:

### For Pull Requests
- **One-click apply**: Fix suggestions appear as PR review comments with GitHub's native suggestion syntax
- **Just click "Apply suggestion"** and commit - no manual copy-paste needed
- Works for compilation errors, missing imports, type errors, and more

### For Direct Pushes
- **Commit comments**: Fix suggestions are posted as comments on the failing commit
- **Easy to find**: Check the commit page for detailed fix suggestions with code snippets

### Disabling Fix Suggestions

If you prefer not to have fix suggestions posted automatically:

```yaml
analyze-failures:
  needs: [test, lint]
  if: failure()
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: ynathaniel-source/whydiditfail-action@v1
      with:
        suggest_fixes: false  # Disable inline fix suggestions
```

### Required Permissions (Optional)

To enable inline fix suggestions on pull requests, add `pull-requests: write` permission:

```yaml
analyze-failures:
  runs-on: ubuntu-latest
  needs: [test, lint]
  if: failure()
  permissions:
    contents: read
    pull-requests: write  # Optional: enables inline fix suggestions on PRs
  steps:
    - uses: actions/checkout@v4
    - uses: ynathaniel-source/whydiditfail-action@v1
```

**Note:** Without this permission, the action will still work and post summaries, but won't be able to post inline PR review comments. Commit comments (for pushes) don't require this permission.

---

## Advanced Topics

### Safe by default (cost & usage controls)

To keep usage predictable and safe, WhyDidItFail includes built-in limits. These never fail your workflow and only affect how much context is analyzed.

- **Free tier**: 35 failure analyses per repository per month (20 standard + 15 grace period)
- **Log size**: We analyze the last 400 KB of logs (where errors usually are)
- **Response time**: Analysis completes in under 60 seconds

### Self-Hosted Service

Want to use your own service? Just provide the URL:

```yaml
analyze-failures:
  needs: [test, lint]
  if: failure()
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: ynathaniel-source/whydiditfail-action@v1
      with:
        service_url: ${{ secrets.WHYDIDITFAIL_SERVICE_URL }}
```

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
