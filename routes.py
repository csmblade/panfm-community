"""
Flask route orchestrator - Registers all route modules
This module imports and coordinates all route sub-modules for clean organization
"""
from logger import debug, info


def register_routes(app, csrf, limiter):
    """
    Register all Flask routes with authentication, CSRF protection, and rate limiting

    This orchestrator function imports and registers route modules in the following categories:
    - Authentication (login, logout, password management)
    - Monitoring (throughput, health, services, database)
    - Devices (device CRUD, metadata, connected devices, vendors, backup/restore)
    - Upgrades (PAN-OS versions, downloads, installs, content updates)
    - Operations (logs, applications, interfaces, licenses, settings, tech support)
    - Alerts (alert configurations, history, notifications)

    Args:
        app: Flask application instance
        csrf: CSRFProtect instance for CSRF token validation
        limiter: Limiter instance for rate limiting
    """
    info("=== Starting route registration ===")

    # Import all route modules (FLATTENED - v1.14.0 Enterprise Reliability)
    # Removed 3-level nesting: routes.py → routes_monitoring.py → routes_throughput.py
    # Now direct 2-level: routes.py → routes_throughput.py
    from routes_auth import register_auth_routes
    from routes_throughput import register_throughput_routes
    from routes_threats import register_threat_routes
    from routes_system import register_system_routes
    from routes_device_management import register_device_management_routes
    from routes_device_metadata import register_device_metadata_routes
    from routes_databases_backup import register_databases_backup_routes
    from routes_upgrades import register_upgrades_routes
    from routes_operations import register_operations_routes
    from routes_alerts import register_alert_routes

    # Register route modules in logical order
    debug("Registering route modules (flattened architecture)...")

    # 1. Authentication routes (must be first - no login required)
    register_auth_routes(app, csrf, limiter)
    debug("✓ Authentication routes registered")

    # 2. Monitoring routes (throughput, threats, health checks, services, database)
    register_throughput_routes(app, csrf, limiter)
    debug("✓ Throughput routes registered")

    register_threat_routes(app, csrf, limiter)
    debug("✓ Threat routes registered (independent)")

    register_system_routes(app, csrf, limiter)
    debug("✓ System routes registered")

    # 3. Operations routes (logs, applications, interfaces, settings, tech support)
    register_operations_routes(app, csrf, limiter)
    debug("✓ Operations routes registered")

    # 4. Device management routes (devices, metadata, vendors, backup/restore)
    register_device_management_routes(app, csrf, limiter)
    debug("✓ Device CRUD routes registered")

    register_device_metadata_routes(app, csrf, limiter)
    debug("✓ Device metadata routes registered")

    register_databases_backup_routes(app, csrf, limiter)
    debug("✓ Database backup routes registered")

    # 5. Upgrade routes (PAN-OS and content updates)
    register_upgrades_routes(app, csrf, limiter)
    debug("✓ Upgrade routes registered")

    # 6. Alert management routes (alert configs, history, notifications)
    register_alert_routes(app, csrf, limiter)
    debug("✓ Alert management routes registered")

    info("=== All routes registered successfully ===")
    info(f"Total endpoints registered: {len([rule for rule in app.url_map.iter_rules()])}")
