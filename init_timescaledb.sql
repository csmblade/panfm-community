-- =========================================
-- PANfm v2.0.0 - TimescaleDB Initialization
-- =========================================
-- Time-series database for throughput metrics and device monitoring
-- Author: PANfm Development Team
-- Created: 2025-11-19
-- Purpose: Replace SQLite with enterprise-grade time-series database
--
-- Features:
-- - Hypertables with 1-day chunks for optimal query performance
-- - Continuous aggregates for automatic hourly/daily rollups
-- - Retention policies: 7d raw, 90d hourly, 7y daily
-- - Compression policies: 90% storage reduction
-- - Optimized indexes for time-range queries
-- =========================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- =========================================
-- Main Throughput Samples Hypertable
-- =========================================
-- Stores 30-second interval samples from firewall
-- Retention: 7 days raw → 90 days hourly → 1 year daily
-- Chunk size: 1 day (optimal for time-range queries)

CREATE TABLE IF NOT EXISTS throughput_samples (
    time TIMESTAMPTZ NOT NULL,
    device_id TEXT NOT NULL,

    -- Throughput metrics (Mbps and packets/sec)
    inbound_mbps DOUBLE PRECISION,
    outbound_mbps DOUBLE PRECISION,
    total_mbps DOUBLE PRECISION,
    inbound_pps BIGINT,
    outbound_pps BIGINT,
    total_pps BIGINT,

    -- Session metrics
    sessions_active INTEGER,
    sessions_tcp INTEGER,
    sessions_udp INTEGER,
    sessions_icmp INTEGER,
    session_max_capacity INTEGER,
    session_utilization_pct SMALLINT,

    -- CPU metrics (percentage)
    cpu_data_plane SMALLINT,
    cpu_mgmt_plane SMALLINT,

    -- Memory metrics (percentage)
    memory_used_pct SMALLINT,

    -- Disk usage metrics (percentage)
    disk_root_pct SMALLINT,
    disk_logs_pct SMALLINT,
    disk_var_pct SMALLINT,

    -- Top clients/applications (JSON for flexibility)
    top_bandwidth_client_json JSONB,
    top_internal_client_json JSONB,
    top_internet_client_json JSONB,

    -- Enhanced Insights: Internal vs Internet traffic (Mbps)
    internal_mbps DOUBLE PRECISION DEFAULT 0,
    internet_mbps DOUBLE PRECISION DEFAULT 0,

    -- Enhanced Insights: Top categories by traffic (JSON arrays)
    top_category_wan_json JSONB,
    top_category_lan_json JSONB,
    top_category_internet_json JSONB,

    -- Database versions (PAN-OS content updates)
    app_version TEXT,
    threat_version TEXT,
    wildfire_version TEXT,
    url_version TEXT,

    -- Composite primary key (time + device for multi-device support)
    PRIMARY KEY (time, device_id)
);

-- Convert to hypertable with 1-day chunks
-- This enables automatic partitioning by time for fast queries
SELECT create_hypertable(
    'throughput_samples',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Create index for device-specific time-range queries
-- Most common query pattern: SELECT * FROM throughput_samples WHERE device_id = X AND time BETWEEN Y AND Z
CREATE INDEX IF NOT EXISTS idx_throughput_device_time
    ON throughput_samples (device_id, time DESC);

-- Create index for multi-device aggregations
CREATE INDEX IF NOT EXISTS idx_throughput_time_device
    ON throughput_samples (time DESC, device_id);

-- =========================================
-- Continuous Aggregate: Hourly Rollups
-- =========================================
-- Pre-computed hourly averages for 24h, 7d time ranges
-- Retention: 90 days (then auto-deleted)
-- Refreshes: Every 30 minutes (lag: 1 hour)

CREATE MATERIALIZED VIEW IF NOT EXISTS throughput_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS hour,
    device_id,

    -- Throughput averages and peaks
    AVG(inbound_mbps) AS avg_inbound_mbps,
    MAX(inbound_mbps) AS max_inbound_mbps,
    MIN(inbound_mbps) AS min_inbound_mbps,
    AVG(outbound_mbps) AS avg_outbound_mbps,
    MAX(outbound_mbps) AS max_outbound_mbps,
    MIN(outbound_mbps) AS min_outbound_mbps,
    AVG(total_mbps) AS avg_total_mbps,
    MAX(total_mbps) AS max_total_mbps,
    MIN(total_mbps) AS min_total_mbps,

    -- Packet rate averages
    AVG(inbound_pps) AS avg_inbound_pps,
    AVG(outbound_pps) AS avg_outbound_pps,
    AVG(total_pps) AS avg_total_pps,

    -- Session metrics
    AVG(sessions_active) AS avg_sessions_active,
    MAX(sessions_active) AS max_sessions_active,
    MIN(sessions_active) AS min_sessions_active,
    AVG(sessions_tcp) AS avg_sessions_tcp,
    AVG(sessions_udp) AS avg_sessions_udp,
    AVG(sessions_icmp) AS avg_sessions_icmp,
    AVG(session_utilization_pct) AS avg_session_utilization_pct,
    MAX(session_utilization_pct) AS max_session_utilization_pct,

    -- CPU metrics
    AVG(cpu_data_plane) AS avg_cpu_data_plane,
    MAX(cpu_data_plane) AS max_cpu_data_plane,
    AVG(cpu_mgmt_plane) AS avg_cpu_mgmt_plane,
    MAX(cpu_mgmt_plane) AS max_cpu_mgmt_plane,

    -- Memory metrics
    AVG(memory_used_pct) AS avg_memory_used_pct,
    MAX(memory_used_pct) AS max_memory_used_pct,

    -- Disk usage metrics
    AVG(disk_root_pct) AS avg_disk_root_pct,
    AVG(disk_logs_pct) AS avg_disk_logs_pct,
    AVG(disk_var_pct) AS avg_disk_var_pct,

    -- Enhanced Insights
    AVG(internal_mbps) AS avg_internal_mbps,
    AVG(internet_mbps) AS avg_internet_mbps,

    -- Sample count for debugging/validation
    COUNT(*) AS sample_count
FROM throughput_samples
GROUP BY hour, device_id;

-- Index on continuous aggregate for fast queries
CREATE INDEX IF NOT EXISTS idx_throughput_hourly_device
    ON throughput_hourly (device_id, hour DESC);

-- =========================================
-- Continuous Aggregate: Daily Rollups
-- =========================================
-- Pre-computed daily averages for 30d, 90d, 1y time ranges
-- Retention: 1 year (365 days)
-- Refreshes: Once per day (lag: 2 hours)

CREATE MATERIALIZED VIEW IF NOT EXISTS throughput_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS day,
    device_id,

    -- Throughput daily statistics
    AVG(inbound_mbps) AS avg_inbound_mbps,
    MAX(inbound_mbps) AS max_inbound_mbps,
    MIN(inbound_mbps) AS min_inbound_mbps,
    AVG(outbound_mbps) AS avg_outbound_mbps,
    MAX(outbound_mbps) AS max_outbound_mbps,
    MIN(outbound_mbps) AS min_outbound_mbps,
    AVG(total_mbps) AS avg_total_mbps,
    MAX(total_mbps) AS max_total_mbps,
    MIN(total_mbps) AS min_total_mbps,

    -- Packet rates
    AVG(inbound_pps) AS avg_inbound_pps,
    AVG(outbound_pps) AS avg_outbound_pps,
    AVG(total_pps) AS avg_total_pps,

    -- Sessions
    AVG(sessions_active) AS avg_sessions_active,
    MAX(sessions_active) AS max_sessions_active,
    MIN(sessions_active) AS min_sessions_active,
    AVG(session_utilization_pct) AS avg_session_utilization_pct,
    MAX(session_utilization_pct) AS max_session_utilization_pct,

    -- CPU
    AVG(cpu_data_plane) AS avg_cpu_data_plane,
    MAX(cpu_data_plane) AS max_cpu_data_plane,
    AVG(cpu_mgmt_plane) AS avg_cpu_mgmt_plane,
    MAX(cpu_mgmt_plane) AS max_cpu_mgmt_plane,

    -- Memory
    AVG(memory_used_pct) AS avg_memory_used_pct,
    MAX(memory_used_pct) AS max_memory_used_pct,

    -- Disk
    AVG(disk_root_pct) AS avg_disk_root_pct,
    AVG(disk_logs_pct) AS avg_disk_logs_pct,
    AVG(disk_var_pct) AS avg_disk_var_pct,

    -- Enhanced Insights
    AVG(internal_mbps) AS avg_internal_mbps,
    AVG(internet_mbps) AS avg_internet_mbps,

    -- Sample count
    COUNT(*) AS sample_count
FROM throughput_samples
GROUP BY day, device_id;

-- Index on daily aggregate
CREATE INDEX IF NOT EXISTS idx_throughput_daily_device
    ON throughput_daily (device_id, day DESC);

-- =========================================
-- Retention Policies (Automatic Data Cleanup)
-- =========================================
-- TimescaleDB automatically deletes old data based on these policies
-- No manual cleanup jobs needed!

-- Raw throughput data: Keep 7 days
-- After 7 days, raw 30-second samples are automatically deleted
SELECT add_retention_policy(
    'throughput_samples',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Hourly aggregates: Keep 90 days
-- After 90 days, hourly rollups are automatically deleted
SELECT add_retention_policy(
    'throughput_hourly',
    INTERVAL '90 days',
    if_not_exists => TRUE
);

-- Daily aggregates: Keep 1 year (365 days)
-- After 1 year, daily rollups are automatically deleted
SELECT add_retention_policy(
    'throughput_daily',
    INTERVAL '365 days',
    if_not_exists => TRUE
);

-- =========================================
-- Compression Policies (Storage Optimization)
-- =========================================
-- TimescaleDB compresses old chunks to save 90%+ storage
-- Compressed data is still queryable (transparently decompressed)

-- Enable compression on hypertable FIRST (required before adding policies)
ALTER TABLE throughput_samples SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id',
    timescaledb.compress_orderby = 'time DESC'
);

-- Enable compression on continuous aggregates
ALTER MATERIALIZED VIEW throughput_hourly SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id',
    timescaledb.compress_orderby = 'hour DESC'
);

ALTER MATERIALIZED VIEW throughput_daily SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id',
    timescaledb.compress_orderby = 'day DESC'
);

-- NOW add compression policies (after enabling compression)
-- Compress raw data older than 2 days (recent data stays uncompressed for fast writes)
SELECT add_compression_policy(
    'throughput_samples',
    INTERVAL '2 days',
    if_not_exists => TRUE
);

-- Compress hourly aggregates older than 7 days
SELECT add_compression_policy(
    'throughput_hourly',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Compress daily aggregates older than 30 days
SELECT add_compression_policy(
    'throughput_daily',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- =========================================
-- Refresh Policies for Continuous Aggregates
-- =========================================
-- Automatically refresh materialized views to keep them up-to-date

-- Refresh hourly aggregate every 30 minutes
-- Lag: 1 hour (don't refresh the current hour, wait until it's complete)
SELECT add_continuous_aggregate_policy(
    'throughput_hourly',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists => TRUE
);

-- Refresh daily aggregate once per day
-- Lag: 2 hours (wait for hourly aggregates to stabilize)
SELECT add_continuous_aggregate_policy(
    'throughput_daily',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '2 hours',
    schedule_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- =========================================
-- Helper Views (Convenience Queries)
-- =========================================

-- Latest throughput for each device (dashboard default view)
CREATE OR REPLACE VIEW latest_throughput AS
SELECT DISTINCT ON (device_id)
    device_id,
    time,
    inbound_mbps,
    outbound_mbps,
    total_mbps,
    inbound_pps,
    outbound_pps,
    total_pps,
    sessions_active,
    sessions_tcp,
    sessions_udp,
    sessions_icmp,
    cpu_data_plane,
    cpu_mgmt_plane,
    memory_used_pct,
    disk_root_pct,
    disk_logs_pct,
    disk_var_pct,
    session_utilization_pct,
    internal_mbps,
    internet_mbps
FROM throughput_samples
ORDER BY device_id, time DESC;

-- Device status summary (uptime tracking)
CREATE OR REPLACE VIEW device_status_summary AS
SELECT
    device_id,
    MAX(time) AS last_seen,
    COUNT(*) AS sample_count_24h,
    AVG(total_mbps) AS avg_throughput_24h,
    MAX(total_mbps) AS peak_throughput_24h,
    AVG(cpu_data_plane) AS avg_cpu_24h,
    MAX(cpu_data_plane) AS peak_cpu_24h,
    AVG(memory_used_pct) AS avg_memory_24h
FROM throughput_samples
WHERE time > NOW() - INTERVAL '24 hours'
GROUP BY device_id;

-- =========================================
-- Grant Permissions
-- =========================================
-- Allow panfm user to read/write all tables and views

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO panfm;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO panfm;
GRANT USAGE ON SCHEMA public TO panfm;

-- Grant permissions on continuous aggregates
GRANT SELECT ON throughput_hourly TO panfm;
GRANT SELECT ON throughput_daily TO panfm;

-- Grant permissions on views
GRANT SELECT ON latest_throughput TO panfm;
GRANT SELECT ON device_status_summary TO panfm;

-- =========================================
-- Database Settings Optimization
-- =========================================
-- Optimize PostgreSQL settings for time-series workload

-- Increase shared buffers for better caching
-- (Requires Docker memory limit >= 4GB)
ALTER SYSTEM SET shared_buffers = '1GB';

-- Increase work_mem for complex aggregations
ALTER SYSTEM SET work_mem = '64MB';

-- Increase maintenance_work_mem for faster compression/vacuum
ALTER SYSTEM SET maintenance_work_mem = '512MB';

-- Enable parallel query execution
ALTER SYSTEM SET max_parallel_workers_per_gather = 4;
ALTER SYSTEM SET max_parallel_workers = 8;

-- Optimize for time-series write workload
ALTER SYSTEM SET random_page_cost = 1.1;  -- SSD storage

-- Enable query result caching
ALTER SYSTEM SET shared_preload_libraries = 'timescaledb';

-- =========================================
-- Initialization Complete
-- =========================================
-- TimescaleDB is now configured for PANfm v2.0.0
--
-- Key features enabled:
-- ✓ Hypertables with 1-day chunks
-- ✓ Continuous aggregates (hourly, daily)
-- ✓ Retention policies (7d raw → 90d hourly → 1y daily)
-- ✓ Compression (90% storage reduction)
-- ✓ Optimized indexes
-- ✓ Helper views
--
-- Next steps:
-- 1. Start TimescaleDB container
-- 2. Run migration script (migrate_sqlite_to_timescale.py)
-- 3. Update app to use TimescaleStorage
-- 4. Test time-range queries
-- =========================================
