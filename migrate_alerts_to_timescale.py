#!/usr/bin/env python3
"""
Migration Script: alerts.db (SQLite) -> TimescaleDB
Migrates all alert system data from SQLite to PostgreSQL/TimescaleDB
"""
import sqlite3
import psycopg2
import psycopg2.extras
import json
import sys
from pathlib import Path
from datetime import datetime

# Database paths and connection strings
SQLITE_DB = 'alerts.db'
PG_CONN = "dbname=panfm_db user=panfm password=panfm_secure_password host=localhost port=5432"

# Tables to migrate (in dependency order)
TABLES = [
    'notification_channels',
    'alert_configs',
    'alert_history',
    'maintenance_windows',
    'alert_cooldowns'
]

def connect_databases():
    """Connect to both SQLite and PostgreSQL databases"""
    print(f"Connecting to SQLite database: {SQLITE_DB}")
    sqlite_conn = sqlite3.connect(SQLITE_DB)
    sqlite_conn.row_factory = sqlite3.Row

    print(f"Connecting to PostgreSQL database")
    pg_conn = psycopg2.connect(PG_CONN)

    return sqlite_conn, pg_conn

def migrate_notification_channels(sqlite_cur, pg_cur):
    """Migrate notification_channels table"""
    print("\n=== Migrating notification_channels ===")

    # Get data from SQLite
    sqlite_cur.execute("SELECT * FROM notification_channels")
    rows = sqlite_cur.fetchall()
    print(f"Found {len(rows)} notification channels")

    if not rows:
        return 0

    # Insert into PostgreSQL
    insert_sql = """
        INSERT INTO notification_channels
        (id, channel_type, name, config, enabled, created_at, updated_at)
        VALUES (%s, %s, %s, %s::jsonb, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            channel_type = EXCLUDED.channel_type,
            name = EXCLUDED.name,
            config = EXCLUDED.config,
            enabled = EXCLUDED.enabled,
            updated_at = EXCLUDED.updated_at
    """

    migrated = 0
    for row in rows:
        # Parse config_json (was TEXT in SQLite, JSONB in PostgreSQL)
        config_json = row['config_json'] if 'config_json' in dict(row).keys() else row['config']
        if isinstance(config_json, str):
            config = json.loads(config_json) if config_json else {}
        else:
            config = config_json or {}

        pg_cur.execute(insert_sql, (
            row['id'],
            row['channel_type'],
            row['name'],
            json.dumps(config),  # Convert to JSON string for PostgreSQL
            row['enabled'],
            row['created_at'],
            row['updated_at']
        ))
        migrated += 1

    print(f"OK Migrated {migrated} notification channels")
    return migrated

def migrate_alert_configs(sqlite_cur, pg_cur):
    """Migrate alert_configs table"""
    print("\n=== Migrating alert_configs ===")

    # Get data from SQLite
    sqlite_cur.execute("SELECT * FROM alert_configs")
    rows = sqlite_cur.fetchall()
    print(f"Found {len(rows)} alert configurations")

    if not rows:
        return 0

    # Insert into PostgreSQL
    insert_sql = """
        INSERT INTO alert_configs
        (id, device_id, metric_type, threshold_value, threshold_operator, severity,
         enabled, notification_channels, created_at, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            device_id = EXCLUDED.device_id,
            metric_type = EXCLUDED.metric_type,
            threshold_value = EXCLUDED.threshold_value,
            threshold_operator = EXCLUDED.threshold_operator,
            severity = EXCLUDED.severity,
            enabled = EXCLUDED.enabled,
            notification_channels = EXCLUDED.notification_channels,
            updated_at = EXCLUDED.updated_at
    """

    migrated = 0
    for row in rows:
        # Parse notification_channels (was TEXT in SQLite, JSONB in PostgreSQL)
        notif_channels = row['notification_channels']
        if isinstance(notif_channels, str):
            channels = json.loads(notif_channels) if notif_channels else []
        else:
            channels = notif_channels or []

        pg_cur.execute(insert_sql, (
            row['id'],
            row['device_id'],
            row['metric_type'],
            row['threshold_value'],
            row['threshold_operator'],
            row['severity'],
            row['enabled'],
            json.dumps(channels),  # Convert to JSON string for PostgreSQL
            row['created_at'],
            row['updated_at']
        ))
        migrated += 1

    print(f"OK Migrated {migrated} alert configurations")
    return migrated

def migrate_alert_history(sqlite_cur, pg_cur):
    """Migrate alert_history table (hypertable)"""
    print("\n=== Migrating alert_history ===")

    # Get data from SQLite
    sqlite_cur.execute("SELECT * FROM alert_history ORDER BY triggered_at")
    rows = sqlite_cur.fetchall()
    print(f"Found {len(rows)} alert history records")

    if not rows:
        return 0

    # Insert into PostgreSQL (hypertable - time is partition key)
    insert_sql = """
        INSERT INTO alert_history
        (time, alert_config_id, device_id, metric_type, threshold_value, actual_value,
         severity, message, triggered_at, acknowledged_at, acknowledged_by,
         resolved_at, resolved_reason)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id, time) DO NOTHING
    """

    migrated = 0
    skipped = 0
    for row in rows:
        # Use triggered_at as the time column (partition key)
        time_val = row['triggered_at']

        try:
        pg_cur.execute(insert_sql, (
            migrated += 1
        except psycopg2.IntegrityError as e:
            # Skip orphaned record (FK constraint violation)
            skipped += 1
            time_val,  # time column for hypertable
            row['alert_config_id'],
            row['device_id'],
            row['metric_type'],
            row['threshold_value'],
            row['actual_value'],
            row['severity'],
            row['message'],
            row['triggered_at'],
            (row['acknowledged_at'] if 'acknowledged_at' in row.keys() else None),
            (row['acknowledged_by'] if 'acknowledged_by' in row.keys() else None),
            (row['resolved_at'] if 'resolved_at' in row.keys() else None),
            (row['resolved_reason'] if 'resolved_reason' in row.keys() else None)
        ))
        migrated += 1

    print(f"OK Migrated {migrated} alert history records ({skipped} skipped due to missing FK)")
    return migrated

def migrate_maintenance_windows(sqlite_cur, pg_cur):
    """Migrate maintenance_windows table"""
    print("\n=== Migrating maintenance_windows ===")

    # Get data from SQLite
    sqlite_cur.execute("SELECT * FROM maintenance_windows")
    rows = sqlite_cur.fetchall()
    print(f"Found {len(rows)} maintenance windows")

    if not rows:
        return 0

    # Insert into PostgreSQL
    insert_sql = """
        INSERT INTO maintenance_windows
        (id, device_id, name, description, start_time, end_time, enabled, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            device_id = EXCLUDED.device_id,
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            enabled = EXCLUDED.enabled
    """

    migrated = 0
    for row in rows:
        pg_cur.execute(insert_sql, (
            row['id'],
            (row['device_id'] if 'device_id' in row.keys() else None),  # Can be NULL
            row['name'],
            (row['description'] if 'description' in row.keys() else None),
            row['start_time'],
            row['end_time'],
            row['enabled'],
            row['created_at']
        ))
        migrated += 1

    print(f"OK Migrated {migrated} maintenance windows")
    return migrated

def migrate_alert_cooldowns(sqlite_cur, pg_cur):
    """Migrate alert_cooldowns table"""
    print("\n=== Migrating alert_cooldowns ===")

    # Get data from SQLite
    sqlite_cur.execute("SELECT * FROM alert_cooldowns")
    rows = sqlite_cur.fetchall()
    print(f"Found {len(rows)} alert cooldowns")

    if not rows:
        return 0

    # Insert into PostgreSQL
    insert_sql = """
        INSERT INTO alert_cooldowns
        (id, device_id, alert_config_id, last_triggered_at, cooldown_expires_at, created_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        ON CONFLICT (device_id, alert_config_id) DO UPDATE SET
            last_triggered_at = EXCLUDED.last_triggered_at,
            cooldown_expires_at = EXCLUDED.cooldown_expires_at
    """

    migrated = 0
    for row in rows:
        pg_cur.execute(insert_sql, (
            row['id'],
            row['device_id'],
            row['alert_config_id'],
            row['last_triggered_at'],
            row['cooldown_expires_at'],
            row['created_at']
        ))
        migrated += 1

    print(f"OK Migrated {migrated} alert cooldowns")
    return migrated

def main():
    """Main migration workflow"""
    print("=" * 70)
    print("ALERT SYSTEM MIGRATION: SQLite -> TimescaleDB")
    print("=" * 70)

    # Check if SQLite database exists
    if not Path(SQLITE_DB).exists():
        print(f"\nERROR ERROR: SQLite database not found: {SQLITE_DB}")
        print("Nothing to migrate.")
        return 0

    try:
        # Connect to databases
        sqlite_conn, pg_conn = connect_databases()
        sqlite_cur = sqlite_conn.cursor()
        pg_cur = pg_conn.cursor()

        # Track migration statistics
        stats = {}

        # Migrate each table in order
        stats['notification_channels'] = migrate_notification_channels(sqlite_cur, pg_cur)
        pg_conn.commit()

        stats['alert_configs'] = migrate_alert_configs(sqlite_cur, pg_cur)
        pg_conn.commit()

        stats['alert_history'] = migrate_alert_history(sqlite_cur, pg_cur)
        pg_conn.commit()

        stats['maintenance_windows'] = migrate_maintenance_windows(sqlite_cur, pg_cur)
        pg_conn.commit()

        stats['alert_cooldowns'] = migrate_alert_cooldowns(sqlite_cur, pg_cur)
        pg_conn.commit()

        # Print summary
        print("\n" + "=" * 70)
        print("MIGRATION COMPLETE")
        print("=" * 70)
        print(f"\nMigration Summary:")
        print(f"  Notification Channels: {stats['notification_channels']}")
        print(f"  Alert Configurations:  {stats['alert_configs']}")
        print(f"  Alert History:         {stats['alert_history']}")
        print(f"  Maintenance Windows:   {stats['maintenance_windows']}")
        print(f"  Alert Cooldowns:       {stats['alert_cooldowns']}")
        print(f"\nTotal Records Migrated: {sum(stats.values())}")

        print("\nOK All alert data successfully migrated to TimescaleDB")
        print("\nNext steps:")
        print("  1. Verify data in PostgreSQL")
        print("  2. Test alert_manager.py with PostgreSQL")
        print("  3. Backup and remove alerts.db")

        # Close connections
        sqlite_cur.close()
        sqlite_conn.close()
        pg_cur.close()
        pg_conn.close()

        return 0

    except sqlite3.Error as e:
        print(f"\nERROR SQLite Error: {e}")
        return 1
    except psycopg2.Error as e:
        print(f"\nERROR PostgreSQL Error: {e}")
        if pg_conn:
            pg_conn.rollback()
        return 1
    except Exception as e:
        print(f"\nERROR Unexpected Error: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
