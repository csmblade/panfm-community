"""
Configuration constants and settings for the Palo Alto Firewall Dashboard
"""
import os
import json
# Note: Settings are stored as plain JSON (no encryption)
# Only API keys in devices.json are encrypted

# Palo Alto Firewall Configuration (moved to settings)
# These are fallback defaults only - users must configure devices via UI
DEFAULT_FIREWALL_IP = ""
DEFAULT_API_KEY = ""

# File paths
DEBUG_LOG_FILE = os.path.join(os.path.dirname(__file__), 'debug.log')
SETTINGS_FILE = os.path.join(os.path.dirname(__file__), 'settings.json')
DEVICES_FILE = os.path.join(os.path.dirname(__file__), 'devices.json')
VENDOR_DB_FILE = os.path.join(os.path.dirname(__file__), 'mac_vendor_db.json')
SERVICE_PORT_DB_FILE = os.path.join(os.path.dirname(__file__), 'service_port_db.json')
AUTH_FILE = os.path.join(os.path.dirname(__file__), 'auth.json')
METADATA_FILE = os.path.join(os.path.dirname(__file__), 'device_metadata.json')
ALERTS_DB_FILE = os.path.join(os.path.dirname(__file__), 'alerts.db')  # Still uses SQLite
# Note: throughput_history.db removed in v2.0.0 (replaced by TimescaleDB)
LICENSE_FILE = os.path.join(os.path.dirname(__file__), 'data', 'license.json')

# =========================================
# Edition Detection (v1.0.0-ce Community/Enterprise)
# =========================================
# PANfm is available in two editions:
# - Community Edition: Free, open-source (Apache 2.0), 2 devices max
# - Enterprise Edition: Commercial, unlimited devices, advanced features

def detect_edition():
    """
    Detect if running Community or Enterprise Edition

    Returns:
        str: 'community' or 'enterprise'

    Detection logic:
        1. Check for valid Enterprise Edition license file (data/license.json)
        2. Default to Community Edition
    """
    # Check for valid Enterprise Edition license
    if os.path.exists(LICENSE_FILE):
        try:
            # Try to import and validate license
            # This import will fail in Community Edition builds (license_validator.py not included)
            from license_validator import validate_license

            with open(LICENSE_FILE, 'r') as f:
                license_data = json.load(f)

            if validate_license(license_data):
                return 'enterprise'
        except ImportError:
            # Community Edition build - license_validator.py not present
            pass
        except Exception:
            # License file corrupt or validation failed
            pass

    # Default to Community Edition
    return 'community'


def get_license_info():
    """
    Get Enterprise Edition license information if available

    Returns:
        dict or None: License info if valid EE license, None otherwise
    """
    if EDITION != 'enterprise':
        return None

    try:
        from license_validator import get_license_info as _get_license_info
        return _get_license_info()
    except ImportError:
        return None
    except Exception:
        return None


# Detect edition on module load
EDITION = detect_edition()

# Edition-based configuration
if EDITION == 'community':
    # Community Edition limits
    MAX_DEVICES = 2
    ENABLE_RBAC = False
    ENABLE_SSO = False
    ENABLE_ADVANCED_ANALYTICS = False
    ENABLE_CLUSTERING = False
    ENABLE_CUSTOM_ALERTS = False
else:
    # Enterprise Edition - limits from license
    license_info = get_license_info()
    if license_info:
        MAX_DEVICES = license_info.get('max_devices', 9999)
        features = license_info.get('features', {})
        ENABLE_RBAC = features.get('rbac', True)
        ENABLE_SSO = features.get('sso', False)
        ENABLE_ADVANCED_ANALYTICS = features.get('advanced_analytics', True)
        ENABLE_CLUSTERING = features.get('clustering', False)
        ENABLE_CUSTOM_ALERTS = True
    else:
        # Fallback if license info unavailable
        MAX_DEVICES = 9999
        ENABLE_RBAC = True
        ENABLE_SSO = False
        ENABLE_ADVANCED_ANALYTICS = True
        ENABLE_CLUSTERING = False
        ENABLE_CUSTOM_ALERTS = True

# =========================================
# TimescaleDB Configuration (v2.0.0)
# =========================================
# Enterprise-grade time-series database for throughput metrics
# Replaces SQLite with PostgreSQL + TimescaleDB extension

# Connection settings (from environment variables or defaults)
TIMESCALE_HOST = os.getenv('TIMESCALE_HOST', 'localhost')
TIMESCALE_PORT = int(os.getenv('TIMESCALE_PORT', 5432))
TIMESCALE_USER = os.getenv('TIMESCALE_USER', 'panfm')
TIMESCALE_PASSWORD = os.getenv('TIMESCALE_PASSWORD', 'panfm_secure_password')
TIMESCALE_DB = os.getenv('TIMESCALE_DB', 'panfm_db')

# Connection pool settings
TIMESCALE_MIN_CONNECTIONS = int(os.getenv('TIMESCALE_MIN_CONNECTIONS', 2))
TIMESCALE_MAX_CONNECTIONS = int(os.getenv('TIMESCALE_MAX_CONNECTIONS', 10))
TIMESCALE_CONNECTION_TIMEOUT = int(os.getenv('TIMESCALE_CONNECTION_TIMEOUT', 30))

# Build PostgreSQL DSN (connection string)
TIMESCALE_DSN = f"postgresql://{TIMESCALE_USER}:{TIMESCALE_PASSWORD}@{TIMESCALE_HOST}:{TIMESCALE_PORT}/{TIMESCALE_DB}"

# PANfm v2.0.0: TimescaleDB is the only option (SQLite support removed)
# This constant is kept for backwards compatibility but always True
USE_TIMESCALE = True  # Hardcoded - SQLite support removed

# =========================================
# Application Statistics Configuration (Enterprise)
# =========================================
# Centralized configuration for application traffic analysis
# Follows enterprise pattern of configuration constants vs magic numbers

APPLICATION_SETTINGS = {
    'max_logs_default': 1000,           # Default traffic logs to fetch from firewall
    'max_logs_analytics': 5000,         # For detailed analytics and historical queries
    'applications_limit_dashboard': 500, # Maximum apps to display on dashboard
    'applications_time_window_minutes': 60,  # Time window for application statistics (1 hour)
    'reverse_dns_timeout': 2,           # DNS lookup timeout (seconds)
    'service_port_cache_ttl': 3600,     # Service port DB cache TTL (1 hour)
    'retry_max_attempts': 3,            # Max retry attempts for API calls (already in ApiClient)
    'retry_base_delay': 1000,           # Base retry delay in milliseconds
}

# =========================================
# Elasticsearch Configuration (v2.0.0 - Phase 2)
# =========================================
# Log storage and full-text search
# TODO: Add in Phase 2 of migration

ELASTICSEARCH_HOST = os.getenv('ELASTICSEARCH_HOST', 'localhost')
ELASTICSEARCH_PORT = int(os.getenv('ELASTICSEARCH_PORT', 9200))
ELASTICSEARCH_USE_SSL = os.getenv('ELASTICSEARCH_USE_SSL', 'false').lower() in ('true', '1', 'yes')

# Feature flag: Use Elasticsearch vs file-based logs
USE_ELASTICSEARCH = os.getenv('USE_ELASTICSEARCH', 'false').lower() in ('true', '1', 'yes')

# Global caches for vendor and service port databases
_vendor_db_cache = None
_vendor_db_loaded = False
_service_port_db_cache = None
_service_port_db_loaded = False

# Default settings
DEFAULT_SETTINGS = {
    'refresh_interval': 30,  # Dev testing: 30-second interval (Production: use 60)
    'debug_logging': False,
    'selected_device_id': '',
    'monitored_interface': 'ethernet1/12',
    'tony_mode': False,
    'timezone': 'UTC',  # Default timezone for displaying times
    'throughput_retention_days': 90,  # Historical throughput data retention (90 days)
    'throughput_collection_enabled': True,  # Enable/disable background collection
    'alerts_enabled': True,  # Enable/disable alert system (v1.9.0)
    'alert_retention_days': 90  # Alert history retention (90 days)
}

# Lazy import to avoid circular dependency
def _get_logger():
    """Import logger functions lazily to avoid circular import"""
    from logger import debug, error, warning
    return debug, error, warning

def ensure_settings_file_exists():
    """Create settings.json if it doesn't exist"""
    if not os.path.exists(SETTINGS_FILE):
        # Create with default settings
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(DEFAULT_SETTINGS, f, indent=2)

def load_settings():
    """
    Load settings from file or return defaults.
    Settings are stored as plain JSON (no decryption needed).

    Note: This function does NOT use logging to avoid circular dependencies
    since logger.is_debug_enabled() calls load_settings().
    """
    # Ensure file exists before loading
    ensure_settings_file_exists()

    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r') as f:
                settings = json.load(f)
                return settings

        return DEFAULT_SETTINGS.copy()
    except Exception:
        return DEFAULT_SETTINGS.copy()

def save_settings(settings):
    """
    Save settings to file.
    Settings are stored in plain JSON (no encryption needed for non-sensitive data).
    Only API keys in devices.json are encrypted.
    """
    debug, error, _ = _get_logger()
    debug(f"Saving settings to file: {settings}")
    try:
        # Save settings as plain JSON (no encryption)
        # Only API keys need encryption, and those are in devices.json
        with open(SETTINGS_FILE, 'w') as f:
            json.dump(settings, f, indent=2)
            f.flush()
            os.fsync(f.fileno())

        debug("Settings saved successfully")
        return True
    except Exception as e:
        error(f"Failed to save settings: {e}")
        return False


# Note: Settings migration is not needed - settings are stored as plain JSON
# Only API keys (stored in devices.json) need encryption


# ===== Notification Channel Configuration Management =====

def load_notification_channels():
    """
    Load notification channel configurations from settings.json.
    Returns dict with email, slack, and webhook configurations.
    Sensitive fields (passwords, webhook URLs) are decrypted.
    Falls back to empty config if not present in settings.
    """
    debug, error, _ = _get_logger()
    debug("Loading notification channel configurations")

    try:
        settings = load_settings()
        channels = settings.get('alert_notification_channels', {})

        if not channels:
            debug("No notification channels found in settings, returning empty config")
            return get_default_notification_channels()

        # Decrypt sensitive fields
        try:
            from encryption import decrypt_string, is_encrypted

            # Decrypt email SMTP password if encrypted
            if 'email' in channels and channels['email'].get('smtp_password'):
                smtp_pass = channels['email']['smtp_password']
                if is_encrypted(smtp_pass):
                    channels['email']['smtp_password'] = decrypt_string(smtp_pass)

            # Decrypt Slack webhook URL if encrypted
            if 'slack' in channels and channels['slack'].get('webhook_url'):
                webhook = channels['slack']['webhook_url']
                if is_encrypted(webhook):
                    channels['slack']['webhook_url'] = decrypt_string(webhook)

            # Decrypt generic webhook URL if encrypted
            if 'webhook' in channels and channels['webhook'].get('url'):
                url = channels['webhook']['url']
                if is_encrypted(url):
                    channels['webhook']['url'] = decrypt_string(url)

        except ImportError:
            # Encryption module not available (development environment)
            debug("Encryption module not available, returning channels without decryption")
        except Exception as e:
            error(f"Failed to decrypt notification channel secrets: {e}")

        debug(f"Loaded notification channels: {list(channels.keys())}")
        return channels

    except Exception as e:
        error(f"Failed to load notification channels: {e}")
        return get_default_notification_channels()


def save_notification_channels(channels):
    """
    Save notification channel configurations to settings.json.
    Encrypts sensitive fields (passwords, webhook URLs) before saving.

    Args:
        channels: Dict with email, slack, and webhook configurations

    Returns:
        bool: True if saved successfully, False otherwise
    """
    debug, error, _ = _get_logger()
    debug("Saving notification channel configurations")

    try:
        # Load current settings
        settings = load_settings()

        # Encrypt sensitive fields before saving
        encrypted_channels = channels.copy()

        try:
            from encryption import encrypt_string, is_encrypted

            # Deep copy to avoid modifying input
            encrypted_channels = json.loads(json.dumps(channels))

            # Encrypt email SMTP password if present and not already encrypted
            if 'email' in encrypted_channels and encrypted_channels['email'].get('smtp_password'):
                smtp_pass = encrypted_channels['email']['smtp_password']
                if smtp_pass and not is_encrypted(smtp_pass):
                    encrypted_channels['email']['smtp_password'] = encrypt_string(smtp_pass)

            # Encrypt Slack webhook URL if present and not already encrypted
            if 'slack' in encrypted_channels and encrypted_channels['slack'].get('webhook_url'):
                webhook = encrypted_channels['slack']['webhook_url']
                if webhook and not is_encrypted(webhook):
                    encrypted_channels['slack']['webhook_url'] = encrypt_string(webhook)

            # Encrypt generic webhook URL if present and not already encrypted
            if 'webhook' in encrypted_channels and encrypted_channels['webhook'].get('url'):
                url = encrypted_channels['webhook']['url']
                if url and not is_encrypted(url):
                    encrypted_channels['webhook']['url'] = encrypt_string(url)

        except ImportError:
            # Encryption module not available (development environment)
            debug("Encryption module not available, saving channels without encryption")
        except Exception as e:
            error(f"Failed to encrypt notification channel secrets: {e}")
            return False

        # Update settings with encrypted channels
        settings['alert_notification_channels'] = encrypted_channels

        # Save settings
        success = save_settings(settings)

        if success:
            debug("Notification channels saved successfully")
        else:
            error("Failed to save notification channels")

        return success

    except Exception as e:
        error(f"Failed to save notification channels: {e}")
        return False


def get_default_notification_channels():
    """
    Get default (empty) notification channel configuration.

    Returns:
        dict: Default channel configuration structure
    """
    return {
        'email': {
            'enabled': False,
            'smtp_host': '',
            'smtp_port': 587,
            'smtp_user': '',
            'smtp_password': '',
            'from_email': '',
            'to_emails': [],
            'use_tls': True
        },
        'slack': {
            'enabled': False,
            'webhook_url': '',
            'channel': '#alerts',
            'username': 'PANfm Alerts'
        },
        'webhook': {
            'enabled': False,
            'url': '',
            'headers': {}
        }
    }


def load_vendor_database(use_cache=True):
    """
    Load MAC vendor database from file.

    Args:
        use_cache: If True, return cached data if available (default: True)

    Returns:
        dict: MAC prefix to vendor name mapping
    """
    global _vendor_db_cache, _vendor_db_loaded

    debug, error, _ = _get_logger()

    # Return cached data if available and requested
    if use_cache and _vendor_db_loaded:
        debug("Returning cached vendor database")
        return _vendor_db_cache

    debug("Loading MAC vendor database from file")

    if not os.path.exists(VENDOR_DB_FILE):
        debug("Vendor database file does not exist")
        _vendor_db_cache = {}
        _vendor_db_loaded = True
        return {}

    try:
        with open(VENDOR_DB_FILE, 'r', encoding='utf-8') as f:
            vendor_list = json.load(f)

        # Convert list to dictionary for faster lookups
        vendor_dict = {}
        for entry in vendor_list:
            mac_prefix = entry.get('macPrefix', '').upper().replace(':', '')
            vendor_name = entry.get('vendorName', '')
            if mac_prefix and vendor_name:
                vendor_dict[mac_prefix] = vendor_name

        debug(f"Loaded {len(vendor_dict)} MAC vendor entries")

        # Cache the loaded database
        _vendor_db_cache = vendor_dict
        _vendor_db_loaded = True

        return vendor_dict

    except Exception as e:
        error(f"Failed to load vendor database: {e}")
        _vendor_db_cache = {}
        _vendor_db_loaded = True
        return {}


def save_vendor_database(vendor_data):
    """
    Save MAC vendor database to file.
    vendor_data should be a JSON array from the source.
    """
    global _vendor_db_cache, _vendor_db_loaded

    debug, error, _ = _get_logger()
    debug("Saving MAC vendor database")

    try:
        with open(VENDOR_DB_FILE, 'w') as f:
            json.dump(vendor_data, f)
            f.flush()
            os.fsync(f.fileno())

        debug(f"Vendor database saved successfully ({len(vendor_data)} entries)")

        # Reload cache to reflect new data
        load_vendor_database(use_cache=False)
        debug("Cache reloaded after save")

        return True

    except Exception as e:
        error(f"Failed to save vendor database: {e}")
        return False


def get_vendor_db_info():
    """
    Get information about the vendor database file.
    """
    global _vendor_db_loaded, _vendor_db_cache

    debug, _, _ = _get_logger()
    debug("get_vendor_db_info called")

    # Check if database is loaded in memory first
    if _vendor_db_loaded:
        debug("Vendor database loaded in memory, returning cached info")
        entry_count = len(_vendor_db_cache) if _vendor_db_cache else 0

        # Database only "exists" if it has entries (not just an empty file)
        if entry_count == 0:
            debug("Vendor database has zero entries, reporting as not loaded")
            return {
                'exists': False,
                'size': 0,
                'size_mb': 0,
                'modified': 'N/A',
                'entries': 0
            }

        # Get file stats if file exists
        if os.path.exists(VENDOR_DB_FILE):
            file_size = os.path.getsize(VENDOR_DB_FILE)
            file_mtime = os.path.getmtime(VENDOR_DB_FILE)
            from datetime import datetime
            modified_date = datetime.fromtimestamp(file_mtime).strftime('%Y-%m-%d %H:%M:%S')
        else:
            # In memory but file deleted (unusual case)
            file_size = 0
            modified_date = 'Loaded in memory'

        return {
            'exists': True,
            'size': file_size,
            'size_mb': round(file_size / (1024 * 1024), 2) if file_size > 0 else 0,
            'modified': modified_date,
            'entries': entry_count
        }

    # Fall back to checking file existence
    if os.path.exists(VENDOR_DB_FILE):
        file_size = os.path.getsize(VENDOR_DB_FILE)
        file_mtime = os.path.getmtime(VENDOR_DB_FILE)
        from datetime import datetime
        modified_date = datetime.fromtimestamp(file_mtime).strftime('%Y-%m-%d %H:%M:%S')

        # Count entries
        try:
            with open(VENDOR_DB_FILE, 'r', encoding='utf-8') as f:
                vendor_list = json.load(f)
                entry_count = len(vendor_list)
        except:
            entry_count = 0

        # Database only "exists" if it has entries
        if entry_count == 0:
            return {
                'exists': False,
                'size': 0,
                'size_mb': 0,
                'modified': 'N/A',
                'entries': 0
            }

        return {
            'exists': True,
            'size': file_size,
            'size_mb': round(file_size / (1024 * 1024), 2),
            'modified': modified_date,
            'entries': entry_count
        }
    else:
        return {
            'exists': False,
            'size': 0,
            'size_mb': 0,
            'modified': 'N/A',
            'entries': 0
        }


def load_service_port_database(use_cache=True):
    """
    Load service port database from file.

    Args:
        use_cache: If True, return cached data if available (default: True)

    Returns:
        dict: Port numbers to service information mapping
        Format: {port: {'tcp': {'name': 'http', 'description': '...'}, 'udp': {...}}}
    """
    global _service_port_db_cache, _service_port_db_loaded

    debug, error, _ = _get_logger()

    # Return cached data if available and requested
    if use_cache and _service_port_db_loaded:
        debug("Returning cached service port database")
        return _service_port_db_cache

    debug("Loading service port database from file")

    if not os.path.exists(SERVICE_PORT_DB_FILE):
        debug("Service port database file does not exist")
        _service_port_db_cache = {}
        _service_port_db_loaded = True
        return {}

    try:
        with open(SERVICE_PORT_DB_FILE, 'r', encoding='utf-8') as f:
            service_data = json.load(f)

        debug(f"Loaded service port database with {len(service_data)} port entries")

        # Cache the loaded database
        _service_port_db_cache = service_data
        _service_port_db_loaded = True

        return service_data

    except Exception as e:
        error(f"Failed to load service port database: {e}")
        _service_port_db_cache = {}
        _service_port_db_loaded = True
        return {}


def save_service_port_database(service_data):
    """
    Save service port database to file.
    service_data should be a dictionary mapping ports to service info.
    """
    global _service_port_db_cache, _service_port_db_loaded

    debug, error, _ = _get_logger()
    debug("Saving service port database")

    try:
        with open(SERVICE_PORT_DB_FILE, 'w') as f:
            json.dump(service_data, f)
            f.flush()
            os.fsync(f.fileno())

        debug(f"Service port database saved successfully ({len(service_data)} port entries)")

        # Reload cache to reflect new data
        load_service_port_database(use_cache=False)
        debug("Cache reloaded after save")

        return True

    except Exception as e:
        error(f"Failed to save service port database: {e}")
        return False


def get_service_port_db_info():
    """
    Get information about the service port database file.
    """
    global _service_port_db_loaded, _service_port_db_cache

    debug, _, _ = _get_logger()
    debug("get_service_port_db_info called")

    # Check if database is loaded in memory first
    if _service_port_db_loaded:
        debug("Service port database loaded in memory, returning cached info")
        entry_count = len(_service_port_db_cache) if _service_port_db_cache else 0

        # Database only "exists" if it has entries (not just an empty file)
        if entry_count == 0:
            debug("Service port database has zero entries, reporting as not loaded")
            return {
                'exists': False,
                'size': 0,
                'size_mb': 0,
                'modified': 'N/A',
                'entries': 0
            }

        # Get file stats if file exists
        if os.path.exists(SERVICE_PORT_DB_FILE):
            file_size = os.path.getsize(SERVICE_PORT_DB_FILE)
            file_mtime = os.path.getmtime(SERVICE_PORT_DB_FILE)
            from datetime import datetime
            modified_date = datetime.fromtimestamp(file_mtime).strftime('%Y-%m-%d %H:%M:%S')
        else:
            # In memory but file deleted (unusual case)
            file_size = 0
            modified_date = 'Loaded in memory'

        return {
            'exists': True,
            'size': file_size,
            'size_mb': round(file_size / (1024 * 1024), 2) if file_size > 0 else 0,
            'modified': modified_date,
            'entries': entry_count
        }

    # Fall back to checking file existence
    if os.path.exists(SERVICE_PORT_DB_FILE):
        file_size = os.path.getsize(SERVICE_PORT_DB_FILE)
        file_mtime = os.path.getmtime(SERVICE_PORT_DB_FILE)
        from datetime import datetime
        modified_date = datetime.fromtimestamp(file_mtime).strftime('%Y-%m-%d %H:%M:%S')

        # Count entries
        try:
            with open(SERVICE_PORT_DB_FILE, 'r', encoding='utf-8') as f:
                service_data = json.load(f)
                entry_count = len(service_data)
        except:
            entry_count = 0

        # Database only "exists" if it has entries
        if entry_count == 0:
            return {
                'exists': False,
                'size': 0,
                'size_mb': 0,
                'modified': 'N/A',
                'entries': 0
            }

        return {
            'exists': True,
            'size': file_size,
            'size_mb': round(file_size / (1024 * 1024), 2),
            'modified': modified_date,
            'entries': entry_count
        }
    else:
        return {
            'exists': False,
            'size': 0,
            'size_mb': 0,
            'modified': 'N/A',
            'entries': 0
        }
