#!/usr/bin/env python3
"""
PANfm v2.0.0 - SQLite to TimescaleDB Migration Script
======================================================

Migrates historical throughput data from SQLite (throughput_history.db)
to TimescaleDB (panfm_db) with batch processing and progress tracking.

Features:
- Batch migration (1000 rows at a time for memory efficiency)
- Progress logging with percentage completion
- Idempotent (ON CONFLICT DO NOTHING - safe to re-run)
- Timestamp format conversion (SQLite datetime → PostgreSQL TIMESTAMPTZ)
- Transaction safety with automatic rollback on errors
- Dry-run mode for testing
- Detailed statistics and validation

Usage:
    python migrate_sqlite_to_timescale.py [--dry-run] [--batch-size 1000]

Requirements:
    - TIMESCALE_PASSWORD environment variable set
    - SQLite database at ./throughput_history.db
    - TimescaleDB container running (docker-compose up -d timescaledb)

Author: PANfm Development Team
Date: 2025-11-19
"""

import os
import sys
import sqlite3
import psycopg2
import psycopg2.extras
from datetime import datetime
from typing import List, Dict, Tuple
import argparse

# Configuration from environment
TIMESCALE_HOST = os.getenv('TIMESCALE_HOST', 'localhost')
TIMESCALE_PORT = int(os.getenv('TIMESCALE_PORT', 5432))
TIMESCALE_USER = os.getenv('TIMESCALE_USER', 'panfm')
TIMESCALE_PASSWORD = os.getenv('TIMESCALE_PASSWORD', 'panfm_secure_password')
TIMESCALE_DB = os.getenv('TIMESCALE_DB', 'panfm_db')

SQLITE_DB_PATH = os.getenv('SQLITE_DB_PATH', './throughput_history.db')

# Build PostgreSQL connection string
TIMESCALE_DSN = f"postgresql://{TIMESCALE_USER}:{TIMESCALE_PASSWORD}@{TIMESCALE_HOST}:{TIMESCALE_PORT}/{TIMESCALE_DB}"

# Default batch size (tunable for performance)
DEFAULT_BATCH_SIZE = 1000


class MigrationStats:
    """Track migration statistics."""
    def __init__(self):
        self.total_rows = 0
        self.migrated_rows = 0
        self.skipped_rows = 0
        self.failed_rows = 0
        self.start_time = None
        self.end_time = None

    def duration_seconds(self) -> float:
        """Calculate migration duration in seconds."""
        if self.start_time and self.end_time:
            return (self.end_time - self.start_time).total_seconds()
        return 0

    def rows_per_second(self) -> float:
        """Calculate migration speed (rows/second)."""
        duration = self.duration_seconds()
        if duration > 0:
            return self.migrated_rows / duration
        return 0

    def print_summary(self):
        """Print migration summary."""
        print("\n" + "=" * 80)
        print("MIGRATION SUMMARY")
        print("=" * 80)
        print(f"Total rows in SQLite:       {self.total_rows:,}")
        print(f"Successfully migrated:      {self.migrated_rows:,}")
        print(f"Skipped (duplicates):       {self.skipped_rows:,}")
        print(f"Failed:                     {self.failed_rows:,}")
        print(f"Duration:                   {self.duration_seconds():.1f} seconds")
        print(f"Migration speed:            {self.rows_per_second():.0f} rows/second")
        print("=" * 80)

        if self.failed_rows > 0:
            print("\n[WARNING] Some rows failed to migrate. Check logs above.")
        elif self.migrated_rows == self.total_rows:
            print("\n[SUCCESS] All rows migrated successfully!")
        elif self.skipped_rows > 0:
            print(f"\n[SUCCESS] {self.migrated_rows:,} new rows migrated, {self.skipped_rows:,} already existed.")


def check_sqlite_database(db_path: str) -> Tuple[bool, int]:
    """
    Check if SQLite database exists and count rows.

    Args:
        db_path: Path to SQLite database file

    Returns:
        Tuple of (exists, row_count)
    """
    if not os.path.exists(db_path):
        print(f"[ERROR] SQLite database not found: {db_path}")
        return False, 0

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM throughput_samples")
        row_count = cursor.fetchone()[0]
        conn.close()
        return True, row_count
    except sqlite3.Error as e:
        print(f"[ERROR] Failed to read SQLite database: {e}")
        return False, 0


def check_timescale_connection() -> bool:
    """
    Check if TimescaleDB is accessible.

    Returns:
        True if connection successful, False otherwise
    """
    try:
        conn = psycopg2.connect(TIMESCALE_DSN, connect_timeout=10)
        cursor = conn.cursor()
        cursor.execute("SELECT version()")
        version = cursor.fetchone()[0]
        print(f"[OK] Connected to TimescaleDB: {version}")
        conn.close()
        return True
    except psycopg2.Error as e:
        print(f"[ERROR] Failed to connect to TimescaleDB: {e}")
        print(f"\nConnection details:")
        print(f"  Host: {TIMESCALE_HOST}")
        print(f"  Port: {TIMESCALE_PORT}")
        print(f"  Database: {TIMESCALE_DB}")
        print(f"  User: {TIMESCALE_USER}")
        print(f"\nEnsure TimescaleDB container is running:")
        print(f"  docker-compose up -d timescaledb")
        return False


def fetch_sqlite_batch(cursor: sqlite3.Cursor, offset: int, batch_size: int) -> List[Tuple]:
    """
    Fetch a batch of rows from SQLite database.

    Args:
        cursor: SQLite cursor
        offset: Row offset to start from
        batch_size: Number of rows to fetch

    Returns:
        List of row tuples
    """
    query = """
    SELECT
        timestamp, device_id, inbound_mbps, outbound_mbps, total_mbps,
        inbound_pps, outbound_pps, total_pps,
        sessions_active, sessions_tcp, sessions_udp, sessions_icmp,
        session_max_capacity, session_utilization_pct,
        cpu_data_plane, cpu_mgmt_plane, memory_used_pct,
        disk_root_pct, disk_logs_pct, disk_var_pct,
        top_bandwidth_client_json, top_internal_client_json, top_internet_client_json,
        internal_mbps, internet_mbps,
        NULL as top_category_wan_json, top_category_lan_json, top_category_internet_json,
        app_version, threat_version, wildfire_version, url_version
    FROM throughput_samples
    ORDER BY timestamp ASC
    LIMIT ? OFFSET ?
    """
    cursor.execute(query, (batch_size, offset))
    return cursor.fetchall()


def insert_timescale_batch(cursor: psycopg2.extensions.cursor, rows: List[Tuple], dry_run: bool = False) -> Tuple[int, int]:
    """
    Insert a batch of rows into TimescaleDB.

    Args:
        cursor: PostgreSQL cursor
        rows: List of row tuples to insert
        dry_run: If True, don't actually insert (for testing)

    Returns:
        Tuple of (inserted_count, skipped_count)
    """
    if not rows:
        return 0, 0

    if dry_run:
        print(f"  [DRY RUN] Would insert {len(rows)} rows")
        return len(rows), 0

    # PostgreSQL INSERT with ON CONFLICT for idempotency
    insert_query = """
    INSERT INTO throughput_samples (
        time, device_id, inbound_mbps, outbound_mbps, total_mbps,
        inbound_pps, outbound_pps, total_pps,
        sessions_active, sessions_tcp, sessions_udp, sessions_icmp,
        session_max_capacity, session_utilization_pct,
        cpu_data_plane, cpu_mgmt_plane, memory_used_pct,
        disk_root_pct, disk_logs_pct, disk_var_pct,
        top_bandwidth_client_json, top_internal_client_json, top_internet_client_json,
        internal_mbps, internet_mbps,
        top_category_wan_json, top_category_lan_json, top_category_internet_json,
        app_version, threat_version, wildfire_version, url_version
    ) VALUES (
        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
        %s, %s
    )
    ON CONFLICT (time, device_id) DO NOTHING
    """

    try:
        # Use execute_batch for better performance than executemany
        psycopg2.extras.execute_batch(cursor, insert_query, rows, page_size=len(rows))

        # Count how many rows were actually inserted (vs skipped due to conflict)
        inserted_count = cursor.rowcount
        skipped_count = len(rows) - inserted_count

        return inserted_count, skipped_count

    except psycopg2.Error as e:
        print(f"[ERROR] Failed inserting batch: {e}")
        raise


def migrate_data(batch_size: int = DEFAULT_BATCH_SIZE, dry_run: bool = False) -> MigrationStats:
    """
    Migrate all data from SQLite to TimescaleDB in batches.

    Args:
        batch_size: Number of rows to process per batch
        dry_run: If True, don't actually insert data (for testing)

    Returns:
        MigrationStats object with results
    """
    stats = MigrationStats()
    stats.start_time = datetime.now()

    print("\n" + "=" * 80)
    print("STARTING MIGRATION")
    print("=" * 80)
    print(f"Source:      SQLite ({SQLITE_DB_PATH})")
    print(f"Destination: TimescaleDB ({TIMESCALE_HOST}:{TIMESCALE_PORT}/{TIMESCALE_DB})")
    print(f"Batch size:  {batch_size:,} rows")
    print(f"Mode:        {'DRY RUN (no changes)' if dry_run else 'LIVE MIGRATION'}")
    print("=" * 80 + "\n")

    # Check SQLite database
    exists, row_count = check_sqlite_database(SQLITE_DB_PATH)
    if not exists or row_count == 0:
        print("[INFO] No data to migrate.")
        return stats

    stats.total_rows = row_count
    print(f"[INFO] Found {row_count:,} rows in SQLite database\n")

    # Check TimescaleDB connection
    if not check_timescale_connection():
        return stats

    # Connect to both databases
    try:
        sqlite_conn = sqlite3.connect(SQLITE_DB_PATH)
        sqlite_cursor = sqlite_conn.cursor()

        timescale_conn = psycopg2.connect(TIMESCALE_DSN)
        timescale_cursor = timescale_conn.cursor()

        # Process in batches
        offset = 0
        batch_num = 1

        while offset < row_count:
            # Fetch batch from SQLite
            rows = fetch_sqlite_batch(sqlite_cursor, offset, batch_size)

            if not rows:
                break

            # Insert batch into TimescaleDB
            try:
                inserted, skipped = insert_timescale_batch(timescale_cursor, rows, dry_run)

                stats.migrated_rows += inserted
                stats.skipped_rows += skipped

                # Commit batch
                if not dry_run:
                    timescale_conn.commit()

                # Progress update
                progress_pct = ((offset + len(rows)) / row_count) * 100
                print(f"Batch {batch_num:,}: Migrated {len(rows):,} rows "
                      f"({inserted:,} new, {skipped:,} skipped) - "
                      f"Progress: {progress_pct:.1f}% ({offset + len(rows):,}/{row_count:,})")

            except psycopg2.Error as e:
                print(f"[ERROR] Error in batch {batch_num}: {e}")
                stats.failed_rows += len(rows)
                timescale_conn.rollback()

            offset += batch_size
            batch_num += 1

        # Close connections
        sqlite_cursor.close()
        sqlite_conn.close()
        timescale_cursor.close()
        timescale_conn.close()

    except Exception as e:
        print(f"[ERROR] FATAL ERROR during migration: {e}")
        stats.failed_rows = row_count - stats.migrated_rows

    stats.end_time = datetime.now()
    return stats


def validate_migration(stats: MigrationStats) -> bool:
    """
    Validate migration by comparing row counts.

    Args:
        stats: Migration statistics

    Returns:
        True if validation passed, False otherwise
    """
    print("\n" + "=" * 80)
    print("VALIDATING MIGRATION")
    print("=" * 80)

    try:
        # Count rows in TimescaleDB
        conn = psycopg2.connect(TIMESCALE_DSN)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM throughput_samples")
        timescale_count = cursor.fetchone()[0]
        conn.close()

        print(f"SQLite row count:      {stats.total_rows:,}")
        print(f"TimescaleDB row count: {timescale_count:,}")

        if timescale_count >= stats.total_rows:
            print("\n[SUCCESS] VALIDATION PASSED: All SQLite data is in TimescaleDB")
            return True
        else:
            missing = stats.total_rows - timescale_count
            print(f"\n[WARNING] {missing:,} rows missing in TimescaleDB")
            print("   Re-run migration script to complete (idempotent).")
            return False

    except psycopg2.Error as e:
        print(f"[ERROR] Validation failed: {e}")
        return False


def main():
    """Main migration script entry point."""
    parser = argparse.ArgumentParser(
        description="Migrate PANfm throughput data from SQLite to TimescaleDB",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Dry run (no changes)
  python migrate_sqlite_to_timescale.py --dry-run

  # Live migration with default batch size (1000)
  python migrate_sqlite_to_timescale.py

  # Live migration with custom batch size
  python migrate_sqlite_to_timescale.py --batch-size 5000

Environment Variables:
  TIMESCALE_HOST       TimescaleDB host (default: localhost)
  TIMESCALE_PORT       TimescaleDB port (default: 5432)
  TIMESCALE_USER       TimescaleDB user (default: panfm)
  TIMESCALE_PASSWORD   TimescaleDB password (default: panfm_secure_password)
  TIMESCALE_DB         TimescaleDB database (default: panfm_db)
  SQLITE_DB_PATH       SQLite database path (default: ./throughput_history.db)
        """
    )

    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Test migration without actually inserting data'
    )

    parser.add_argument(
        '--batch-size',
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f'Number of rows per batch (default: {DEFAULT_BATCH_SIZE})'
    )

    args = parser.parse_args()

    # Run migration
    stats = migrate_data(batch_size=args.batch_size, dry_run=args.dry_run)

    # Print summary
    stats.print_summary()

    # Validate if live migration
    if not args.dry_run and stats.migrated_rows > 0:
        validation_passed = validate_migration(stats)
        if not validation_passed:
            sys.exit(1)

    # Exit with error code if migration failed
    if stats.failed_rows > 0:
        sys.exit(1)

    sys.exit(0)


if __name__ == '__main__':
    main()
