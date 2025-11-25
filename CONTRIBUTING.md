# Contributing to PANfm Community Edition

Thank you for your interest in contributing to PANfm! We welcome contributions from the community and are grateful for any help you can provide.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Contributor License Agreement (CLA)](#contributor-license-agreement-cla)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Pull Request Process](#pull-request-process)

---

## Code of Conduct

By participating in this project, you agree to:
- Be respectful and inclusive
- Accept constructive criticism gracefully
- Focus on what is best for the community
- Show empathy towards other community members

---

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing [GitHub Issues](https://github.com/csmblade/panfm-community/issues) to avoid duplicates.

**Good bug reports include:**
- Clear, descriptive title
- Steps to reproduce the issue
- Expected vs actual behavior
- PANfm version (`git log -1 --oneline`)
- Docker version (`docker --version`)
- Firewall model and PAN-OS version
- Relevant logs (`docker compose logs`)

### Suggesting Features

Feature requests are welcome! Please:
- Check if the feature already exists in Enterprise Edition
- Explain the use case and why it benefits the community
- Be open to discussion and alternative approaches

### Code Contributions

We welcome code contributions for:
- Bug fixes
- Performance improvements
- Documentation improvements
- New features (discuss first via GitHub Issues)

---

## Contributor License Agreement (CLA)

**IMPORTANT:** By submitting a pull request, you agree to the following terms:

### Grant of Rights

You grant the PANfm project and its maintainers:
1. **Perpetual, worldwide license** to use, modify, and distribute your contribution
2. **Right to include your contribution** in both Community Edition (Apache 2.0) and Enterprise Edition (commercial)
3. **Right to sublicense** your contribution under different terms
4. **Patent grant** for any patents you hold that are necessarily infringed by your contribution

### Your Representations

You represent that:
- You are legally entitled to grant the above license
- Your contribution is your original creation
- Your contribution does not violate any third-party rights
- Your employer (if applicable) has waived all rights to the contribution

### Why This Matters

PANfm uses a **dual-licensing model**:
- **Community Edition** (free, open-source, Apache 2.0)
- **Enterprise Edition** (paid, commercial license)

Your contribution may appear in **both editions**. This CLA allows us to:
- Maintain a sustainable business model
- Fund continued development of both editions
- Ensure legal compliance for commercial use

### Acceptance

By submitting a pull request, you acknowledge that you have read, understood, and agree to this CLA.

---

## Development Workflow

### 1. Fork the Repository

```bash
# Fork on GitHub, then clone your fork
git clone https://github.com/YOUR-USERNAME/panfm-community.git
cd panfm-community
```

### 2. Create a Feature Branch

```bash
# Create branch from main
git checkout -b feature/my-awesome-feature

# Or for bug fixes
git checkout -b fix/issue-123-description
```

**Branch naming convention:**
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Test improvements

### 3. Set Up Development Environment

**Docker (Recommended):**
```bash
./setup.sh
docker compose up -d
docker compose logs -f
```

**CLI (Advanced):**
```bash
python3 -m venv venv
source venv/bin/activate  # Linux/Mac
venv\Scripts\activate     # Windows
pip install -r requirements.txt
```

### 4. Make Your Changes

- Write clean, readable code
- Follow existing code style
- Add debug logging to new functions
- Update documentation if needed

### 5. Test Your Changes

```bash
# Test CLI deployment
./cli-test.sh

# Test Docker deployment
./docker-test.sh

# Both tests MUST pass before submitting PR
```

### 6. Commit Your Changes

```bash
git add .
git commit -m "feat: Add awesome new feature

- Detailed description of changes
- Why this change is needed
- Any breaking changes or migrations required"
```

**Commit message format:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `refactor:` - Code refactoring
- `test:` - Test changes
- `chore:` - Maintenance tasks

### 7. Push and Create Pull Request

```bash
git push origin feature/my-awesome-feature
```

Then create a pull request on GitHub.

---

## Coding Standards

### Python Code

- **PEP 8 compliant** (use `black` formatter)
- **Type hints** encouraged but not required
- **Docstrings** for all functions and classes
- **Debug logging** in all new functions:
  ```python
  from logger import debug, info, error, exception

  def my_function(device_id):
      debug(f"Starting my_function for device {device_id}")
      try:
          # Function logic
          debug(f"Successfully processed {count} items")
          return result
      except Exception as e:
          exception(f"my_function failed: {str(e)}")
          return None
  ```

### JavaScript Code

- **ES6+ syntax** (const/let, arrow functions, async/await)
- **Meaningful variable names** (no single letters except loop counters)
- **CSRF tokens** in all POST/PUT/DELETE requests:
  ```javascript
  headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': getCsrfToken()
  }
  ```
- **Error handling** with try/catch

### File Size Limits

- **Python files**: 500 lines max (exceptions must be justified)
- **JavaScript files**: 1,000 lines max
- If files exceed limits, consider refactoring into modules

### Security Requirements

**CRITICAL - Pull requests will be rejected if these are missing:**

- ✅ **Encrypt sensitive data** (use `encryption.py`)
- ✅ **CSRF protection** on all mutating endpoints
- ✅ **Rate limiting** applied to endpoints
- ✅ **Input validation** on all user inputs
- ✅ **No hardcoded credentials** or API keys
- ✅ **Bcrypt password hashing** (never plain text)

---

## Testing Guidelines

### Pre-Commit Checklist

Before submitting a pull request:

```bash
# 1. Compile all Python files (check for syntax errors)
python -m py_compile *.py

# 2. Check file sizes
wc -l *.py *.js

# 3. Test CLI deployment
./cli-test.sh

# 4. Test Docker deployment
./docker-test.sh

# 5. Verify .gitignore compliance
./verify-gitignore.sh
```

### Manual Testing

- Test in browser (Chrome, Firefox, Safari)
- Test device switching (if applicable)
- Verify CSRF tokens work
- Check for console errors
- Test with 2 firewall devices

### What to Test

- **Functionality**: Does the feature work as expected?
- **Edge cases**: What happens with invalid input?
- **Performance**: Does it handle large datasets?
- **Security**: Are there any vulnerabilities?
- **Compatibility**: Works with Docker AND CLI deployment?

---

## Pull Request Process

### 1. Before Submitting

- ✅ All tests pass (`./cli-test.sh` and `./docker-test.sh`)
- ✅ Code follows style guidelines
- ✅ Debug logging added to new functions
- ✅ Documentation updated (if needed)
- ✅ No sensitive data in commit (check `.gitignore`)

### 2. PR Description

Include:
- **What**: What does this PR change?
- **Why**: Why is this change needed?
- **How**: How did you implement it?
- **Testing**: How did you test it?
- **Screenshots**: (if UI changes)

### 3. Review Process

- Maintainers will review your PR within 7 days
- Address review comments promptly
- Be open to suggestions and improvements
- PRs with failing tests will not be merged

### 4. After Merge

- Delete your feature branch (optional)
- Update your fork:
  ```bash
  git checkout main
  git pull upstream main
  git push origin main
  ```

---

## Questions?

- **GitHub Issues**: [Ask a question](https://github.com/csmblade/panfm-community/issues)
- **Email**: support@panfm.io
- **Documentation**: [panfm.io/docs](https://panfm.io/docs)

---

## License

By contributing to PANfm, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE), and may be included in both Community and Enterprise editions under the terms of the [Contributor License Agreement](#contributor-license-agreement-cla).

---

**Thank you for making PANfm better!** 🎉
