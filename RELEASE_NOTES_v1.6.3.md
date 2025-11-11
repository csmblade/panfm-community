# Release Notes - v1.6.3 "DHCP Monitoring"

**Release Date:** 2025-11-03
**Type:** Patch Release (New Feature)
**Branch:** main

## 🎯 Overview

Version 1.6.3 adds comprehensive DHCP lease monitoring capabilities to PANfm, allowing administrators to view active DHCP leases directly from the Device Info page. This release also includes documentation updates and project cleanup.

## ✨ New Features

### DHCP Monitoring Tab

A new **DHCP tab** has been added to the Device Info page, positioned logically after the Interfaces tab.

**Key Features:**
- **Active Lease Display**: View all active DHCP leases with comprehensive details
- **Lease Information**: IP address, MAC address, hostname, state, expiration time, interface
- **State Color Coding**:
  - 🟢 **BOUND** (green) - Active lease
  - 🔴 **EXPIRED** (red) - Expired lease
  - 🟡 **OFFERED** (yellow) - Offered lease
- **Summary Statistics**: Total active leases count
- **Empty State Handling**: Friendly message for firewalls without DHCP configured
- **Device Change Integration**: Automatically refreshes when switching between devices

**Technical Details:**
- New backend module: `firewall_api_dhcp.py` (336 lines)
- New API endpoint: `GET /api/dhcp-leases` (rate limit: 600/hour)
- Firewall API command: `<show><dhcp><server><lease></lease></server></dhcp></show>`
- Frontend functions: `loadDhcpLeases()` and `renderDhcpTable()`
- Full XML parsing with graceful error handling

**Tab Order (Device Info page):**
1. Interfaces
2. **DHCP** ← NEW!
3. Software Updates
4. Tech Support
5. Reboot

## 📝 Documentation Updates

### README.md
- Updated version badge from v1.6.0 → v1.6.3
- Added **DHCP lease monitoring** to Features list
- Removed Contributing section (workflow documented elsewhere)
- Added POC experiment note: "This is a POC experiment to see how agentic AI can help bring ideas to life"

### Repository Cleanup
- Removed `CONTRIBUTING.md` file (393 lines)
- Development workflow is documented in internal project files

## 🔧 Technical Implementation

### Backend Changes

**New Module: `firewall_api_dhcp.py`**
- `get_dhcp_servers()` - Fetch DHCP server configuration
- `get_dhcp_leases_detailed()` - Retrieve comprehensive lease data
- `parse_dhcp_entry()` - Parse individual lease entries from XML
- `get_dhcp_summary()` - Generate summary statistics

**Modified: `routes.py`** (+30 lines)
- Added `/api/dhcp-leases` endpoint
- Rate limit: 600 requests/hour (monitoring category)
- Authentication required (`@login_required`)

**Modified: `firewall_api.py`** (+5 lines)
- Exported DHCP functions for use throughout the application

### Frontend Changes

**Modified: `templates/index.html`** (+55 lines)
- Added DHCP tab button (positioned after Interfaces tab)
- Added DHCP tab content area with table structure
- Summary section for total active leases
- Empty state display for no leases/DHCP not configured

**Modified: `static/pages.js`** (+115 lines)
- `loadDhcpLeases()` - Fetch and display DHCP lease data
- `renderDhcpTable(leases)` - Render table with color-coded lease states
- Error handling and loading states

**Modified: `static/app.js`** (+13 lines)
- Added DHCP tab to tab switching logic
- Integrated with `refreshAllDataForDevice()` for device changes
- Ensures DHCP data refreshes when switching devices

**Modified: `version.py`**
- Updated to v1.6.3 "DHCP Monitoring"
- Added comprehensive changelog entry to VERSION_HISTORY

## ✅ Architecture Compliance

- ✅ **Debug Logging**: All functions include comprehensive debug statements
- ✅ **Rate Limiting**: 600/hour (monitoring category, supports auto-refresh)
- ✅ **Error Handling**: Safe defaults (empty array on errors)
- ✅ **Device Change Handling**: Registered in `refreshAllDataForDevice()`
- ✅ **File Size Limits**: New module is 336 lines (under 500-line limit)
- ✅ **Typography Standards**: Uses Roboto (headings) and Open Sans (body)
- ✅ **API Concurrency**: Sequential calls only (1 API call per tab load)
- ✅ **CSRF Protection**: N/A (GET endpoint only)

## 📊 Files Changed

**New Files:**
- `firewall_api_dhcp.py` (336 lines)

**Modified Files:**
- `routes.py` (+30 lines)
- `firewall_api.py` (+5 lines)
- `templates/index.html` (+55 lines)
- `static/pages.js` (+115 lines)
- `static/app.js` (+13 lines)
- `version.py` (+27 lines)
- `README.md` (updated version, removed Contributing section)

**Deleted Files:**
- `CONTRIBUTING.md` (-393 lines)

**Total Changes:** +540 insertions, -409 deletions across 9 files

## 🚀 Upgrade Instructions

### Docker Deployment (Recommended)

```bash
# Pull latest changes
cd panfm
git checkout main
git pull origin main

# Restart container to apply changes
docker compose down
docker compose up -d --build

# View logs
docker compose logs -f
```

### CLI Deployment

```bash
# Pull latest changes
cd panfm
git checkout main
git pull origin main

# Restart the application
# (Use your existing start method - e.g., ./start.sh)
```

## 🔍 Testing the New Feature

1. **Navigate to Device Info page** in PANfm
2. **Click the DHCP tab** (positioned after Interfaces)
3. **View active DHCP leases** with full details:
   - IP addresses
   - MAC addresses
   - Hostnames
   - Lease states (color-coded)
   - Expiration times
   - Interfaces

**Note:** If your firewall does not have DHCP configured, you'll see a friendly empty state message.

## 🐛 Known Issues

None reported for this release.

## 📋 API Compatibility

**Firewall API Command:**
```xml
<show><dhcp><server><lease></lease></server></dhcp></show>
```

**Endpoint:**
- `GET /api/dhcp-leases`
- Rate limit: 600 requests/hour
- Authentication: Required

**Response Format:**
```json
{
  "status": "success",
  "leases": [
    {
      "ip": "192.168.1.100",
      "mac": "aa:bb:cc:dd:ee:ff",
      "hostname": "laptop-finance",
      "state": "BOUND",
      "expiration": "2025-11-03 15:30:00",
      "interface": "ethernet1/1"
    }
  ],
  "total": 1,
  "timestamp": "2025-11-03T..."
}
```

## 🔗 Links

- **Repository:** https://github.com/csmblade/panfm
- **Release Tag:** v1.6.3
- **Previous Release:** v1.6.2 (Bug Fix Release)
- **Documentation:** See README.md for setup instructions

## 👥 Contributors

This release was developed using agentic AI (Claude Code) to bring feature ideas to life quickly and efficiently.

---

**Full Changelog:** [v1.6.2...v1.6.3](https://github.com/csmblade/panfm/compare/v1.6.2...v1.6.3)
