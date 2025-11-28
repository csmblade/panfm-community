# PANfm Community Edition

![Hits](https://img.shields.io/endpoint?url=https%3A%2F%2Fhits.dwyl.com%2Fcsmblade%2Fpanfm-community.json&style=for-the-badge&color=brightgreen)
![Version](https://img.shields.io/badge/Version-1.0.16-brightgreen?style=for-the-badge)
![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-Ready-blue?style=for-the-badge)

**PANfm** - Community Edition

A free, and open-source web dashboard for monitoring Palo Alto Networks firewalls with real-time metrics, automated upgrades, and encrypted multi-device management.

## ✨ Features

### 🔍 Real-Time Monitoring
- **System Resources**: CPU (data plane + management), memory, session count
- **Network Throughput**: Per-device and per-interface traffic monitoring
- **Interface Statistics**: Errors, drops, traffic counters with transceiver details
- **Connected Devices**: ARP table with DHCP hostname enrichment and metadata (custom names, tags, locations)
- **Application Traffic**: Top applications by session count with category breakdown

### 🔐 Security & Management
- **Multi-Device Support**: Manage multiple firewalls from one dashboard
- **Encrypted Credentials**: All API keys and passwords encrypted at rest (Fernet AES-128)
- **Authentication**: Bcrypt password hashing with session management
- **CSRF Protection**: All mutating operations protected
- **Rate Limiting**: Prevent API abuse and firewall overload

### 🚀 Automation
- **PAN-OS Upgrades**: 5-step automated upgrade workflow (check → download → install → reboot → verify)
- **Content Updates**: Automated threat signature and application database updates
- **Throughput Collection**: 1-minute interval data collection with PostgreSQL/TimescaleDB storage
- **Network Scanning**: Nmap integration with change detection and scheduling

### 📊 Data Management
- **TimescaleDB Storage**: Optimized time-series database for metrics and logs
- **Automatic Retention**: Configurable data retention policies
- **Backup & Restore**: Full system backup including encryption keys and configurations
- **Export Options**: CSV and XML export for connected devices and scan results

### 📱 Mobile Support
- **Responsive Design**: Fully optimized for iPad and iPhone
- **Touch-Friendly**: Mobile-optimized controls and navigation
- **On-the-Go Monitoring**: Monitor your firewalls from anywhere

### 🐳 Deployment Options
- **Docker Compose**: Production-ready multi-container setup (web, clock, Redis, TimescaleDB)
- **CLI Deployment**: Virtual environment installation for development


## 📋 Requirements

### Hardware
- **CPU**: 2+ cores recommended
- **RAM**: 4GB minimum, 8GB recommended
- **Storage**: 10GB minimum for databases

### Software
- **Docker**: Docker 20.10+ and Docker Compose 2.0+ (recommended)
- **OR Python**: Python 3.9+ with PostgreSQL 16 + TimescaleDB (CLI deployment)

### Firewall
- **Palo Alto Networks**: PAN-OS 9.0+ with API access
- **API Key**: Generated from firewall web interface

## 🚀 Quick Start (Docker - Recommended)

### 1. Clone Repository
```bash
git clone https://github.com/csmblade/panfm-community.git
cd panfm-community
```

### 2. Run Setup Script
```bash
# Linux/Mac
chmod +x setup.sh
./setup.sh

# Windows
setup.bat
```

This creates required configuration files and directories:
- `settings.json` - Application settings
- `devices.json` - Firewall device configurations
- `encryption.key` - Fernet encryption key (keep secure!)
- `auth.json` - User authentication (default: admin/admin)
- `data/`, `redis_data/`, `timescaledb_data/` - Persistent storage

### 3. Start Application
```bash
docker compose up -d
```

First startup takes approximately 60 seconds while:
- TimescaleDB initializes the database
- Schema manager creates all required tables
- Redis session store starts

### 4. Access Dashboard
Open browser to: **http://localhost:3000**

**Default credentials**:
- Username: `admin`
- Password: `admin`

**🔐 IMPORTANT**: Change the default password immediately after first login!

### Verify Installation
```bash
# Check all containers are running
docker compose ps

# Check for any startup errors
docker logs panfm
docker logs panfm-clock
```

## 🔧 Configuration

### Adding Firewalls

1. Navigate to **Settings** page
2. Click **Device Management**
3. Click **Add Device**
4. Enter:
   - **Name**: Descriptive name (e.g., "HQ Firewall")
   - **IP Address**: Firewall management IP
   - **API Key**: Generated from firewall (Device → Setup → Management → API Keys)
   - **Group**: Optional grouping (e.g., "Headquarters", "Branch Offices")
   - **Monitored Interface**: Interface to track throughput (e.g., "ethernet1/1")
5. Click **Test Connection** to verify
6. Click **Save**

### Generating API Keys

On your Palo Alto firewall:

- Follow these instructions - https://docs.paloaltonetworks.com/ngfw/api/api-authentication-and-security/generate-api-key
- Use in PANfm device configuration

### Data Retention

Configure retention in **Settings**:
- **Throughput History**: 7 days (default)
- **Scan History**: 30 days (default)
- **Connected Devices**: 30 days (default)

### Backup & Restore

**Create Backup**:
1. Navigate to **Settings → Databases & Backup**
2. Click **Create Backup**
3. Download generated ZIP file
4. Store securely (contains encryption key!)

**Restore Backup**:
1. Navigate to **Settings → Databases & Backup**
2. Click **Upload Backup**
3. Select backup ZIP file
4. Check items to restore (encryption key, devices, settings, metadata)
5. Click **Restore**


## 📝 License

This project is licensed under the **Apache License 2.0** - see [LICENSE](LICENSE) file for details.

### Apache 2.0 License Summary
- ✅ Commercial use allowed
- ✅ Modification allowed
- ✅ Distribution allowed
- ✅ Private use allowed
- ✅ Patent protection included
- ⚠️ No warranty provided
- ⚠️ No liability accepted
- ⚠️ State changes in modified files


*PANfm is not affiliated with or endorsed by Palo Alto Networks, Inc. All trademarks are property of their respective owners.*
