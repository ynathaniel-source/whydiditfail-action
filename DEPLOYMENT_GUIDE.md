# Deployment Guide

> Complete guide to deploying and releasing the WhyDidItFail action.

## 📋 Pre-Deployment Checklist

Before making the repo public or releasing:

- [ ] Security sweep passes: `./scripts/security-sweep.sh`
- [ ] All tests pass: `npm test`
- [ ] `dist/` is built and committed: `npm run build`
- [ ] README has correct GitHub username
- [ ] Service is deployed and URL is available
- [ ] No secrets or internal URLs in code

## 🚀 Initial Deployment

### 1. Push to GitHub

```bash
cd /Users/yoavnathaniel/Documents/whydiditfail-action

# Add remote (replace with your username)
git remote add origin git@github.com:ynathaniel-source/whydiditfail-action.git

# Push to main
git branch -M main
git push -u origin main
```

### 2. Make Repository Public

1. Go to `Settings` → `General`
2. Scroll to "Danger Zone"
3. Click "Change visibility" → "Make public"
4. Confirm

### 3. Create Initial Release

```bash
# Tag the release
git tag -a v1.0.0 -m "Initial release: AI-powered failure analysis"
git push origin v1.0.0

# Create major version tag (for users to pin to v1)
git tag -a v1 -m "Version 1"
git push origin v1
```

### 4. Create GitHub Release

1. Go to `Releases` → `Create a new release`
2. Choose tag: `v1.0.0`
3. Title: `v1.0.0 - Initial Release`
4. Description:
   ```markdown
   ## 🎉 Initial Release
   
   AI-powered GitHub Actions failure analysis with root cause and fix suggestions.
   
   ### Features
   - 🔍 Automatic log fetching from GitHub API
   - 🤖 AI-powered analysis with GPT-4o-mini
   - 📝 Clear explanations with confidence scores
   - 🔒 Automatic secret redaction
   - 24 failure categories
   
   ### Usage
   
   See [README.md](https://github.com/ynathaniel-source/whydiditfail-action#readme) for setup instructions.
   
   ### Requirements
   
   - Deploy the [service](https://github.com/ynathaniel-source/whydiditfail-service) first
   - Add service URL to GitHub Secrets
   ```
5. Click "Publish release"

## 📦 Publishing to GitHub Marketplace (Optional)

### 1. Add Marketplace Metadata

Already included in `action.yml`:
```yaml
branding:
  icon: "alert-circle"
  color: "red"
```

### 2. Publish to Marketplace

1. Go to your repo on GitHub
2. Click "Draft a release" or edit existing release
3. Check "Publish this Action to the GitHub Marketplace"
4. Choose primary category: "Continuous Integration"
5. Agree to terms
6. Publish

### 3. Marketplace Listing

Your action will be available at:
```
https://github.com/marketplace/actions/whydiditfail
```

Users can install with:
```yaml
uses: ynathaniel-source/whydiditfail-action@v1
```

## 🔄 Releasing Updates

### For Bug Fixes (Patch Version)

```bash
# Make your changes
git add .
git commit -m "Fix: description of fix"

# Build and commit dist/
npm run build
git add dist/
git commit -m "Build dist/ for v1.0.1"

# Tag and push
git tag -a v1.0.1 -m "Bug fix: description"
git push origin v1.0.1

# Update v1 tag to point to latest
git tag -fa v1 -m "Update v1 to v1.0.1"
git push origin v1 --force
```

### For New Features (Minor Version)

```bash
# Make your changes
git add .
git commit -m "Feature: description of feature"

# Build and commit dist/
npm run build
git add dist/
git commit -m "Build dist/ for v1.1.0"

# Tag and push
git tag -a v1.1.0 -m "New feature: description"
git push origin v1.1.0

# Update v1 tag
git tag -fa v1 -m "Update v1 to v1.1.0"
git push origin v1 --force
```

### For Breaking Changes (Major Version)

```bash
# Make your changes
git add .
git commit -m "BREAKING: description of breaking change"

# Build and commit dist/
npm run build
git add dist/
git commit -m "Build dist/ for v2.0.0"

# Tag and push
git tag -a v2.0.0 -m "Breaking change: description"
git push origin v2.0.0

# Create new major version tag
git tag -a v2 -m "Version 2"
git push origin v2

# Keep v1 tag pointing to last v1.x.x release
```

## 🤖 Automated Release (Using GitHub Actions)

The `.github/workflows/release.yml` workflow automatically:
1. Builds `dist/` on release
2. Commits the build
3. Updates the major version tag

To use:
1. Create a release on GitHub (e.g., `v1.0.1`)
2. The workflow runs automatically
3. `dist/` is built and committed
4. `v1` tag is updated

## 🔍 Verifying Deployment

### Test the Action

Create a test workflow in any repo:

```yaml
name: Test WhyDidItFail
on: [push]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Intentional failure
        run: exit 1
      
      - name: Explain failure
        if: failure()
        uses: ynathaniel-source/whydiditfail-action@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          service_url: ${{ secrets.WHYDIDITFAIL_SERVICE_URL }}
```

### Check the Output

1. Go to Actions tab
2. Click on the failed run
3. Check the job summary for the explanation

## 📊 Monitoring

### Track Usage

GitHub provides insights for public actions:
- Go to `Insights` → `Traffic`
- See clones, views, and referrers

### Track Issues

Monitor:
- GitHub Issues for bug reports
- GitHub Discussions for questions
- Dependabot alerts for security

## 🔒 Security Best Practices

### Regular Security Sweeps

Run before each release:
```bash
./scripts/security-sweep.sh
```

### Dependency Updates

```bash
# Check for updates
npm outdated

# Update dependencies
npm update

# Rebuild
npm run build

# Test
npm test
```

### Dependabot

Enable Dependabot in repo settings:
1. Go to `Settings` → `Security & analysis`
2. Enable "Dependabot alerts"
3. Enable "Dependabot security updates"

## 📝 Version Pinning Recommendations

For users:

- **Recommended**: `@v1` - Gets latest v1.x.x automatically
- **Stable**: `@v1.0.0` - Pinned to specific version
- **Latest**: `@main` - Not recommended (unstable)

## 🆘 Troubleshooting

### dist/ is out of date

```bash
npm run build
git add dist/
git commit -m "Update dist/"
git push
```

### Release workflow failed

1. Check workflow logs
2. Ensure GitHub token has write permissions
3. Manually build and commit if needed

### Action not appearing in Marketplace

1. Ensure repo is public
2. Check `action.yml` has required fields
3. Wait a few minutes for indexing
4. Contact GitHub Support if issue persists

## 📚 Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Publishing Actions to Marketplace](https://docs.github.com/en/actions/creating-actions/publishing-actions-in-github-marketplace)
- [Action Versioning](https://github.com/actions/toolkit/blob/master/docs/action-versioning.md)

---

**Last Updated**: 2026-01-03  
**Version**: 1.0.0
