#!/usr/bin/env python3
"""
Migration Script: Convert Random Device IDs to Deterministic IDs (v1.12.0)

This script migrates PANfm from random UUID device_ids to deterministic IP-based device_ids.

WHY THIS IS NEEDED:
- Old system: device_id = random UUID (changes on every restore/recreation)
- New system: device_id = deterministic UUID based on IP address
- Impact: Historical data orphaned after restore, Analytics Dashboard breaks

WHAT THIS SCRIPT DOES:
1. Backs up all data files before migration
2. Migrates devices.json (random → deterministic device_ids)
3. Migrates throughput_history.db (6 tables with device_id foreign keys)
4. Migrates settings.json (selected_device_id)
5. Verifies migration success

USAGE:
    python migrate_device_ids.py

SAFETY:
- Creates backup directory: ./migration_backup_YYYYMMDD_HHMMSS/
- Rollback available: restore files from backup directory
- Non-destructive: fails safely if errors occur

REQUIREMENTS:
- Run BEFORE starting Docker/CLI after upgrading to v1.12.0
- Requires: device_manager.py with generate_deterministic_device_id()
"""

import os
import sys
import json
import sqlite3
import shutil
from datetime import datetime

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from device_manager import generate_deterministic_device_id
from config import DEVICES_FILE, ALERTS_DB_FILE
from logger import debug, info, warning, error


class DeviceIDMigration:
    """Handles migration from random to deterministic device IDs"""

    def __init__(self):
        self.backup_dir = None
        self.device_id_mapping = {}  # old_id → new_id
        self.stats = {
            'devices_migrated': 0,
            'database_records_updated': 0,
            'settings_updated': False,
            'errors': []
        }

    def create_backup(self):
        """Create backup directory and copy all data files"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.backup_dir = f"./migration_backup_{timestamp}"

        try:
            os.makedirs(self.backup_dir, exist_ok=True)
            print(f"\n✓ Created backup directory: {self.backup_dir}")

            # Backup files
            files_to_backup = [
                DEVICES_FILE,
                THROUGHPUT_DB_FILE,
                ALERTS_DB_FILE,
                'settings.json',
                'device_metadata.json'
            ]

            for file in files_to_backup:
                if os.path.exists(file):
                    dest = os.path.join(self.backup_dir, os.path.basename(file))
                    shutil.copy2(file, dest)
                    print(f"  ✓ Backed up: {file}")

            print("\n✓ Backup complete - safe to proceed")
            return True

        except Exception as e:
            error(f"Backup failed: {str(e)}")
            print(f"\n✗ ERROR: Backup failed: {str(e)}")
            print("Migration aborted for safety.")
            return False

    def migrate_devices(self):
        """Phase 1: Update devices.json with deterministic device_ids"""
        print("\n" + "="*60)
        print("PHASE 1: Migrating devices.json")
        print("="*60)

        try:
            with open(DEVICES_FILE, 'r') as f:
                data = json.load(f)

            devices = data.get('devices', [])
            if not devices:
                print("  ℹ No devices found - nothing to migrate")
                return True

            print(f"  Found {len(devices)} device(s) to migrate\n")

            for device in devices:
                old_id = device.get('id')
                ip = device.get('ip')
                name = device.get('name')

                if not ip:
                    warning(f"Device {old_id} has no IP address - skipping")
                    continue

                # Generate deterministic ID
                new_id = generate_deterministic_device_id(ip, name)

                if old_id == new_id:
                    print(f"  ✓ {name} ({ip}): Already using deterministic ID")
                    continue

                # Update device_id
                device['id'] = new_id
                self.device_id_mapping[old_id] = new_id
                self.stats['devices_migrated'] += 1

                print(f"  ✓ {name} ({ip}):")
                print(f"      Old ID: {old_id}")
                print(f"      New ID: {new_id}")

            # Save updated devices.json
            with open(DEVICES_FILE, 'w') as f:
                json.dump(data, f, indent=2)

            print(f"\n✓ devices.json updated ({self.stats['devices_migrated']} devices migrated)")
            return True

        except Exception as e:
            error(f"devices.json migration failed: {str(e)}")
            self.stats['errors'].append(f"devices.json: {str(e)}")
            return False

    def migrate_database(self):
        """Phase 2: Update throughput_history.db with new device_ids"""
        print("\n" + "="*60)
        print("PHASE 2: Migrating throughput_history.db")
        print("="*60)

        if not os.path.exists(THROUGHPUT_DB_FILE):
            print("  ℹ throughput_history.db not found - skipping")
            return True

        if not self.device_id_mapping:
            print("  ℹ No device_id changes - skipping database migration")
            return True

        try:
            conn = sqlite3.connect(THROUGHPUT_DB_FILE)
            cursor = conn.cursor()

            # Tables with device_id column
            tables = [
                'throughput_samples',
                'threat_logs',
                'url_filtering_logs',
                'system_logs',
                'traffic_logs',
                'application_statistics'
            ]

            total_updated = 0

            for table in tables:
                # Check if table exists
                cursor.execute(f"SELECT name FROM sqlite_master WHERE type='table' AND name='{table}'")
                if not cursor.fetchone():
                    print(f"  ℹ Table '{table}' not found - skipping")
                    continue

                # Update each old_id → new_id
                for old_id, new_id in self.device_id_mapping.items():
                    cursor.execute(f"UPDATE {table} SET device_id = ? WHERE device_id = ?", (new_id, old_id))
                    rows_updated = cursor.rowcount

                    if rows_updated > 0:
                        total_updated += rows_updated
                        print(f"  ✓ {table}: Updated {rows_updated} rows ({old_id[:8]}... → {new_id[:8]}...)")

            conn.commit()
            conn.close()

            self.stats['database_records_updated'] = total_updated
            print(f"\n✓ Database migration complete ({total_updated} records updated)")
            return True

        except Exception as e:
            error(f"Database migration failed: {str(e)}")
            self.stats['errors'].append(f"Database: {str(e)}")
            return False

    def migrate_settings(self):
        """Phase 3: Update settings.json selected_device_id"""
        print("\n" + "="*60)
        print("PHASE 3: Migrating settings.json")
        print("="*60)

        if not os.path.exists('settings.json'):
            print("  ℹ settings.json not found - skipping")
            return True

        try:
            with open('settings.json', 'r') as f:
                settings = json.load(f)

            old_selected_id = settings.get('selected_device_id', '')

            if not old_selected_id:
                print("  ℹ No device selected in settings - nothing to migrate")
                return True

            if old_selected_id in self.device_id_mapping:
                new_selected_id = self.device_id_mapping[old_selected_id]
                settings['selected_device_id'] = new_selected_id
                self.stats['settings_updated'] = True

                with open('settings.json', 'w') as f:
                    json.dump(settings, f, indent=2)

                print(f"  ✓ Updated selected_device_id:")
                print(f"      Old ID: {old_selected_id}")
                print(f"      New ID: {new_selected_id}")
            else:
                print(f"  ℹ selected_device_id ({old_selected_id[:8]}...) not in migration mapping")
                print("      (Already using deterministic ID or device not found)")

            return True

        except Exception as e:
            error(f"settings.json migration failed: {str(e)}")
            self.stats['errors'].append(f"settings.json: {str(e)}")
            return False

    def verify_migration(self):
        """Verify migration success"""
        print("\n" + "="*60)
        print("VERIFICATION")
        print("="*60)

        try:
            # Verify devices.json
            with open(DEVICES_FILE, 'r') as f:
                data = json.load(f)
                devices = data.get('devices', [])

            print(f"\n✓ devices.json: {len(devices)} device(s)")
            for device in devices:
                ip = device.get('ip')
                device_id = device.get('id')
                expected_id = generate_deterministic_device_id(ip)

                if device_id == expected_id:
                    print(f"  ✓ {device.get('name')} ({ip}): ID is deterministic ✓")
                else:
                    print(f"  ✗ {device.get('name')} ({ip}): ID mismatch!")
                    print(f"      Expected: {expected_id}")
                    print(f"      Got:      {device_id}")
                    return False

            # Verify database
            if os.path.exists(THROUGHPUT_DB_FILE) and self.device_id_mapping:
                conn = sqlite3.connect(THROUGHPUT_DB_FILE)
                cursor = conn.cursor()

                # Check for any old device_ids still in database
                old_ids = list(self.device_id_mapping.keys())
                placeholders = ','.join(['?' for _ in old_ids])

                cursor.execute(f"SELECT COUNT(*) FROM throughput_samples WHERE device_id IN ({placeholders})", old_ids)
                old_id_count = cursor.fetchone()[0]

                if old_id_count > 0:
                    print(f"\n  ✗ Database: Found {old_id_count} records with old device_ids!")
                    conn.close()
                    return False

                print(f"\n✓ Database: No old device_ids found")
                conn.close()

            print("\n✓ Migration verification passed!")
            return True

        except Exception as e:
            error(f"Verification failed: {str(e)}")
            return False

    def print_summary(self):
        """Print migration summary"""
        print("\n" + "="*60)
        print("MIGRATION SUMMARY")
        print("="*60)

        print(f"\n  Devices migrated:     {self.stats['devices_migrated']}")
        print(f"  Database records:     {self.stats['database_records_updated']}")
        print(f"  Settings updated:     {'Yes' if self.stats['settings_updated'] else 'No'}")
        print(f"  Errors:               {len(self.stats['errors'])}")

        if self.stats['errors']:
            print("\n  Errors encountered:")
            for err in self.stats['errors']:
                print(f"    - {err}")

        if self.backup_dir:
            print(f"\n  Backup location:      {self.backup_dir}")
            print("  (Keep this backup until you verify everything works)")

        print("\n" + "="*60)


def main():
    """Main migration entry point"""
    print("\n" + "="*60)
    print("PANfm Device ID Migration Tool (v1.12.0)")
    print("="*60)
    print("\nThis script will migrate your PANfm installation from random")
    print("device IDs to deterministic IP-based device IDs.")
    print("\nBenefits:")
    print("  ✓ Device IDs remain stable across restores")
    print("  ✓ Historical data preserved after restore")
    print("  ✓ No more orphaned throughput data")
    print("  ✓ Analytics Dashboard works reliably")

    # Safety prompt
    print("\n" + "="*60)
    response = input("\nProceed with migration? (yes/no): ").strip().lower()
    if response not in ['yes', 'y']:
        print("\nMigration cancelled.")
        return 1

    # Run migration
    migration = DeviceIDMigration()

    # Step 1: Backup
    if not migration.create_backup():
        return 1

    # Step 2: Migrate devices
    if not migration.migrate_devices():
        print("\n✗ Migration failed at Phase 1 (devices.json)")
        print(f"   Restore from: {migration.backup_dir}")
        return 1

    # Step 3: Migrate database
    if not migration.migrate_database():
        print("\n✗ Migration failed at Phase 2 (database)")
        print(f"   Restore from: {migration.backup_dir}")
        return 1

    # Step 4: Migrate settings
    if not migration.migrate_settings():
        print("\n✗ Migration failed at Phase 3 (settings)")
        print(f"   Restore from: {migration.backup_dir}")
        return 1

    # Step 5: Verify
    if not migration.verify_migration():
        print("\n✗ Verification failed - migration may be incomplete")
        print(f"   Restore from: {migration.backup_dir}")
        return 1

    # Success!
    migration.print_summary()

    print("\n✓ Migration completed successfully!")
    print("\nNext steps:")
    print("  1. Restart Docker: ./restart-docker.sh (or restart-docker.bat)")
    print("  2. Verify Analytics Dashboard loads without errors")
    print("  3. Check that historical data is still visible")
    print(f"  4. Keep backup for 7 days: {migration.backup_dir}")
    print("\nIf anything goes wrong, restore from backup directory.")

    return 0


if __name__ == '__main__':
    sys.exit(main())
