#!/bin/bash
#
# Community Edition Build Verification Script
# Ensures Enterprise Edition files are properly excluded before pushing to public repo
#

echo "========================================"
echo "PANfm Community Edition Build Verification"
echo "========================================"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0
WARNINGS=0

# Files that MUST be excluded from Community Edition
EE_FILES=(
    "license_validator.py"
    "license_generator.py"
    "generate_rsa_keys.py"
    "keys/license_private.pem"
    "keys/license_public.pem"
    "data/license.json"
)

# Files that MUST be included in Community Edition
CE_FILES=(
    "README.md"
    "CONTRIBUTING.md"
    "LICENSE"
    "NOTICE"
    "config.py"
    "routes_device_management.py"
    "templates/index.html"
    "static/app.js"
)

echo "Step 1: Checking Enterprise Edition file exclusion..."
echo "------------------------------------------------------"

for file in "${EE_FILES[@]}"; do
    if git check-ignore -q "$file"; then
        echo -e "${GREEN}✓${NC} $file is properly gitignored"
    else
        echo -e "${RED}✗${NC} $file is NOT gitignored (CRITICAL)"
        ((ERRORS++))
    fi
done

echo ""
echo "Step 2: Checking Community Edition file inclusion..."
echo "------------------------------------------------------"

for file in "${CE_FILES[@]}"; do
    if [ -f "$file" ]; then
        if git check-ignore -q "$file"; then
            echo -e "${YELLOW}⚠${NC} $file exists but is gitignored (WARNING)"
            ((WARNINGS++))
        else
            echo -e "${GREEN}✓${NC} $file is included in repo"
        fi
    else
        echo -e "${RED}✗${NC} $file is missing (CRITICAL)"
        ((ERRORS++))
    fi
done

echo ""
echo "Step 3: Checking edition detection in config.py..."
echo "------------------------------------------------------"

if grep -q "def detect_edition():" config.py; then
    echo -e "${GREEN}✓${NC} Edition detection function found"

    # Check that grandfathering has been removed
    if grep -q "_check_grandfathered_status" config.py; then
        echo -e "${RED}✗${NC} Grandfathering code still present (should be removed)"
        ((ERRORS++))
    else
        echo -e "${GREEN}✓${NC} Grandfathering code removed"
    fi

    # Check default edition
    if grep -q "return 'community'" config.py; then
        echo -e "${GREEN}✓${NC} Defaults to Community Edition"
    else
        echo -e "${RED}✗${NC} Does not default to Community Edition"
        ((ERRORS++))
    fi
else
    echo -e "${RED}✗${NC} Edition detection function missing"
    ((ERRORS++))
fi

echo ""
echo "Step 4: Checking device limit enforcement..."
echo "------------------------------------------------------"

if grep -q "EDITION == 'community'" routes_device_management.py; then
    echo -e "${GREEN}✓${NC} Community Edition limit check found"

    if grep -q "MAX_DEVICES" routes_device_management.py; then
        echo -e "${GREEN}✓${NC} MAX_DEVICES referenced"
    else
        echo -e "${RED}✗${NC} MAX_DEVICES not referenced"
        ((ERRORS++))
    fi
else
    echo -e "${RED}✗${NC} Community Edition limit check missing"
    ((ERRORS++))
fi

echo ""
echo "Step 5: Checking UI edition badges..."
echo "------------------------------------------------------"

if grep -q "Community Edition" templates/index.html; then
    echo -e "${GREEN}✓${NC} Community Edition badge found in index.html"
else
    echo -e "${RED}✗${NC} Community Edition badge missing from index.html"
    ((ERRORS++))
fi

if grep -q "Community Edition" templates/login.html; then
    echo -e "${GREEN}✓${NC} Community Edition tag found in login.html"
else
    echo -e "${YELLOW}⚠${NC} Community Edition tag missing from login.html (WARNING)"
    ((WARNINGS++))
fi

echo ""
echo "Step 6: Checking upgrade modal..."
echo "------------------------------------------------------"

if grep -q "showUpgradeModal" static/app.js; then
    echo -e "${GREEN}✓${NC} Upgrade modal function found"
else
    echo -e "${RED}✗${NC} Upgrade modal function missing"
    ((ERRORS++))
fi

if grep -q "panfm.io/pricing" static/app.js; then
    echo -e "${GREEN}✓${NC} Pricing URL found in upgrade modal"
else
    echo -e "${YELLOW}⚠${NC} Pricing URL missing from upgrade modal (WARNING)"
    ((WARNINGS++))
fi

echo ""
echo "Step 7: Checking documentation..."
echo "------------------------------------------------------"

# Check README has Community Edition content
if grep -q "Community Edition" README.md 2>/dev/null; then
    echo -e "${GREEN}✓${NC} README.md references Community Edition"
else
    echo -e "${RED}✗${NC} README.md does not reference Community Edition"
    ((ERRORS++))
fi

# Check CONTRIBUTING has CLA
if grep -q "Contributor License Agreement" CONTRIBUTING.md 2>/dev/null; then
    echo -e "${GREEN}✓${NC} CONTRIBUTING.md includes CLA"
else
    echo -e "${RED}✗${NC} CONTRIBUTING.md missing CLA"
    ((ERRORS++))
fi

# Check NOTICE exists
if [ -f "NOTICE" ]; then
    echo -e "${GREEN}✓${NC} NOTICE file exists"
else
    echo -e "${RED}✗${NC} NOTICE file missing"
    ((ERRORS++))
fi

# Check LICENSE exists
if [ -f "LICENSE" ]; then
    echo -e "${GREEN}✓${NC} LICENSE file exists"
else
    echo -e "${RED}✗${NC} LICENSE file missing (CRITICAL)"
    ((ERRORS++))
fi

echo ""
echo "========================================"
echo "Verification Summary"
echo "========================================"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✓ ALL CHECKS PASSED${NC}"
    echo ""
    echo "Community Edition build is ready for deployment!"
    echo "Next steps:"
    echo "  1. Create GitHub repository: panfm-community (public)"
    echo "  2. Push code (git push origin main)"
    echo "  3. Create release tag (git tag -a v1.0.0-ce)"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}⚠ $WARNINGS WARNING(S) FOUND${NC}"
    echo ""
    echo "Non-critical issues detected. Review warnings above."
    exit 0
else
    echo -e "${RED}✗ $ERRORS CRITICAL ERROR(S) FOUND${NC}"
    if [ $WARNINGS -gt 0 ]; then
        echo -e "${YELLOW}⚠ $WARNINGS WARNING(S) FOUND${NC}"
    fi
    echo ""
    echo "CRITICAL: Fix errors above before pushing to public repository!"
    exit 1
fi
