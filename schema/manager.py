"""
PANfm Schema Manager

Robust database schema initialization for TimescaleDB.
Handles table creation, hypertable conversion, indexes, and policies.

Features:
- Idempotent: Safe to run multiple times
- Error-tolerant: Logs errors but continues
- Edition-aware: Creates all tables for both Community/Enterprise
- Progress reporting: Shows what's being created

Usage:
    from schema.manager import SchemaManager
    manager = SchemaManager(dsn)
    manager.ensure_schema()
"""

import os
import psycopg2
from psycopg2 import sql
from pathlib import Path


class SchemaManager:
    """
    Manages TimescaleDB schema initialization for PANfm.

    Creates all tables with proper error handling, ensuring
    partial failures don't leave the database in a broken state.
    """

    # Tables that should be converted to hypertables
    HYPERTABLES = {
        'throughput_samples': ('time', '1 day'),
        'connected_devices': ('time', '1 day'),
        'threat_logs': ('time', '1 day'),
        'alert_history': ('time', '1 day'),
        'nmap_scan_history': ('time', '1 day'),
        'nmap_change_events': ('time', '1 day'),
        'traffic_flows': ('time', '1 day'),
        'scheduler_stats_history': ('timestamp', '1 day'),
        'application_samples': ('time', '1 day'),
        'category_bandwidth': ('time', '1 day'),
        'client_bandwidth': ('time', '1 day'),
    }

    # Tables that need retention policies (table_name: interval)
    RETENTION_POLICIES = {
        'throughput_samples': '7 days',
        'connected_devices': '7 days',
        'threat_logs': '7 days',
        'alert_history': '30 days',
        'nmap_scan_history': '30 days',
        'nmap_change_events': '30 days',
        'traffic_flows': '7 days',
        'scheduler_stats_history': '30 days',
        'application_samples': '7 days',
        'category_bandwidth': '7 days',
        'client_bandwidth': '7 days',
    }

    # Tables that need compression policies (table_name: compress_after)
    COMPRESSION_POLICIES = {
        'throughput_samples': ('2 days', 'device_id', 'time DESC'),
        'connected_devices': ('1 day', 'device_id, ip', 'time DESC'),
        'threat_logs': ('1 day', 'device_id', 'time DESC'),
        'traffic_flows': ('2 days', 'device_id, source_ip, application', 'time DESC'),
    }

    def __init__(self, dsn):
        """
        Initialize schema manager.

        Args:
            dsn: PostgreSQL connection string
        """
        self.dsn = dsn
        self.conn = None
        self.errors = []
        self.created_tables = []

        # Load SQL schema file
        schema_dir = Path(__file__).parent
        self.tables_sql_path = schema_dir / 'tables.sql'

    def ensure_schema(self):
        """
        Main entry point - creates/updates entire schema.

        Returns:
            bool: True if successful, False if any errors
        """
        print("[SCHEMA] Starting schema initialization...")

        try:
            self.conn = psycopg2.connect(self.dsn)
            self.conn.autocommit = True

            # Step 1: Ensure TimescaleDB extension
            self._ensure_extension()

            # Step 2: Create all tables
            self._create_tables()

            # Step 3: Convert to hypertables
            self._ensure_hypertables()

            # Step 4: Create indexes
            self._create_indexes()

            # Step 5: Apply retention policies
            self._apply_retention_policies()

            # Step 6: Apply compression policies
            self._apply_compression_policies()

            # Step 7: Grant permissions
            self._grant_permissions()

            # Report results
            if self.errors:
                print(f"[SCHEMA] Completed with {len(self.errors)} errors:")
                for err in self.errors:
                    print(f"  - {err}")
                return False
            else:
                print(f"[SCHEMA] Schema initialization complete. Created/verified {len(self.created_tables)} tables.")
                return True

        except Exception as e:
            print(f"[SCHEMA ERROR] Fatal error: {e}")
            return False
        finally:
            if self.conn:
                self.conn.close()

    def _ensure_extension(self):
        """Ensure TimescaleDB extension is enabled."""
        try:
            with self.conn.cursor() as cur:
                cur.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;")
                print("[SCHEMA] ✓ TimescaleDB extension enabled")
        except Exception as e:
            self.errors.append(f"Extension: {e}")
            print(f"[SCHEMA] ✗ Failed to enable TimescaleDB: {e}")

    def _table_exists(self, table_name):
        """Check if a table exists."""
        with self.conn.cursor() as cur:
            cur.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables
                    WHERE table_schema = 'public'
                    AND table_name = %s
                )
            """, (table_name,))
            return cur.fetchone()[0]

    def _is_hypertable(self, table_name):
        """Check if a table is already a hypertable."""
        with self.conn.cursor() as cur:
            cur.execute("""
                SELECT EXISTS (
                    SELECT FROM timescaledb_information.hypertables
                    WHERE hypertable_name = %s
                )
            """, (table_name,))
            return cur.fetchone()[0]

    def _create_tables(self):
        """Create all tables from SQL file."""
        print("[SCHEMA] Creating tables...")

        if not self.tables_sql_path.exists():
            self.errors.append(f"SQL file not found: {self.tables_sql_path}")
            print(f"[SCHEMA] ✗ SQL file not found: {self.tables_sql_path}")
            return

        # Read SQL file
        sql_content = self.tables_sql_path.read_text()

        # Remove SQL comments to avoid parsing issues
        lines = []
        for line in sql_content.split('\n'):
            # Remove inline comments but keep the rest of the line
            if '--' in line:
                line = line.split('--')[0]
            lines.append(line)
        clean_sql = '\n'.join(lines)

        # Split by semicolons and execute each statement
        statements = [s.strip() for s in clean_sql.split(';') if s.strip()]

        for stmt in statements:
            # Skip empty statements
            if not stmt:
                continue

            # Extract table name for logging
            table_name = self._extract_table_name(stmt)

            try:
                with self.conn.cursor() as cur:
                    cur.execute(stmt)
                    if table_name:
                        self.created_tables.append(table_name)
                        print(f"[SCHEMA] ✓ {table_name}")
                    elif 'CREATE INDEX' in stmt.upper():
                        # Extract index name
                        idx_name = self._extract_index_name(stmt)
                        if idx_name:
                            print(f"[SCHEMA] ✓ Index {idx_name}")
            except psycopg2.errors.DuplicateTable:
                # Table already exists - this is fine
                if table_name:
                    print(f"[SCHEMA] ✓ {table_name} (exists)")
            except psycopg2.errors.DuplicateObject:
                # Index or constraint already exists
                if table_name:
                    print(f"[SCHEMA] ✓ {table_name} (exists)")
                else:
                    print(f"[SCHEMA] ✓ Object exists")
            except psycopg2.errors.UniqueViolation:
                # Type already exists (pg_type_typname_nsp_index error)
                if table_name:
                    print(f"[SCHEMA] ✓ {table_name} (exists)")
            except Exception as e:
                err_str = str(e)
                # Check if it's a "already exists" type error
                if 'already exists' in err_str.lower() or 'duplicate' in err_str.lower():
                    if table_name:
                        print(f"[SCHEMA] ✓ {table_name} (exists)")
                    continue
                error_msg = f"{table_name or 'Statement'}: {e}"
                self.errors.append(error_msg)
                print(f"[SCHEMA] ✗ {error_msg}")

    def _extract_index_name(self, stmt):
        """Extract index name from CREATE INDEX statement."""
        stmt_upper = stmt.upper()
        if 'CREATE INDEX' in stmt_upper:
            parts = stmt.split()
            for i, part in enumerate(parts):
                if part.upper() == 'INDEX':
                    idx = i + 1
                    # Skip IF NOT EXISTS
                    while idx < len(parts) and parts[idx].upper() in ('IF', 'NOT', 'EXISTS'):
                        idx += 1
                    if idx < len(parts):
                        return parts[idx]
        return None

    def _extract_table_name(self, stmt):
        """Extract table name from CREATE TABLE statement."""
        stmt_upper = stmt.upper()
        if 'CREATE TABLE' in stmt_upper:
            # Find table name after CREATE TABLE [IF NOT EXISTS]
            parts = stmt.split()
            for i, part in enumerate(parts):
                if part.upper() == 'TABLE':
                    # Skip 'IF NOT EXISTS' if present
                    idx = i + 1
                    while idx < len(parts) and parts[idx].upper() in ('IF', 'NOT', 'EXISTS'):
                        idx += 1
                    if idx < len(parts):
                        # Clean up table name (remove parenthesis if attached)
                        name = parts[idx].strip('(').strip()
                        return name
        return None

    def _ensure_hypertables(self):
        """Convert regular tables to hypertables."""
        print("[SCHEMA] Converting to hypertables...")

        for table_name, (time_column, chunk_interval) in self.HYPERTABLES.items():
            if not self._table_exists(table_name):
                print(f"[SCHEMA] - {table_name} (table not found, skipping)")
                continue

            if self._is_hypertable(table_name):
                print(f"[SCHEMA] ✓ {table_name} (already hypertable)")
                continue

            try:
                with self.conn.cursor() as cur:
                    cur.execute(f"""
                        SELECT create_hypertable(
                            '{table_name}',
                            '{time_column}',
                            chunk_time_interval => INTERVAL '{chunk_interval}',
                            if_not_exists => TRUE
                        )
                    """)
                    print(f"[SCHEMA] ✓ {table_name} → hypertable")
            except Exception as e:
                self.errors.append(f"Hypertable {table_name}: {e}")
                print(f"[SCHEMA] ✗ {table_name}: {e}")

    def _create_indexes(self):
        """Create indexes (defined in tables.sql, but ensure key ones exist)."""
        print("[SCHEMA] Verifying indexes...")

        # Key indexes that must exist
        key_indexes = [
            ("idx_throughput_device_time", "throughput_samples", "(device_id, time DESC)"),
            ("idx_connected_devices_device_ip", "connected_devices", "(device_id, ip, time DESC)"),
            ("idx_threat_logs_device_time", "threat_logs", "(device_id, time DESC)"),
        ]

        for idx_name, table_name, columns in key_indexes:
            if not self._table_exists(table_name):
                continue

            try:
                with self.conn.cursor() as cur:
                    cur.execute(f"""
                        CREATE INDEX IF NOT EXISTS {idx_name}
                        ON {table_name} {columns}
                    """)
                    print(f"[SCHEMA] ✓ Index {idx_name}")
            except Exception as e:
                # Index errors are non-fatal
                print(f"[SCHEMA] - Index {idx_name}: {e}")

    def _apply_retention_policies(self):
        """Apply retention policies to hypertables."""
        print("[SCHEMA] Applying retention policies...")

        for table_name, interval in self.RETENTION_POLICIES.items():
            if not self._table_exists(table_name):
                continue
            if not self._is_hypertable(table_name):
                continue

            try:
                with self.conn.cursor() as cur:
                    cur.execute(f"""
                        SELECT add_retention_policy(
                            '{table_name}',
                            INTERVAL '{interval}',
                            if_not_exists => TRUE
                        )
                    """)
                    print(f"[SCHEMA] ✓ Retention {table_name}: {interval}")
            except Exception as e:
                # Policy errors are non-fatal
                print(f"[SCHEMA] - Retention {table_name}: {e}")

    def _apply_compression_policies(self):
        """Apply compression policies to hypertables."""
        print("[SCHEMA] Applying compression policies...")

        for table_name, (compress_after, segmentby, orderby) in self.COMPRESSION_POLICIES.items():
            if not self._table_exists(table_name):
                continue
            if not self._is_hypertable(table_name):
                continue

            try:
                with self.conn.cursor() as cur:
                    # Enable compression on table
                    cur.execute(f"""
                        ALTER TABLE {table_name} SET (
                            timescaledb.compress,
                            timescaledb.compress_segmentby = '{segmentby}',
                            timescaledb.compress_orderby = '{orderby}'
                        )
                    """)

                    # Add compression policy
                    cur.execute(f"""
                        SELECT add_compression_policy(
                            '{table_name}',
                            INTERVAL '{compress_after}',
                            if_not_exists => TRUE
                        )
                    """)
                    print(f"[SCHEMA] ✓ Compression {table_name}: after {compress_after}")
            except Exception as e:
                # Compression errors are non-fatal
                print(f"[SCHEMA] - Compression {table_name}: {e}")

    def _grant_permissions(self):
        """Grant permissions to panfm user."""
        print("[SCHEMA] Granting permissions...")

        try:
            with self.conn.cursor() as cur:
                cur.execute("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO panfm;")
                cur.execute("GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO panfm;")
                cur.execute("GRANT USAGE ON SCHEMA public TO panfm;")
                print("[SCHEMA] ✓ Permissions granted")
        except Exception as e:
            # Permission errors are non-fatal in most cases
            print(f"[SCHEMA] - Permissions: {e}")

    def verify_schema(self):
        """
        Verify that essential tables exist.

        Returns:
            tuple: (success: bool, missing_tables: list)
        """
        essential_tables = [
            'throughput_samples',
            'connected_devices',
            'threat_logs',
            'device_metadata',
            'collection_requests',
        ]

        try:
            self.conn = psycopg2.connect(self.dsn)
            missing = [t for t in essential_tables if not self._table_exists(t)]
            self.conn.close()

            return (len(missing) == 0, missing)
        except Exception as e:
            return (False, [f"Connection error: {e}"])


# CLI interface for direct execution
if __name__ == '__main__':
    import sys

    # Get DSN from environment or command line
    dsn = os.environ.get('TIMESCALE_DSN')

    if not dsn and len(sys.argv) > 1:
        dsn = sys.argv[1]

    if not dsn:
        # Build DSN from individual environment variables
        host = os.environ.get('TIMESCALE_HOST', 'localhost')
        port = os.environ.get('TIMESCALE_PORT', '5432')
        user = os.environ.get('TIMESCALE_USER', 'panfm')
        password = os.environ.get('TIMESCALE_PASSWORD', 'panfm_secure_password')
        db = os.environ.get('TIMESCALE_DB', 'panfm_db')
        dsn = f"postgresql://{user}:{password}@{host}:{port}/{db}"

    print(f"[SCHEMA] Connecting to database...")
    manager = SchemaManager(dsn)

    success = manager.ensure_schema()
    sys.exit(0 if success else 1)
