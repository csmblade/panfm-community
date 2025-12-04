"""
Backup & Restore Manager for PANfm
Handles comprehensive site-wide backup and restore of Settings, Devices, Metadata, Auth, and Database.
All backups include encryption key and are timestamped.

SECURITY WARNING: Backup files contain the encryption key and all sensitive data.
Store backups securely (encrypted drive, password manager, etc.) and never share
via email or unencrypted cloud storage.

v2.1.1: Added SQL injection protection via psycopg2.sql for safe identifier escaping
v2.1.0: Added auth.json backup and automated pg_dump for TimescaleDB
"""
import os
import json
import shutil
import base64
from datetime import datetime
from config import load_settings, save_settings, SETTINGS_FILE, AUTH_FILE
from device_manager import device_manager
from device_metadata import load_metadata, save_metadata
from logger import debug, info, warning, error, exception

# Whitelist of valid table names for database backup/restore
# This prevents SQL injection via dynamic table names
ALLOWED_TABLES = frozenset([
    'alert_configs',
    'notification_channels',
    'maintenance_windows',
    'scheduled_scans',
    'device_metadata',
    'alert_history',
    'alert_cooldowns',
])


def create_full_backup(include_database=True):
    """
    Create comprehensive backup of Settings, Devices, Metadata, Auth, and optionally TimescaleDB.

    SECURITY WARNING: The backup includes the encryption key, which allows decryption
    of all sensitive data. Backup files must be stored securely (encrypted drive,
    password manager, etc.) and never shared via email or unencrypted cloud storage.

    Args:
        include_database (bool): Whether to include TimescaleDB pg_dump (default: True)

    Returns:
        dict: Backup dictionary with structure:
              {
                  'version': '2.1.0',
                  'timestamp': 'ISO-8601 timestamp',
                  'encryption_key': 'base64-encoded key',  # SENSITIVE
                  'settings': {...},
                  'devices': {...},
                  'metadata': {...},
                  'auth': {...},  # NEW in v2.1.0
                  'database_dump': 'base64-encoded pg_dump'  # NEW in v2.1.0 (optional)
              }
        None: On error
    """
    debug("Creating full site backup")
    try:
        # Load settings
        settings = load_settings()
        debug(f"Loaded settings: {len(settings)} keys")

        # Load devices with decrypted API keys
        devices_list = device_manager.load_devices(decrypt_api_keys=True)
        debug(f"Loaded devices: {len(devices_list)} devices")

        # Load full devices data structure to get groups (but use decrypted devices list)
        with open(device_manager.devices_file, 'r') as f:
            file_data = json.load(f)

        # Build devices_data with decrypted devices + groups from file
        devices_data = {
            'devices': devices_list,  # Use decrypted list
            'groups': file_data.get('groups', [])
        }

        # Load metadata (get all, regardless of format)
        metadata = load_metadata(use_cache=False)
        debug(f"Loaded metadata")

        # Load auth.json (NEW in v2.1.0)
        auth_data = None
        if os.path.exists(AUTH_FILE):
            try:
                with open(AUTH_FILE, 'r') as f:
                    auth_data = json.load(f)
                debug("Loaded auth.json for backup")
            except Exception as e:
                warning(f"Failed to load auth.json: {str(e)}")

        # Load encryption key (CRITICAL for restore to work)
        from encryption import load_key
        encryption_key = load_key()
        encryption_key_b64 = base64.b64encode(encryption_key).decode('utf-8')
        debug("Included encryption key in backup for restore compatibility")

        # Create backup structure
        backup = {
            'version': '2.1.0',
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'encryption_key': encryption_key_b64,  # CRITICAL: Required for restore
            'settings': settings,
            'devices': devices_data,
            'metadata': metadata
        }

        # Add auth if loaded successfully
        if auth_data is not None:
            backup['auth'] = auth_data
            debug("Included auth.json in backup")

        # Add database dump if requested (NEW in v2.1.0)
        if include_database:
            db_dump = export_database_backup()
            if db_dump:
                backup['database_dump'] = db_dump
                debug("Included TimescaleDB dump in backup")
            else:
                warning("TimescaleDB dump not included - database may not be available")

        info("Successfully created full backup")
        return backup
    except Exception as e:
        exception(f"Failed to create backup: {str(e)}")
        return None


def export_database_backup():
    """
    Export TimescaleDB data using psycopg2 COPY commands.
    Exports all tables to a JSON structure that can be restored.

    Returns:
        str: Base64-encoded JSON dump of all tables, or None on failure
    """
    debug("Exporting TimescaleDB database backup")
    try:
        import psycopg2
        import psycopg2.extras
        from io import StringIO

        # Get database connection string from config
        from config import TIMESCALE_DSN

        conn = psycopg2.connect(TIMESCALE_DSN)
        conn.autocommit = True
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Tables to backup - configuration tables (not large hypertables)
        # We backup alert configs, notification channels, etc. but NOT massive
        # time-series data like throughput_samples or connected_devices which
        # could be hundreds of thousands of rows.
        tables_to_backup = [
            # Configuration tables (small, important for restore)
            'alert_configs',
            'notification_channels',
            'maintenance_windows',
            'scheduled_scans',
            # Device metadata (custom names, tags, locations)
            'device_metadata',
            # History tables (only if small)
            'alert_history',
            'alert_cooldowns',
        ]

        db_dump = {
            'format': 'panfm_db_dump_v1',
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'tables': {}
        }

        for table in tables_to_backup:
            try:
                # SECURITY: Validate table name against whitelist to prevent SQL injection
                if table not in ALLOWED_TABLES:
                    warning(f"Table {table} not in allowed tables whitelist, skipping")
                    continue

                # Check if table exists
                cur.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = %s
                    )
                """, (table,))
                if not cur.fetchone()['exists']:
                    debug(f"Table {table} does not exist, skipping")
                    continue

                # Get all rows from table using safe identifier escaping
                from psycopg2 import sql
                cur.execute(sql.SQL("SELECT * FROM {}").format(sql.Identifier(table)))
                rows = cur.fetchall()

                # Convert rows to list of dicts (handle special types)
                table_data = []
                for row in rows:
                    row_dict = {}
                    for key, value in row.items():
                        # Convert datetime objects to ISO strings
                        if hasattr(value, 'isoformat'):
                            row_dict[key] = value.isoformat()
                        # Convert Decimal to float
                        elif hasattr(value, 'is_finite'):
                            row_dict[key] = float(value)
                        else:
                            row_dict[key] = value
                    table_data.append(row_dict)

                db_dump['tables'][table] = table_data
                debug(f"Exported {len(table_data)} rows from {table}")
            except Exception as e:
                warning(f"Failed to export table {table}: {str(e)}")
                continue

        cur.close()
        conn.close()

        # Convert to JSON and base64 encode
        dump_json = json.dumps(db_dump)
        dump_b64 = base64.b64encode(dump_json.encode('utf-8')).decode('utf-8')
        dump_size_mb = len(dump_json) / (1024 * 1024)
        info(f"Database dump created successfully ({dump_size_mb:.2f} MB, {len(db_dump['tables'])} tables)")
        return dump_b64

    except ImportError:
        warning("psycopg2 not available - skipping database backup")
        return None
    except Exception as e:
        exception(f"Failed to export database: {str(e)}")
        return None


def import_database_backup(dump_b64):
    """
    Restore TimescaleDB data from JSON dump via psycopg2.

    Args:
        dump_b64 (str): Base64-encoded JSON dump from export_database_backup()

    Returns:
        bool: True on success, False on failure
    """
    debug("Importing TimescaleDB database backup")
    try:
        import psycopg2
        import psycopg2.extras

        # Decode base64 and parse JSON
        dump_json = base64.b64decode(dump_b64).decode('utf-8')
        db_dump = json.loads(dump_json)

        # Validate format
        if db_dump.get('format') != 'panfm_db_dump_v1':
            error(f"Unknown database dump format: {db_dump.get('format')}")
            return False

        dump_size_mb = len(dump_json) / (1024 * 1024)
        debug(f"Restoring database dump ({dump_size_mb:.2f} MB)")

        # Get database connection string from config
        from config import TIMESCALE_DSN

        conn = psycopg2.connect(TIMESCALE_DSN)
        cur = conn.cursor()

        tables_restored = 0
        rows_restored = 0

        for table_name, table_data in db_dump.get('tables', {}).items():
            if not table_data:
                debug(f"Table {table_name} is empty, skipping")
                continue

            # SECURITY: Validate table name against whitelist to prevent SQL injection
            if table_name not in ALLOWED_TABLES:
                warning(f"Table {table_name} not in allowed tables whitelist, skipping restore")
                continue

            try:
                from psycopg2 import sql

                # Check if table exists
                cur.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables
                        WHERE table_schema = 'public' AND table_name = %s
                    )
                """, (table_name,))
                if not cur.fetchone()[0]:
                    warning(f"Table {table_name} does not exist in database, skipping")
                    continue

                # Get column names from first row and validate them
                columns = list(table_data[0].keys())

                # SECURITY: Validate column names (alphanumeric and underscores only)
                for col in columns:
                    if not col.replace('_', '').isalnum():
                        warning(f"Invalid column name '{col}' in table {table_name}, skipping restore")
                        continue

                # Clear existing data (for full restore) using safe identifier escaping
                cur.execute(sql.SQL("DELETE FROM {}").format(sql.Identifier(table_name)))

                # Insert rows using safe identifier escaping
                for row in table_data:
                    values = []
                    for col in columns:
                        val = row.get(col)
                        # Convert ISO date strings back to datetime for timestamp columns
                        # psycopg2 handles ISO format strings automatically for timestamp columns
                        values.append(val)

                    # Build safe INSERT statement with psycopg2.sql
                    insert_query = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
                        sql.Identifier(table_name),
                        sql.SQL(', ').join(map(sql.Identifier, columns)),
                        sql.SQL(', ').join(sql.Placeholder() * len(columns))
                    )
                    cur.execute(insert_query, values)

                conn.commit()
                tables_restored += 1
                rows_restored += len(table_data)
                debug(f"Restored {len(table_data)} rows to {table_name}")

            except Exception as e:
                conn.rollback()
                warning(f"Failed to restore table {table_name}: {str(e)}")
                continue

        cur.close()
        conn.close()

        info(f"Database restored successfully ({tables_restored} tables, {rows_restored} rows)")
        return True

    except ImportError as e:
        error(f"Required module not available: {str(e)}")
        return False
    except json.JSONDecodeError as e:
        error(f"Invalid JSON in database dump: {str(e)}")
        return False
    except Exception as e:
        exception(f"Failed to import database: {str(e)}")
        return False


def restore_from_backup(backup_data, restore_settings=True, restore_devices=True,
                        restore_metadata=True, restore_auth=True, restore_database=True):
    """
    Restore site configuration from backup.

    Args:
        backup_data (dict): Backup dictionary from create_full_backup()
        restore_settings (bool): Whether to restore settings
        restore_devices (bool): Whether to restore devices
        restore_metadata (bool): Whether to restore metadata
        restore_auth (bool): Whether to restore auth.json (login credentials) - NEW in v2.1.0
        restore_database (bool): Whether to restore TimescaleDB from pg_dump - NEW in v2.1.0

    Returns:
        dict: Result with structure:
              {
                  'success': bool,
                  'restored': ['settings', 'devices', 'metadata', 'auth', 'database'],
                  'errors': ['error messages if any']
              }
    """
    debug(f"Starting restore (settings={restore_settings}, devices={restore_devices}, metadata={restore_metadata}, auth={restore_auth}, database={restore_database})")

    result = {
        'success': True,
        'restored': [],
        'errors': []
    }

    try:
        # Validate backup structure
        if not isinstance(backup_data, dict):
            result['success'] = False
            result['errors'].append("Invalid backup format: not a dictionary")
            return result

        if 'version' not in backup_data or 'timestamp' not in backup_data:
            result['success'] = False
            result['errors'].append("Invalid backup format: missing version or timestamp")
            return result

        debug(f"Restoring from backup version {backup_data.get('version')} created at {backup_data.get('timestamp')}")

        # Restore encryption key ONLY if restoring devices (which have encrypted API keys)
        # NOTE: Metadata and settings in the backup are already DECRYPTED plaintext.
        # They will be re-encrypted with the CURRENT key when saved.
        # This allows restoring just metadata without affecting the current encryption key.
        needs_encryption_key = restore_devices  # Only devices have encrypted API keys

        if needs_encryption_key and 'encryption_key' in backup_data:
            try:
                import base64
                from encryption import KEY_FILE

                # Decode base64 encryption key
                key_bytes = base64.b64decode(backup_data['encryption_key'])

                # Write encryption key to file
                with open(KEY_FILE, 'wb') as f:
                    f.write(key_bytes)

                # Set secure file permissions (600 = owner read/write only)
                import os
                os.chmod(KEY_FILE, 0o600)

                result['restored'].append('encryption_key')
                info("Restored encryption key from backup")
                debug("Encryption key restored and file permissions set to 600")
            except Exception as e:
                result['errors'].append(f"Failed to restore encryption key: {str(e)}")
                exception(f"Encryption key restore failed: {str(e)}")
                # This is critical - if key restore fails, encrypted data cannot be decrypted
                warning("Encryption key restore failed - encrypted data may not be recoverable")
        elif needs_encryption_key and 'encryption_key' not in backup_data:
            # Backwards compatibility: Old backups without encryption_key field
            warning("Backup does not contain encryption_key field (old format)")
            warning("Restore may fail if current encryption.key differs from backup's original key")
        else:
            debug("Skipping encryption key restore - not needed for metadata/settings-only restore")

        # Restore auth.json (NEW in v2.1.0) - restore AFTER encryption key but BEFORE other data
        if restore_auth and 'auth' in backup_data:
            try:
                auth_data = backup_data['auth']
                with open(AUTH_FILE, 'w') as f:
                    json.dump(auth_data, f, indent=2)
                os.chmod(AUTH_FILE, 0o600)
                result['restored'].append('auth')
                info("Successfully restored auth.json (login credentials)")
            except Exception as e:
                result['errors'].append(f"Auth restore error: {str(e)}")
                exception(f"Failed to restore auth.json: {str(e)}")

        # Restore settings
        if restore_settings and 'settings' in backup_data:
            try:
                settings = backup_data['settings']
                if save_settings(settings):
                    result['restored'].append('settings')
                    info("Successfully restored settings")
                else:
                    result['errors'].append("Failed to save settings")
            except Exception as e:
                result['errors'].append(f"Settings restore error: {str(e)}")
                exception(f"Failed to restore settings: {str(e)}")

        # Restore devices
        if restore_devices and 'devices' in backup_data:
            try:
                from device_manager import generate_deterministic_device_id

                devices_data = backup_data['devices']
                # save_devices expects just the list, but we need to restore full structure with groups
                devices_list = devices_data.get('devices', []) if isinstance(devices_data, dict) else devices_data

                # ENTERPRISE FIX (v1.12.0): Regenerate deterministic device_ids from IP addresses
                # This ensures device_ids remain stable across restores and prevents orphaned data
                device_id_mapping = {}  # old_id → new_id for updating references
                for device in devices_list:
                    old_id = device.get('id')
                    ip = device.get('ip')
                    name = device.get('name')

                    if ip:
                        # Generate deterministic device_id from IP
                        new_id = generate_deterministic_device_id(ip, name)

                        if old_id != new_id:
                            debug(f"Regenerating device_id for {name} ({ip}): {old_id} → {new_id}")
                            device['id'] = new_id
                            device_id_mapping[old_id] = new_id
                        else:
                            debug(f"Device {name} ({ip}) already has deterministic ID: {new_id}")
                    else:
                        warning(f"Device {old_id} has no IP address - keeping original ID")

                # Save devices list with corrected device_ids
                if device_manager.save_devices(devices_list):
                    # Also restore groups if present in backup
                    if isinstance(devices_data, dict) and 'groups' in devices_data:
                        with open(device_manager.devices_file, 'r') as f:
                            full_data = json.load(f)
                        full_data['groups'] = devices_data['groups']
                        with open(device_manager.devices_file, 'w') as f:
                            json.dump(full_data, f, indent=2)

                    # After restoring devices, ensure settings has a valid selected_device_id
                    # Update selected_device_id if it was mapped to a new deterministic ID
                    current_settings = load_settings()
                    old_selected_id = current_settings.get('selected_device_id', '')

                    # If the old selected_device_id was changed during restore, update settings
                    if old_selected_id and old_selected_id in device_id_mapping:
                        new_selected_id = device_id_mapping[old_selected_id]
                        current_settings['selected_device_id'] = new_selected_id
                        save_settings(current_settings)
                        info(f"Updated selected_device_id: {old_selected_id} → {new_selected_id}")

                    # If settings were not restored or selected_device_id is empty, select first device
                    elif not current_settings.get('selected_device_id') and devices_list:
                        # Set first device as selected (use new deterministic ID)
                        current_settings['selected_device_id'] = devices_list[0].get('id')
                        save_settings(current_settings)
                        info(f"Auto-selected first device after restore: {devices_list[0].get('name')}")

                    result['restored'].append('devices')
                    info("Successfully restored devices")
                else:
                    result['errors'].append("Failed to save devices")
            except Exception as e:
                result['errors'].append(f"Devices restore error: {str(e)}")
                exception(f"Failed to restore devices: {str(e)}")

        # Restore metadata
        if restore_metadata and 'metadata' in backup_data:
            try:
                metadata = backup_data['metadata']
                metadata_count = len(metadata) if metadata else 0
                debug(f"Restoring metadata: {metadata_count} top-level entries")

                # Log structure for debugging
                if metadata and metadata_count > 0:
                    first_key = list(metadata.keys())[0]
                    first_value = metadata[first_key]
                    debug(f"Metadata format: first_key={first_key[:20]}..., value_type={type(first_value).__name__}")

                if save_metadata(metadata):
                    result['restored'].append('metadata')
                    info(f"Successfully restored metadata ({metadata_count} entries)")
                else:
                    result['errors'].append("Failed to save metadata - save_metadata returned False")
                    error("save_metadata returned False during restore")
            except Exception as e:
                result['errors'].append(f"Metadata restore error: {str(e)}")
                exception(f"Failed to restore metadata: {str(e)}")

        # Restore TimescaleDB database (NEW in v2.1.0)
        if restore_database and 'database_dump' in backup_data:
            try:
                if import_database_backup(backup_data['database_dump']):
                    result['restored'].append('database')
                    info("Successfully restored TimescaleDB database")
                else:
                    result['errors'].append("Failed to restore database")
            except Exception as e:
                result['errors'].append(f"Database restore error: {str(e)}")
                exception(f"Failed to restore database: {str(e)}")

        # Overall success if no errors
        if result['errors']:
            result['success'] = False
            error(f"Restore completed with errors: {result['errors']}")
        else:
            info(f"Restore completed successfully: {result['restored']}")

        return result
    except Exception as e:
        exception(f"Critical error during restore: {str(e)}")
        return {
            'success': False,
            'restored': result['restored'],
            'errors': result['errors'] + [f"Critical error: {str(e)}"]
        }


def export_backup_to_file(backup_data, filename=None):
    """
    Export backup data to JSON file.

    SECURITY WARNING: Backup file contains encryption key and sensitive data.
    The filename includes "SECURE" to indicate this file must be protected.

    Args:
        backup_data (dict): Backup dictionary from create_full_backup()
        filename (str, optional): Custom filename. If None, auto-generates with timestamp.

    Returns:
        str: File path of exported backup, or None on error
    """
    debug("Exporting backup to file")
    try:
        if filename is None:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            # Include "SECURE" in filename to warn users this file is sensitive
            filename = f"panfm_backup_SECURE_{timestamp}.json"

        # Write to file
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(backup_data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())

        info(f"Exported backup to {filename}")
        return filename
    except Exception as e:
        exception(f"Failed to export backup: {str(e)}")
        return None


def import_backup_from_file(filename):
    """
    Import backup data from JSON file.

    Args:
        filename (str): Path to backup file

    Returns:
        dict: Backup data dictionary, or None on error
    """
    debug(f"Importing backup from {filename}")
    try:
        if not os.path.exists(filename):
            error(f"Backup file not found: {filename}")
            return None

        with open(filename, 'r', encoding='utf-8') as f:
            backup_data = json.load(f)

        # Basic validation
        if not isinstance(backup_data, dict):
            error("Invalid backup file: not a valid JSON object")
            return None

        if 'version' not in backup_data:
            warning("Backup file missing version field")

        info(f"Successfully imported backup from {filename}")
        return backup_data
    except json.JSONDecodeError as e:
        error(f"Invalid JSON in backup file: {str(e)}")
        return None
    except Exception as e:
        exception(f"Failed to import backup: {str(e)}")
        return None


def get_backup_info(backup_data):
    """
    Get summary information about a backup.

    Args:
        backup_data (dict): Backup dictionary

    Returns:
        dict: Summary information:
              {
                  'version': str,
                  'timestamp': str,
                  'has_settings': bool,
                  'has_devices': bool,
                  'has_metadata': bool,
                  'has_auth': bool,  # NEW in v2.1.0
                  'has_database_dump': bool,  # NEW in v2.1.0
                  'device_count': int,
                  'metadata_count': int,
                  'database_dump_size_mb': float  # NEW in v2.1.0
              }
    """
    debug("Getting backup information")
    try:
        # Calculate database dump size if present
        db_dump_size_mb = 0.0
        if 'database_dump' in backup_data:
            try:
                db_dump_bytes = len(base64.b64decode(backup_data['database_dump']))
                db_dump_size_mb = db_dump_bytes / (1024 * 1024)
            except Exception:
                pass

        info_dict = {
            'version': backup_data.get('version', 'unknown'),
            'timestamp': backup_data.get('timestamp', 'unknown'),
            'has_settings': 'settings' in backup_data,
            'has_devices': 'devices' in backup_data,
            'has_metadata': 'metadata' in backup_data,
            'has_auth': 'auth' in backup_data,  # NEW in v2.1.0
            'has_database_dump': 'database_dump' in backup_data,  # NEW in v2.1.0
            'device_count': 0,
            'metadata_count': 0,
            'database_dump_size_mb': round(db_dump_size_mb, 2)  # NEW in v2.1.0
        }

        # Count devices
        if 'devices' in backup_data and isinstance(backup_data['devices'], dict):
            devices = backup_data['devices'].get('devices', [])
            info_dict['device_count'] = len(devices) if isinstance(devices, list) else 0

        # Count metadata entries
        if 'metadata' in backup_data and isinstance(backup_data['metadata'], dict):
            metadata = backup_data['metadata']
            # Check if per-device format or global format
            if metadata:
                first_key = list(metadata.keys())[0]
                # Simple heuristic: if value is dict of dicts, it's per-device
                first_value = metadata[first_key]
                if isinstance(first_value, dict) and any(isinstance(v, dict) for v in first_value.values()):
                    # Per-device format
                    total = sum(len(device_meta) for device_meta in metadata.values() if isinstance(device_meta, dict))
                    info_dict['metadata_count'] = total
                else:
                    # Global format
                    info_dict['metadata_count'] = len(metadata)

        return info_dict
    except Exception as e:
        exception(f"Failed to get backup info: {str(e)}")
        return {
            'version': 'unknown',
            'timestamp': 'unknown',
            'has_settings': False,
            'has_devices': False,
            'has_metadata': False,
            'device_count': 0,
            'metadata_count': 0
        }
