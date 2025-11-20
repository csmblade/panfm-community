"""
⚠️ DEPRECATED MODULE (v1.14.0 - Enterprise Reliability)

This aggregator module is NO LONGER USED as of v1.14.0.

Route registration has been FLATTENED to eliminate the 3-level nesting pattern
that was causing hidden bugs and difficult troubleshooting:

OLD (3-level): routes.py → routes_devices.py → routes_device_management.py
NEW (2-level): routes.py → routes_device_management.py (DIRECT)

Why this module was deprecated:
- Hidden registration made debugging difficult
- 3-level nesting violated enterprise visibility requirements
- Routes were hard to trace during troubleshooting
- Added unnecessary abstraction layer

Direct imports are now used in routes.py:
- routes_device_management.py (Device CRUD operations)
- routes_device_metadata.py (Connected devices, DHCP, device metadata)
- routes_databases_backup.py (Vendor/service databases, backup/restore)

This file is kept for backward compatibility only and will be removed in v1.15.0.
DO NOT IMPORT THIS MODULE IN NEW CODE.
"""
from logger import debug, warning


def register_devices_routes(app, csrf, limiter):
    """
    ⚠️ DEPRECATED: This function is no longer used.

    Direct registration is now done in routes.py:
    - register_device_management_routes(app, csrf, limiter)
    - register_device_metadata_routes(app, csrf, limiter)
    - register_databases_backup_routes(app, csrf, limiter)

    This function should NOT be called. If you see this warning in logs,
    it means you're using the OLD route registration pattern.
    """
    warning("⚠️ DEPRECATED: register_devices_routes() called - use direct imports instead")

    # Import and register specialized route modules
    from routes_device_management import register_device_management_routes
    from routes_device_metadata import register_device_metadata_routes
    from routes_databases_backup import register_databases_backup_routes

    # Register all route modules (backward compatibility only)
    register_device_management_routes(app, csrf, limiter)
    register_device_metadata_routes(app, csrf, limiter)
    register_databases_backup_routes(app, csrf, limiter)

    warning("Device routes registered via DEPRECATED aggregator (update to direct imports)")
