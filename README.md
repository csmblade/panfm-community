# PANfm Core Development (PRIVATE)

**⚠️ CONFIDENTIAL - DO NOT DISTRIBUTE ⚠️**

This is the private development repository for PANfm containing the complete codebase.

## Repository Purpose

This repository contains:
- ✅ Community Edition features
- ✅ Enterprise Edition features
- ✅ Internal development tools
- ✅ License generation tools
- ✅ Private encryption keys
- ✅ All experimental features

## Repository Structure

```
📁 panfm-core (PRIVATE)
├── Community Edition code (syncs to public repo)
├── Enterprise Edition code (license validation, RBAC, SSO)
├── Internal tools (license generator, deployment scripts)
└── Development documentation
```

## Development Workflow

### Daily Development
Work on this repository (`core-development` branch)

### Syncing to Community Edition
```bash
# Push Community Edition updates (respects .gitignore)
./sync-to-community.bat
```

### Syncing to Enterprise Edition
```bash
# Push Enterprise Edition updates (includes all features)
git push enterprise core-development
```

## Branch Strategy

- **core-development** - Active development branch (use this)
- **main** - Stable releases

## Related Repositories

- **panfm-community** (PUBLIC) - Community Edition for public users
- **panfm-enterprise** (PRIVATE) - Enterprise Edition for customer deployments

## License

**Proprietary - All Rights Reserved**

This software is proprietary and confidential. See LICENSE file for details.

---

**For internal use only - PANfm Development Team**
