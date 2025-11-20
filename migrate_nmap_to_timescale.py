#!/usr/bin/env python3
"""
Migration Script: nmap_scans.db (SQLite) -> TimescaleDB
Migrates all nmap scanning data from SQLite to PostgreSQL/TimescaleDB
"""
import sqlite3
import psycopg2
import psycopg2.extras
import json
import sys
from pathlib import Path
from datetime import datetime

# Database paths and connection strings
SQLITE_DB = 'nmap_scans.db'
PG_CONN = "dbname=panfm_db user=panfm password=panfm_secure_password host=localhost port=5432"

# Tables to migrate (in dependency order)
TABLES = [
    'scheduled_scans',
    'nmap_scan_history',
    'nmap_port_history',
    'nmap_change_events',
    'scan_queue'
]

def connect_databases():
    """Connect to both SQLite and PostgreSQL databases"""
    print(f"Connecting to SQLite database: {SQLITE_DB}")
    sqlite_conn = sqlite3.connect(SQLITE_DB)
    sqlite_conn.row_factory = sqlite3.Row

    print(f"Connecting to PostgreSQL database")
    pg_conn = psycopg2.connect(PG_CONN)

    return sqlite_conn, pg_conn

def migrate_scheduled_scans(sqlite_cur, pg_cur):
    """Migrate scheduled_scans table"""
    print("\n=== Migrating scheduled_scans ===")

    # Get data from SQLite
    sqlite_cur.execute("SELECT * FROM scheduled_scans")
    rows = sqlite_cur.fetchall()
    print(f"Found {len(rows)} scheduled scans")

    if not rows:
        return 0

    # Insert into PostgreSQL
    insert_sql = """
        INSERT INTO scheduled_scans
        (id, device_id, name, description, target_type, target_value, scan_type,
         schedule_type, schedule_value, enabled, last_run_timestamp, last_run_status,
         last_run_error, next_run_timestamp, created_at, created_by, updated_at, updated_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            description = EXCLUDED.description,
            target_type = EXCLUDED.target_type,
            target_value = EXCLUDED.target_value,
            scan_type = EXCLUDED.scan_type,
            schedule_type = EXCLUDED.schedule_type,
            schedule_value = EXCLUDED.schedule_value,
            enabled = EXCLUDED.enabled,
            last_run_timestamp = EXCLUDED.last_run_timestamp,
            last_run_status = EXCLUDED.last_run_status,
            last_run_error = EXCLUDED.last_run_error,
            next_run_timestamp = EXCLUDED.next_run_timestamp,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by
    """

    migrated = 0
    for row in rows:
        # Parse schedule_value (was TEXT in SQLite, JSONB in PostgreSQL)
        schedule_val = row['schedule_value']
        if isinstance(schedule_val, str):
            schedule_json = json.loads(schedule_val) if schedule_val else {}
        else:
            schedule_json = schedule_val or {}

        pg_cur.execute(insert_sql, (
            row['id'],
            row['device_id'],
            row['name'],
            (row['description'] if 'description' in row.keys() else None),
            row['target_type'],
            (row['target_value'] if 'target_value' in row.keys() else None),
            row.get('scan_type', 'balanced'),
            row['schedule_type'],
            json.dumps(schedule_json),  # Convert to JSON string for PostgreSQL
            row['enabled'],
            (row['last_run_timestamp'] if 'last_run_timestamp' in row.keys() else None),
            (row['last_run_status'] if 'last_run_status' in row.keys() else None),
            (row['last_run_error'] if 'last_run_error' in row.keys() else None),
            (row['next_run_timestamp'] if 'next_run_timestamp' in row.keys() else None),
            row['created_at'],
            (row['created_by'] if 'created_by' in row.keys() else None),
            (row['updated_at'] if 'updated_at' in row.keys() else None),
            (row['updated_by'] if 'updated_by' in row.keys() else None)
        ))
        migrated += 1

    print(f"OK Migrated {migrated} scheduled scans")
    return migrated

def migrate_nmap_scan_history(sqlite_cur, pg_cur):
    """Migrate nmap_scan_history table (hypertable)"""
    print("\n=== Migrating nmap_scan_history ===")

    # Get data from SQLite
    sqlite_cur.execute("SELECT * FROM nmap_scan_history ORDER BY scan_timestamp")
    rows = sqlite_cur.fetchall()
    print(f"Found {len(rows)} nmap scan records")

    if not rows:
        return 0

    # Insert into PostgreSQL (hypertable - time is partition key)
    insert_sql = """
        INSERT INTO nmap_scan_history
        (time, device_id, target_ip, scan_type, scan_timestamp, scan_duration_seconds,
         hostname, host_status, os_name, os_accuracy, os_matches, total_ports,
         open_ports_count, scan_results, raw_xml)
        VALUES (%s, %s, %s::inet, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s::jsonb, %s)
        ON CONFLICT (id, time) DO NOTHING
    """

    migrated = 0
    skipped = 0
    for row in rows:
        # Use scan_timestamp as the time column (partition key)
        time_val = row['scan_timestamp']

        # Parse JSON fields (were TEXT in SQLite, JSONB in PostgreSQL)
        os_matches = (row['os_matches_json'] if 'os_matches_json' in row.keys() else None) or (row['os_matches'] if 'os_matches' in row.keys() else None)
        if isinstance(os_matches, str):
            os_matches_json = json.loads(os_matches) if os_matches else None
        else:
            os_matches_json = os_matches

        scan_results = (row['scan_results_json'] if 'scan_results_json' in row.keys() else None) or (row['scan_results'] if 'scan_results' in row.keys() else None)
        if isinstance(scan_results, str):
            scan_results_json = json.loads(scan_results) if scan_results else None
        else:
            scan_results_json = scan_results

        try:
            pg_cur.execute(insert_sql, (
                time_val,  # time column for hypertable
                row['device_id'],
                row['target_ip'],  # Will be cast to INET type
                row['scan_type'],
                row['scan_timestamp'],
                (row['scan_duration_seconds'] if 'scan_duration_seconds' in row.keys() else None),
                (row['hostname'] if 'hostname' in row.keys() else None),
                (row['host_status'] if 'host_status' in row.keys() else None),
                (row['os_name'] if 'os_name' in row.keys() else None),
                (row['os_accuracy'] if 'os_accuracy' in row.keys() else None),
                json.dumps(os_matches_json) if os_matches_json else None,
                row.get('total_ports', 0),
                row.get('open_ports_count', 0),
                json.dumps(scan_results_json) if scan_results_json else None,
                (row['raw_xml'] if 'raw_xml' in row.keys() else None)
            ))
            migrated += 1
        except psycopg2.Error as e:
            print(f"  ⚠ Skipped record (invalid IP?): {row['target_ip']} - {e}")
            skipped += 1

    print(f"OK Migrated {migrated} nmap scan records ({skipped} skipped)")
    return migrated

def migrate_nmap_port_history(sqlite_cur, pg_cur):
    """Migrate nmap_port_history table"""
    print("\n=== Migrating nmap_port_history ===")

    # Get data from SQLite
    sqlite_cur.execute("SELECT * FROM nmap_port_history")
    rows = sqlite_cur.fetchall()
    print(f"Found {len(rows)} port scan records")

    if not rows:
        return 0

    # Insert into PostgreSQL
    insert_sql = """
        INSERT INTO nmap_port_history
        (id, scan_id, port_number, protocol, state, service_name, service_product, service_version)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO NOTHING
    """

    migrated = 0
    skipped = 0
    for row in rows:
        try:
            pg_cur.execute(insert_sql, (
                row['id'],
                row['scan_id'],
                row['port_number'],
                row['protocol'],
                row['state'],
                (row['service_name'] if 'service_name' in row.keys() else None),
                (row['service_product'] if 'service_product' in row.keys() else None),
                (row['service_version'] if 'service_version' in row.keys() else None)
            ))
            migrated += 1
        except psycopg2.IntegrityError as e:
            # FK constraint - scan_id doesn't exist (was skipped)
            skipped += 1

    print(f"OK Migrated {migrated} port scan records ({skipped} skipped due to FK)")
    return migrated

def migrate_nmap_change_events(sqlite_cur, pg_cur):
    """Migrate nmap_change_events table (hypertable)"""
    print("\n=== Migrating nmap_change_events ===")

    # Get data from SQLite
    sqlite_cur.execute("SELECT * FROM nmap_change_events ORDER BY change_timestamp")
    rows = sqlite_cur.fetchall()
    print(f"Found {len(rows)} change events")

    if not rows:
        return 0

    # Insert into PostgreSQL (hypertable - time is partition key)
    insert_sql = """
        INSERT INTO nmap_change_events
        (time, device_id, target_ip, change_timestamp, change_type, severity,
         old_value, new_value, details, acknowledged, acknowledged_at, acknowledged_by)
        VALUES (%s, %s, %s::inet, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s)
        ON CONFLICT (id, time) DO NOTHING
    """

    migrated = 0
    skipped = 0
    for row in rows:
        # Use change_timestamp as the time column (partition key)
        time_val = row['change_timestamp']

        # Parse details JSON (was TEXT in SQLite, JSONB in PostgreSQL)
        details = (row['details_json'] if 'details_json' in row.keys() else None) or (row['details'] if 'details' in row.keys() else None)
        if isinstance(details, str):
            details_json = json.loads(details) if details else None
        else:
            details_json = details

        try:
            pg_cur.execute(insert_sql, (
                time_val,  # time column for hypertable
                row['device_id'],
                row['target_ip'],  # Will be cast to INET type
                row['change_timestamp'],
                row['change_type'],
                row['severity'],
                (row['old_value'] if 'old_value' in row.keys() else None),
                (row['new_value'] if 'new_value' in row.keys() else None),
                json.dumps(details_json) if details_json else None,
                row.get('acknowledged', False),
                (row['acknowledged_at'] if 'acknowledged_at' in row.keys() else None),
                (row['acknowledged_by'] if 'acknowledged_by' in row.keys() else None)
            ))
            migrated += 1
        except psycopg2.Error as e:
            print(f"  ⚠ Skipped event (invalid IP?): {row['target_ip']} - {e}")
            skipped += 1

    print(f"OK Migrated {migrated} change events ({skipped} skipped)")
    return migrated

def migrate_scan_queue(sqlite_cur, pg_cur):
    """Migrate scan_queue table"""
    print("\n=== Migrating scan_queue ===")

    # Get data from SQLite
    sqlite_cur.execute("SELECT * FROM scan_queue")
    rows = sqlite_cur.fetchall()
    print(f"Found {len(rows)} scan queue entries")

    if not rows:
        return 0

    # Insert into PostgreSQL
    insert_sql = """
        INSERT INTO scan_queue
        (id, schedule_id, device_id, target_ip, scan_type, status, queued_at,
         started_at, completed_at, scan_id, error_message)
        VALUES (%s, %s, %s, %s::inet, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            started_at = EXCLUDED.started_at,
            completed_at = EXCLUDED.completed_at,
            scan_id = EXCLUDED.scan_id,
            error_message = EXCLUDED.error_message
    """

    migrated = 0
    skipped = 0
    for row in rows:
        try:
            pg_cur.execute(insert_sql, (
                row['id'],
                (row['schedule_id'] if 'schedule_id' in row.keys() else None),
                row['device_id'],
                row['target_ip'],  # Will be cast to INET type
                row['scan_type'],
                row['status'],
                row['queued_at'],
                (row['started_at'] if 'started_at' in row.keys() else None),
                (row['completed_at'] if 'completed_at' in row.keys() else None),
                (row['scan_id'] if 'scan_id' in row.keys() else None),
                (row['error_message'] if 'error_message' in row.keys() else None)
            ))
            migrated += 1
        except psycopg2.Error as e:
            print(f"  ⚠ Skipped queue entry (invalid IP or FK?): {row['target_ip']} - {e}")
            skipped += 1

    print(f"OK Migrated {migrated} scan queue entries ({skipped} skipped)")
    return migrated

def main():
    """Main migration workflow"""
    print("=" * 70)
    print("NMAP SCANNING MIGRATION: SQLite -> TimescaleDB")
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
        stats['scheduled_scans'] = migrate_scheduled_scans(sqlite_cur, pg_cur)
        pg_conn.commit()

        stats['nmap_scan_history'] = migrate_nmap_scan_history(sqlite_cur, pg_cur)
        pg_conn.commit()

        stats['nmap_port_history'] = migrate_nmap_port_history(sqlite_cur, pg_cur)
        pg_conn.commit()

        stats['nmap_change_events'] = migrate_nmap_change_events(sqlite_cur, pg_cur)
        pg_conn.commit()

        stats['scan_queue'] = migrate_scan_queue(sqlite_cur, pg_cur)
        pg_conn.commit()

        # Print summary
        print("\n" + "=" * 70)
        print("MIGRATION COMPLETE")
        print("=" * 70)
        print(f"\nMigration Summary:")
        print(f"  Scheduled Scans:       {stats['scheduled_scans']}")
        print(f"  Nmap Scan History:     {stats['nmap_scan_history']}")
        print(f"  Nmap Port History:     {stats['nmap_port_history']}")
        print(f"  Nmap Change Events:    {stats['nmap_change_events']}")
        print(f"  Scan Queue:            {stats['scan_queue']}")
        print(f"\nTotal Records Migrated: {sum(stats.values())}")

        print("\nOK All nmap scanning data successfully migrated to TimescaleDB")
        print("\nNext steps:")
        print("  1. Verify data in PostgreSQL")
        print("  2. Test scan_storage.py with PostgreSQL")
        print("  3. Backup and remove nmap_scans.db")

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
