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
✅ Enterprise-grade security (encryption, CSRF, rate limiting)

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

## 📊 Community vs Enterprise Edition

| Feature | Community | Enterprise |
|---------|-----------|------------|
| **Devices** | 2 devices | Unlimited |
| **Real-time Monitoring** | ✅ | ✅ |
| **Automated Upgrades** | ✅ | ✅ |
| **Alert System** | ✅ | ✅ |
| **RBAC (Role-Based Access)** | ❌ | ✅ |
| **SSO (Single Sign-On)** | ❌ | ✅ |
| **Advanced Analytics** | ❌ | ✅ |
| **HA Clustering** | ❌ | ✅ |
| **Custom Alerts** | ❌ | ✅ |
| **Priority Support** | ❌ | ✅ |
| **Price** | **FREE** | From $99/mo |

### 💼 Upgrade to Enterprise

Need more than 2 devices? [View pricing →](https://panfm.io/pricing)

**Tiers:**
- **Professional**: $99/month (up to 50 devices)
- **Enterprise**: $299/month (unlimited devices, SSO, clustering)

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

**Contributor License Agreement:** By submitting a PR, you agree to allow your contribution in both Community and Enterprise editions. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## 📄 License

Licensed under [Apache License 2.0](LICENSE) - use commercially, modify, distribute.

Third-party attributions: see [NOTICE](NOTICE)

---

## 🆘 Support

### Community Support (FREE)
- **GitHub Issues**: [Report bugs](https://github.com/csmblade/panfm-community/issues)
- **Documentation**: [panfm.io/docs](https://panfm.io/docs)
- **Reddit**: [r/paloaltonetworks](https://reddit.com/r/paloaltonetworks)

### Enterprise Support (PAID)
- Priority email support (4-hour SLA)
- Custom feature development
- Migration assistance

[Learn more →](https://panfm.io/enterprise)

---

## 🗺️ Roadmap

**Community Edition:**
- [x] TimescaleDB migration (v2.0.0)
- [x] Dual-licensing model (v1.0.0-ce)
- [ ] Mobile-responsive UI (v1.1.0)
- [ ] Dark mode (v1.2.0)

**Enterprise Edition:**
- [ ] RBAC (Role-Based Access Control)
- [ ] SSO (SAML/OAuth)
- [ ] HA Clustering
- [ ] Compliance reporting

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

[Get Started](https://github.com/csmblade/panfm-community) | [Documentation](https://panfm.io/docs) | [Upgrade](https://panfm.io/pricing)
