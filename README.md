# PANfm Community Edition

![Version](https://img.shields.io/badge/Version-1.0.0--ce-brightgreen?style=for-the-badge)
![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=for-the-badge)
![Python](https://img.shields.io/badge/Python-3.9%2B-blue?style=for-the-badge)
![Docker](https://img.shields.io/badge/Docker-Required-2496ED?style=for-the-badge&logo=docker)

**Free & Open-Source Firewall Management for Palo Alto Networks**

Self-hosted web dashboard for real-time monitoring, automated upgrades, and intelligent alerting. Built with Flask, PostgreSQL/TimescaleDB, and Redis.

---

## 🎯 Features (Community Edition - FREE)

✅ Monitor up to **2 firewall devices** (free forever)
✅ Real-time throughput monitoring (1-minute granularity)
✅ Automated PAN-OS upgrade management
✅ Alert system with SMTP/webhook notifications
✅ Connected device tracking with custom metadata
✅ Traffic flow visualization (Sankey diagrams)
✅ Application statistics & threat analysis
✅ Production-grade security (encryption, CSRF, rate limiting)

---

## 🚀 Quick Start (Docker)

### Prerequisites
- Docker & Docker Compose
- Palo Alto Networks firewall with API access

### Installation (2 minutes)

```bash
# 1. Clone repository
git clone https://github.com/csmblade/panfm-community.git
cd panfm-community

# 2. Run setup script (creates required files)
chmod +x setup.sh
./setup.sh

# 3. Start containers
docker compose up -d

# 4. Access dashboard
open http://localhost:3000
```

**Default Login:**
Username: `admin` | Password: `admin` **⚠️ CHANGE IMMEDIATELY**

---

## 🛠️ Configuration

### Add Your First Firewall

1. Log in to dashboard
2. Navigate to **Settings → Devices**
3. Click **Add Device**
4. Enter firewall details:
   - Name: `My Firewall`
   - IP: `192.168.1.1`
   - API Key: _(generate on firewall)_
5. Click **Test Connection** → **Save**

### Generate API Key

On your Palo Alto firewall:

```bash
curl -k "https://FIREWALL-IP/api/?type=keygen&user=USERNAME&password=PASSWORD"
```

---

## 📖 Architecture

PANfm uses a **dual-process architecture** for reliability:

- **panfm** - Web server (Flask/Gunicorn on port 3000)
- **panfm-clock** - Background scheduler (throughput collection, alerts)
- **panfm-timescaledb** - PostgreSQL/TimescaleDB (time-series data)
- **panfm-redis** - Session store (24-hour TTL)

**Data Retention:**
- Throughput history: 30 days
- Alert history: 90 days
- Connected devices: 30 days

---

## 🔒 Security

- ✅ Encryption at rest (Fernet AES-128 + HMAC)
- ✅ CSRF protection (Flask-WTF)
- ✅ Rate limiting (Flask-Limiter)
- ✅ Bcrypt password hashing (cost factor: 12)
- ✅ Secure sessions (Redis with signing)
- ✅ HTTPOnly cookies (XSS prevention)

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Quick Contribution Guide

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

**Contributor License Agreement:** By submitting a PR, you agree to license your contribution under Apache 2.0. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## 📄 License

Licensed under [Apache License 2.0](LICENSE) - use commercially, modify, distribute.

Third-party attributions: see [NOTICE](NOTICE)

---

## 🆘 Support

- **GitHub Issues**: [Report bugs](https://github.com/csmblade/panfm-community/issues)
- **Documentation**: [panfm.io/docs](https://panfm.io/docs)
- **Reddit**: [r/paloaltonetworks](https://reddit.com/r/paloaltonetworks)

---

## 🗺️ Roadmap

- [x] TimescaleDB migration (v2.0.0)
- [x] Community Edition launch (v1.0.0-ce)
- [ ] Mobile-responsive UI (v1.1.0)
- [ ] Dark mode (v1.2.0)
- [ ] Multi-user support
- [ ] Custom dashboards

---

## ⭐ Star This Project

If PANfm helps you manage firewalls, **star the repo**! ⭐

---

## 📞 Contact

- Website: [panfm.io](https://panfm.io)
- Email: support@panfm.io
- GitHub: [csmblade/panfm-community](https://github.com/csmblade/panfm-community)

---

**Made with ❤️ for network engineers**

[Get Started](https://github.com/csmblade/panfm-community) | [Documentation](https://panfm.io/docs)
