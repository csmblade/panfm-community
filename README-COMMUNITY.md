# PANfm Community Edition

![Version](https://img.shields.io/badge/Version-1.0.3-brightgreen?style=for-the-badge)
![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-Ready-blue?style=for-the-badge)

**PAN**alo Alto Networks **F**irewall **M**onitor - Community Edition

A powerful, free, and open-source web dashboard for monitoring Palo Alto Networks firewalls with real-time metrics, automated upgrades, and encrypted multi-device management.

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

### 🐳 Deployment Options
- **Docker Compose**: Production-ready multi-container setup (web, clock, Redis, TimescaleDB)
- **CLI Deployment**: Virtual environment installation for development

## 🆚 Community vs Enterprise

| Feature | Community Edition | Enterprise Edition |
|---------|-------------------|-------------------|
| Real-time monitoring | ✅ | ✅ |
| Multi-device management | ✅ | ✅ |
| PAN-OS upgrades | ✅ | ✅ |
| Network scanning (Nmap) | ✅ | ✅ |
| Throughput collection | ✅ | ✅ |
| Connected devices with metadata | ✅ | ✅ |
| Backup & restore | ✅ | ✅ |
| **Intelligent Alerting** | ❌ | ✅ |
| **SMTP/Webhook Notifications** | ❌ | ✅ |
| **Maintenance Windows** | ❌ | ✅ |
| **Alert Templates** | ❌ | ✅ |
| **High Availability Clustering** | ❌ | ✅ |
| **Multi-Tenant Support** | ❌ | ✅ |
| **Advanced Analytics** | ❌ | ✅ |
| **Commercial Support** | ❌ | ✅ |

**Interested in Enterprise Edition?** Contact us for licensing information.

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
git clone https://github.com/your-org/panfm-community.git
cd panfm-community
```

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env with your firewall details (optional - can configure via web UI)
```

### 3. Start Application
```bash
# Linux/Mac
./restart-docker.sh

# Windows
restart-docker.bat
```

### 4. Access Dashboard
Open browser to: **http://localhost:3000**

**Default credentials**:
- Username: `admin`
- Password: `admin`

**🔐 IMPORTANT**: Change the default password immediately after first login!

## 📖 Detailed Installation

### Docker Deployment (Production)

**Prerequisites**:
- Docker 20.10+
- Docker Compose 2.0+

**Start Application**:
```bash
docker-compose up -d
```

**Check Status**:
```bash
docker ps
# Should show 4 containers: panfm, panfm-clock, panfm-redis, panfm-timescaledb
```

**View Logs**:
```bash
docker-compose logs -f panfm        # Web process logs
docker-compose logs -f panfm-clock  # Background scheduler logs
```

**Stop Application**:
```bash
docker-compose down
```

**Rebuild After Updates**:
```bash
# Linux/Mac
./restart-docker.sh

# Windows
restart-docker.bat
```

### CLI Deployment (Development)

**Prerequisites**:
- Python 3.9+
- PostgreSQL 16 with TimescaleDB extension
- Redis 7+

**Setup Virtual Environment**:
```bash
# Linux/Mac
./setup.sh

# Windows
setup.bat
```

**Configure Database**:
```bash
# Create PostgreSQL database
createdb panfm_db

# Enable TimescaleDB extension
psql -d panfm_db -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"

# Run migrations
psql -d panfm_db -f migrations/004_throughput_schema.sql
psql -d panfm_db -f migrations/005_alerts_schema.sql
psql -d panfm_db -f migrations/006_nmap_scans_schema.sql
psql -d panfm_db -f migrations/007_device_metadata_schema.sql
psql -d panfm_db -f migrations/008_connected_devices_hypertable.sql
psql -d panfm_db -f migrations/009_interface_metrics_hypertable.sql
psql -d panfm_db -f migrations/add_system_info_columns.sql
```

**Start Services**:
```bash
# Terminal 1 - Web process
source venv/bin/activate  # Linux/Mac
venv\Scripts\activate     # Windows
python app.py

# Terminal 2 - Background scheduler
source venv/bin/activate  # Linux/Mac
venv\Scripts\activate     # Windows
python clock.py

# Terminal 3 - Redis (if not running as service)
redis-server
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
1. Navigate to **Device → Setup → Management**
2. Click **API Keys**
3. Enter username/password
4. Click **Generate New API Key**
5. Copy the key (starts with `LUFRPT...`)
6. Use in PANfm device configuration

### Data Retention

Configure retention in **Settings**:
- **Throughput History**: 7 days (default)
- **Scan History**: 30 days (default)
- **Connected Devices**: 30 days (default)

TimescaleDB automatically manages data retention via compression and retention policies.

## 🗂️ Project Structure

```
panfm/
├── app.py                          # Flask web server (port 3000)
├── clock.py                        # Background scheduler (APScheduler)
├── config.py                       # Configuration management
├── version.py                      # Version information
├── auth.py                         # Authentication system
├── encryption.py                   # Fernet encryption utilities
├── device_manager.py               # Multi-device management
├── device_metadata.py              # Device custom names/tags/locations
├── firewall_api_*.py               # Firewall API modules (12 files)
├── routes_*.py                     # Flask route modules (13 files)
├── throughput_*.py                 # Throughput collection and storage
├── scan_*.py                       # Nmap scanning and change detection
├── backup_restore.py               # Backup/restore system
├── templates/                      # HTML templates
│   ├── index.html                  # Main dashboard
│   └── login.html                  # Login page
├── static/                         # JavaScript and assets
│   ├── app.js                      # Core application logic
│   ├── pages-*.js                  # Page-specific JavaScript (11 files)
│   └── services/                   # Data services
├── migrations/                     # SQL database migrations (7 files)
├── Dockerfile                      # Docker image definition
├── docker-compose.yml              # Multi-container setup
└── requirements.txt                # Python dependencies
```

## 🔐 Security Best Practices

### Production Deployment

1. **Change Default Password**: Immediately after first login
2. **Generate Strong SECRET_KEY**: Set in `.env` file
3. **Enable HTTPS**: Use reverse proxy (nginx, Caddy)
4. **Firewall Access**: Restrict dashboard access to trusted networks
5. **API Key Rotation**: Regularly rotate firewall API keys
6. **Backup Encryption Key**: Store `encryption.key` securely (losing it = losing all data!)
7. **File Permissions**: Ensure `encryption.key` and `auth.json` are mode 600

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

## 📊 Database Architecture

PANfm uses **PostgreSQL with TimescaleDB** for optimized time-series storage:

### Hypertables (Time-Series Data)
- `throughput_history` - Per-device throughput samples (1-minute intervals, 7-day chunks)
- `interface_metrics` - Per-interface traffic counters (7-day chunks)
- `connected_devices` - ARP table snapshots (7-day chunks)
- `nmap_scan_history` - Network scan results (7-day chunks)
- `nmap_change_events` - Detected network changes (7-day chunks)

### Regular Tables
- `device_status` - Current device state and uptime
- `scheduled_scans` - Nmap scan schedules
- `scan_queue` - Pending scan operations

### Benefits
- **Automatic Partitioning**: Time-based chunks for efficient queries
- **Compression**: Older data automatically compressed (3:1 ratio)
- **Fast Queries**: Optimized time-range queries (<200ms)
- **Retention Policies**: Automatic data cleanup based on age

## 🛠️ Troubleshooting

### Dashboard Shows No Data

**Check 1 - Background Scheduler Running**:
```bash
docker ps | grep panfm-clock  # Docker
ps aux | grep clock.py        # CLI
```

**Check 2 - Database Connection**:
```bash
docker-compose logs panfm-timescaledb  # Check TimescaleDB logs
```

**Check 3 - Firewall Connectivity**:
- Navigate to **Settings → Device Management**
- Click **Test Connection** on your device
- Verify firewall IP and API key are correct

### Container Won't Start

**Check Logs**:
```bash
docker-compose logs panfm
docker-compose logs panfm-clock
```

**Common Issues**:
- Port 3000 already in use: Change port in `docker-compose.yml`
- PostgreSQL not ready: Wait 30 seconds and retry
- Redis connection failed: Check Redis container is healthy

### High CPU Usage

**Check Collection Interval**:
- Default: 1 minute
- Reduce frequency if needed (Settings → Throughput Collection Interval)

**Check Number of Devices**:
- Each device polled every interval
- Consider staggering collection for many devices

### API Rate Limiting

If you see "Rate limit exceeded" errors:
- Default limits are conservative
- Adjust in `routes_*.py` files (`@limiter.limit()` decorators)
- Or disable rate limiting (not recommended for production)

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Make changes and test thoroughly
4. Run tests: `pytest` (if available)
5. Create pull request with detailed description

### Code Standards

- **Python**: PEP 8, type hints encouraged
- **JavaScript**: ES6+, meaningful variable names
- **File Size**: Python files <500 lines, JavaScript files <1,000 lines
- **Debug Logging**: All functions must include debug logging
- **CSRF Protection**: All mutating endpoints must use CSRF tokens

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

## 🙏 Acknowledgments

- **Palo Alto Networks**: For the excellent firewall API
- **TimescaleDB**: For time-series database optimization
- **Flask**: For the lightweight web framework
- **Chart.js**: For beautiful charts and graphs
- **Redis**: For session management
- **Docker**: For containerization

## 📧 Support

### Community Support
- **GitHub Issues**: Report bugs and request features
- **Discussions**: Ask questions and share ideas
- **Documentation**: Comprehensive guides in [docs/](docs/)

### Enterprise Support
Need professional support, custom development, or enterprise features?

**Contact us** for:
- Commercial licensing
- Priority support
- Custom integrations
- Training and consulting
- High availability setup

## 🗺️ Roadmap

### Planned Features (Community)
- [ ] Dashboard customization (drag-and-drop widgets)
- [ ] Additional export formats (JSON, Excel)
- [ ] Multi-language support
- [ ] Dark mode theme
- [ ] Mobile-responsive UI improvements

### Enterprise-Only Features
- Advanced alerting with SMTP/webhook notifications
- Maintenance windows and alert cooldowns
- High availability clustering
- Multi-tenant support
- Advanced analytics and reporting
- API access for third-party integrations

## 📚 Documentation

- [Installation Guide](docs/installation.md) - Detailed setup instructions
- [User Guide](docs/user-guide.md) - Feature walkthroughs
- [API Reference](docs/api-reference.md) - API endpoint documentation
- [Architecture](docs/architecture.md) - System design overview
- [Troubleshooting](docs/troubleshooting.md) - Common issues and solutions

## 📈 Version History

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

**Current Version**: v1.0.3 "Fast Device Switch" (2025-11-26)

---

**Made with ❤️ for the Palo Alto Networks community**

*PANfm is not affiliated with or endorsed by Palo Alto Networks, Inc. All trademarks are property of their respective owners.*
