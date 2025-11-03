# Contributing to PANfm

Thank you for your interest in contributing to PANfm! This guide will help you get started with development.

## 📋 Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Branching Strategy](#branching-strategy)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Submitting Changes](#submitting-changes)
- [Release Process](#release-process)

## 🚀 Getting Started

### Prerequisites

- **Docker** and **Docker Compose** (for containerized deployment)
- **Python 3.9+** (for CLI deployment)
- **Git** (for version control)
- **GitHub CLI** (optional, for releases)

### Initial Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/csmblade/panfm.git
   cd panfm
   ```

2. **Checkout the development branch**:
   ```bash
   git checkout test
   git pull origin test
   ```

3. **Create required files** (for Docker):
   ```bash
   chmod +x setup.sh
   ./setup.sh
   ```

4. **Choose your deployment method**:

   **Option A: Docker Deployment**
   ```bash
   docker-compose up -d
   docker-compose logs -f
   ```

   **Option B: CLI Deployment**
   ```bash
   # Create virtual environment
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate

   # Install dependencies
   pip install -r requirements.txt

   # Run application
   python app.py
   ```

5. **Access the dashboard**:
   - Open browser to http://localhost:3000
   - Default credentials: `admin` / `admin` (change on first login)

## 💻 Development Workflow

### Daily Development

All development work happens on the **`test`** branch:

```bash
# Start your day
git checkout test
git pull origin test

# Make your changes
# - Edit code
# - Test locally
# - Verify functionality

# Commit your changes
git add .
git commit -m "Description of changes"
git push origin test
```

### Working on Features

For larger features or experiments, create a feature branch:

```bash
# Create feature branch from test
git checkout test
git pull origin test
git checkout -b feature/my-feature-name

# Work on your feature
# ...

# Merge back to test when done
git checkout test
git pull origin test
git merge feature/my-feature-name
git push origin test

# Delete feature branch
git branch -d feature/my-feature-name
```

## 🌿 Branching Strategy

PANfm uses a **two-branch model**:

```
test (development)
  ↓ (merge when ready for release)
main (production/stable)
  ↓ (tag and create GitHub release)
v1.X.X (release tags)
```

### Branch Purposes

- **`test`** - Active development branch
  - All daily coding happens here
  - May contain work-in-progress features
  - Can use pre-release versions (e.g., `1.6.0-beta`)
  - Must pass tests before merging to `main`

- **`main`** - Production/stable branch
  - Only receives code via merge from `test`
  - Always deployable
  - Only final release versions (no pre-release)
  - All releases are tagged here

### Branch Protection

- **DO NOT** commit directly to `main` - always merge from `test`
- **DO NOT** force push to either branch
- Always work on `test` for development

## 📝 Coding Standards

### Python Code

- **File Size**: Maximum 500 lines per file
- **Line Length**: Maximum 120 characters
- **Style**: Follow PEP 8 guidelines
- **Naming Conventions**:
  - Variables and functions: `snake_case`
  - Classes: `CamelCase`
  - Constants: `UPPER_SNAKE_CASE`

### JavaScript Code

- **File Size**: Maximum 1,000 lines per file
- **Variables**: Use `const` or `let` (never `var`)
- **Async**: Use `async`/`await` for asynchronous operations
- **Comments**: Explain complex logic

### Debug Logging

**CRITICAL**: Every function MUST include debug logging:

```python
from logger import debug, exception

def my_function(param):
    debug("Starting my_function with param: %s", param)
    try:
        # Function logic
        result = process(param)
        debug("my_function completed successfully, result: %s", result)
        return result
    except Exception as e:
        exception("my_function failed: %s", str(e))
        return None
```

### Security Requirements

1. **CSRF Protection**: All POST/PUT/DELETE requests must include CSRF token
   ```javascript
   headers: {
       'Content-Type': 'application/json',
       'X-CSRFToken': document.querySelector('meta[name="csrf-token"]').getAttribute('content')
   }
   ```

2. **Encryption**: All sensitive data must be encrypted at rest
   ```python
   from encryption import encrypt_string, decrypt_string
   encrypted = encrypt_string(sensitive_data)
   ```

3. **Rate Limiting**: Consider rate limits when adding new endpoints

4. **No Hardcoded Credentials**: Use environment variables or encrypted config

### API Guidelines

1. **Concurrency Limit**: NEVER exceed 5 concurrent API calls to firewall
2. **Use Wrappers**: Always use `api_request_get()` and `api_request_post()` from `utils.py`
3. **Error Handling**: Handle exceptions gracefully, return safe defaults
4. **XML Parsing**: Use `xml.etree.ElementTree` for response parsing

### Frontend Standards

1. **Typography**:
   - Headings: **Roboto** font
   - Body text: **Open Sans** font

2. **Device Changes**: Register all new data displays in `refreshAllDataForDevice()` (app.js)

3. **CSRF Tokens**: Include in all mutating fetch requests

## 🧪 Testing Requirements

### Before Every Commit

**MANDATORY**: All changes must pass these tests:

```bash
# 1. Python compilation check
python -m py_compile *.py

# 2. CLI deployment test
./cli-test.sh

# 3. Docker deployment test (if Docker available)
./docker-test.sh

# 4. Git security verification
./verify-gitignore.sh
```

**All tests must pass** before committing.

### Manual Testing

- Test new features in browser
- Verify device switching works with new features
- Check browser console for errors
- Test with both Docker and CLI deployments
- Verify CSRF tokens are sent correctly

## 📤 Submitting Changes

### Commit Message Format

Use descriptive commit messages:

```
Brief description of what changed (50 chars or less)

More detailed explanation if needed. Explain what changed and why,
not how. Keep lines wrapped at 72 characters.

- Bullet points are fine
- List specific changes
- Reference issues if applicable

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Pre-Commit Checklist

Before committing, ensure:

- [ ] All Python files compile: `python -m py_compile *.py`
- [ ] File size limits respected (Python: 500 lines, JS: 1,000 lines)
- [ ] Debug logging added to all new functions
- [ ] CSRF tokens included in all POST/PUT/DELETE requests
- [ ] Tests pass: `./cli-test.sh` and `./docker-test.sh`
- [ ] No sensitive data in commit (keys, credentials, etc.)
- [ ] `.gitignore` verification: `./verify-gitignore.sh`
- [ ] Commit message is descriptive

### Push to Test Branch

```bash
git checkout test
git pull origin test
git add <files>
git commit -m "Descriptive message"
git push origin test
```

## 🚀 Release Process

Only maintainers should perform releases. The process is:

### 1. Prepare for Release

```bash
# Ensure on test branch and tests pass
git checkout test
git pull origin test
./cli-test.sh && ./docker-test.sh
```

### 2. Update Version

Edit `version.py`:
```python
VERSION_MAJOR = 1
VERSION_MINOR = 6
VERSION_PATCH = 0
VERSION_PRERELEASE = None  # Must be None for releases
VERSION_CODENAME = "Feature Name"
VERSION_BUILD = "20251103"  # YYYYMMDD
```

Add changelog entry to `VERSION_HISTORY`.

Update `README.md` version badge.

### 3. Commit Version Update

```bash
git add version.py README.md
git commit -m "Prepare for release v1.X.X"
git push origin test
```

### 4. Merge to Main

```bash
git checkout main
git pull origin main
git merge test
git push origin main
```

### 5. Tag and Create Release

```bash
# Create tag
git tag -a v1.X.X -m "v1.X.X - Codename"
git push origin v1.X.X

# Create GitHub release (if gh CLI installed)
gh release create v1.X.X --title "v1.X.X - Codename" --notes "Release notes..."
```

### 6. Return to Development

```bash
git checkout test
# Continue development on test branch
```

## 🐛 Reporting Issues

When reporting bugs, include:

1. **Version**: Check `/api/version` endpoint or login page
2. **Deployment**: Docker or CLI
3. **Steps to Reproduce**: Detailed steps
4. **Expected Behavior**: What should happen
5. **Actual Behavior**: What actually happens
6. **Logs**: Check `debug.log` (enable debug logging in Settings)
7. **Browser Console**: Any JavaScript errors

## 📚 Additional Resources

- **Architecture Documentation**: `.claude/reference/module-details.md`
- **Branching Details**: `.claude/memory/git-branching.md`
- **Git Workflow**: `.claude/memory/git-workflow.md`
- **Security Guidelines**: `.claude/memory/security.md`
- **Development Standards**: `.claude/memory/development.md`
- **API Guidelines**: `.claude/memory/api-guidelines.md`

## ❓ Questions or Help

- Check existing documentation in `.claude/` folder
- Review `README.md` for deployment help
- Enable debug logging for troubleshooting
- Check GitHub issues for similar problems

## 📄 License

PANfm is released under the MIT License. By contributing, you agree that your contributions will be licensed under the same license.

---

**Thank you for contributing to PANfm!** 🎉
