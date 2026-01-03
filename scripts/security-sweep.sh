#!/bin/bash
# Security sweep before making repo public

set -e

echo "🔒 Running security sweep..."
echo ""

ISSUES_FOUND=0

# Check for common secret patterns
echo "1️⃣  Checking for hardcoded secrets..."
SECRETS=$(rg -i "sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}" --type-add 'code:*.{ts,js,json,yml,yaml}' -t code 2>/dev/null || true)
if [ -n "$SECRETS" ]; then
  echo "   ❌ FOUND POTENTIAL SECRETS:"
  echo "$SECRETS"
  ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
  echo "   ✅ No hardcoded secrets found"
fi
echo ""

# Check for localhost/internal URLs
echo "2️⃣  Checking for localhost/internal URLs..."
LOCALHOST=$(rg "localhost|127\.0\.0\.1|0\.0\.0\.0|internal\.|\.local" --type-add 'code:*.{ts,js,json,yml,yaml}' -t code -g '!scripts/security-sweep.sh' 2>/dev/null || true)
if [ -n "$LOCALHOST" ]; then
  echo "   ⚠️  FOUND LOCALHOST/INTERNAL REFERENCES:"
  echo "$LOCALHOST"
  echo "   (These should only be in tests/examples, not defaults)"
  ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
  echo "   ✅ No localhost/internal URLs found"
fi
echo ""

# Check for .env files
echo "3️⃣  Checking for .env files..."
ENV_FILES=$(find . -name ".env*" -not -name ".env.example" 2>/dev/null || true)
if [ -n "$ENV_FILES" ]; then
  echo "   ❌ FOUND .ENV FILES:"
  echo "$ENV_FILES"
  ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
  echo "   ✅ No .env files found"
fi
echo ""

# Check for node_modules
echo "4️⃣  Checking for node_modules..."
if [ -d "node_modules" ]; then
  echo "   ❌ node_modules directory exists (should be in .gitignore)"
  ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
  echo "   ✅ No node_modules directory"
fi
echo ""

# Check that dist/ exists and is committed
echo "5️⃣  Checking dist/ directory..."
if [ ! -d "dist" ]; then
  echo "   ❌ dist/ directory missing (required for GitHub Actions)"
  ISSUES_FOUND=$((ISSUES_FOUND + 1))
elif [ -z "$(ls -A dist)" ]; then
  echo "   ❌ dist/ directory is empty"
  ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
  echo "   ✅ dist/ directory exists and has files"
fi
echo ""

# Check .gitignore
echo "6️⃣  Checking .gitignore..."
if [ ! -f ".gitignore" ]; then
  echo "   ❌ .gitignore missing"
  ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
  if grep -q "node_modules" .gitignore; then
    echo "   ✅ .gitignore includes node_modules"
  else
    echo "   ❌ .gitignore missing node_modules"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
  fi
  
  if grep -q "\.env" .gitignore; then
    echo "   ✅ .gitignore includes .env"
  else
    echo "   ❌ .gitignore missing .env"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
  fi
fi
echo ""

# Check for service/ai directories (should not be in action repo)
echo "7️⃣  Checking for private code..."
if [ -d "service" ] || [ -d "ai" ]; then
  echo "   ❌ FOUND PRIVATE DIRECTORIES (service/ or ai/)"
  ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
  echo "   ✅ No private directories found"
fi
echo ""

# Check action.yml
echo "8️⃣  Checking action.yml..."
if [ ! -f "action.yml" ]; then
  echo "   ❌ action.yml missing"
  ISSUES_FOUND=$((ISSUES_FOUND + 1))
else
  if grep -q "localhost" action.yml; then
    echo "   ⚠️  action.yml contains 'localhost' (should not have default service URL)"
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
  else
    echo "   ✅ action.yml looks good"
  fi
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ISSUES_FOUND -eq 0 ]; then
  echo "✅ Security sweep passed! No issues found."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
else
  echo "❌ Security sweep found $ISSUES_FOUND issue(s)."
  echo "   Please fix these before making the repo public."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
