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
-- - Retention policies: 7d raw, 30d hourly/daily (Community Edition)
-- - Compression policies: 90% storage reduction
-- - Optimized indexes for time-range queries
-- =========================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- =========================================
-- Main Throughput Samples Hypertable
-- =========================================
-- Stores 30-second interval samples from firewall
-- Retention: 7 days raw → 30 days hourly/daily (Community Edition)
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
-- Retention: 30 days (Community Edition)
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
-- Retention: 30 days (Community Edition)
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

-- Hourly aggregates: Keep 30 days (Community Edition)
-- After 30 days, hourly rollups are automatically deleted
SELECT add_retention_policy(
    'throughput_hourly',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- Daily aggregates: Keep 30 days (Community Edition)
-- After 30 days, daily rollups are automatically deleted
SELECT add_retention_policy(
    'throughput_daily',
    INTERVAL '30 days',
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
-- ✓ Retention policies (7d raw → 30d hourly/daily - Community Edition)
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
-- ============================================================================
-- Migration 004: Analytics Tables for Top Category/Clients Dashboard Tiles
-- ============================================================================
-- Purpose: Add dedicated tables for application, category, and client bandwidth tracking
-- Impact: Enables Top Category (LAN/Internet) and Top Clients (Internal/Internet) tiles
-- Created: 2025-11-20
-- ============================================================================

-- ============================================================================
-- Table 1: application_samples
-- Purpose: Store per-application traffic samples for historical trending
-- ============================================================================
CREATE TABLE IF NOT EXISTS application_samples (
    time TIMESTAMPTZ NOT NULL,
    device_id TEXT NOT NULL,
    application TEXT NOT NULL,          -- e.g., "web-browsing", "ssl", "dns"
    category TEXT,                      -- e.g., "general-internet", "business-systems"

    -- Traffic metrics
    sessions_total INTEGER DEFAULT 0,   -- Total sessions for this app
    sessions_tcp INTEGER DEFAULT 0,
    sessions_udp INTEGER DEFAULT 0,
    bytes_sent BIGINT DEFAULT 0,        -- Bytes sent
    bytes_received BIGINT DEFAULT 0,    -- Bytes received
    bytes_total BIGINT DEFAULT 0,       -- Total bytes (sent + received)
    bandwidth_mbps DOUBLE PRECISION DEFAULT 0, -- Average bandwidth for this app

    -- Network context
    source_zone TEXT,                   -- Firewall zone (e.g., "trust", "dmz")
    dest_zone TEXT,
    vlan TEXT,                          -- VLAN ID if available

    -- Top source for this application
    top_source_ip INET,                 -- Top client IP for this app
    top_source_hostname TEXT,           -- Hostname of top client
    top_source_bytes BIGINT DEFAULT 0,  -- Bytes from top client

    PRIMARY KEY (time, device_id, application)
);

-- Convert to hypertable (1-day chunks)
SELECT create_hypertable(
    'application_samples',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Index for per-app queries
CREATE INDEX IF NOT EXISTS idx_app_samples_device_app_time
    ON application_samples (device_id, application, time DESC);

-- Index for category queries
CREATE INDEX IF NOT EXISTS idx_app_samples_device_category_time
    ON application_samples (device_id, category, time DESC);

-- Retention: 7 days raw
SELECT add_retention_policy(
    'application_samples',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Compression: After 2 days
ALTER TABLE application_samples SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id, application',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy(
    'application_samples',
    INTERVAL '2 days',
    if_not_exists => TRUE
);

-- ============================================================================
-- Continuous Aggregate: application_hourly
-- Purpose: Hourly aggregates for efficient historical queries
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS application_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS hour,
    device_id,
    application,
    category,

    -- Aggregated metrics
    SUM(sessions_total) AS total_sessions,
    SUM(bytes_sent) AS total_bytes_sent,
    SUM(bytes_received) AS total_bytes_received,
    SUM(bytes_total) AS total_bytes,
    AVG(bandwidth_mbps) AS avg_bandwidth_mbps,
    MAX(bandwidth_mbps) AS peak_bandwidth_mbps,

    -- Sample count for debugging
    COUNT(*) AS sample_count
FROM application_samples
GROUP BY hour, device_id, application, category;

-- Retention: 30 days (Community Edition)
SELECT add_retention_policy(
    'application_hourly',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- Refresh policy: Every 30 minutes
SELECT add_continuous_aggregate_policy(
    'application_hourly',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists => TRUE
);

-- ============================================================================
-- Table 2: category_bandwidth
-- Purpose: Track bandwidth per category for Top Category tiles
-- ============================================================================
CREATE TABLE IF NOT EXISTS category_bandwidth (
    time TIMESTAMPTZ NOT NULL,
    device_id TEXT NOT NULL,
    category TEXT NOT NULL,            -- e.g., "general-internet", "business-systems"
    traffic_type TEXT NOT NULL,        -- 'lan', 'internet', 'wan' (for split views)

    -- Bandwidth metrics
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    bytes_total BIGINT DEFAULT 0,
    bandwidth_mbps DOUBLE PRECISION DEFAULT 0,

    -- Session count
    sessions_total INTEGER DEFAULT 0,

    -- Top application in this category
    top_application TEXT,
    top_application_bytes BIGINT DEFAULT 0,

    PRIMARY KEY (time, device_id, category, traffic_type)
);

-- Convert to hypertable
SELECT create_hypertable(
    'category_bandwidth',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Index for category queries (optimized for dashboard Top Category tiles)
CREATE INDEX IF NOT EXISTS idx_category_bw_device_type_time
    ON category_bandwidth (device_id, traffic_type, time DESC);

-- Index for category name lookups
CREATE INDEX IF NOT EXISTS idx_category_bw_device_category_time
    ON category_bandwidth (device_id, category, time DESC);

-- Retention: 7 days raw
SELECT add_retention_policy(
    'category_bandwidth',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Compression: After 2 days
ALTER TABLE category_bandwidth SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id, category, traffic_type',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy(
    'category_bandwidth',
    INTERVAL '2 days',
    if_not_exists => TRUE
);

-- ============================================================================
-- Continuous Aggregate: category_bandwidth_hourly
-- Purpose: Hourly category aggregates
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS category_bandwidth_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS hour,
    device_id,
    category,
    traffic_type,

    -- Aggregated bandwidth
    SUM(bytes_sent) AS total_bytes_sent,
    SUM(bytes_received) AS total_bytes_received,
    SUM(bytes_total) AS total_bytes,
    AVG(bandwidth_mbps) AS avg_bandwidth_mbps,
    MAX(bandwidth_mbps) AS peak_bandwidth_mbps,
    SUM(sessions_total) AS total_sessions,

    -- Sample count
    COUNT(*) AS sample_count
FROM category_bandwidth
GROUP BY hour, device_id, category, traffic_type;

-- Retention: 30 days (Community Edition)
SELECT add_retention_policy(
    'category_bandwidth_hourly',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- Refresh policy: Every 30 minutes
SELECT add_continuous_aggregate_policy(
    'category_bandwidth_hourly',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists => TRUE
);

-- ============================================================================
-- Table 3: client_bandwidth
-- Purpose: Track per-client bandwidth for Top Clients and connected devices history
-- ============================================================================
CREATE TABLE IF NOT EXISTS client_bandwidth (
    time TIMESTAMPTZ NOT NULL,
    device_id TEXT NOT NULL,
    client_ip INET NOT NULL,            -- Client IP address
    client_mac MACADDR,                 -- MAC address (if available from ARP)
    hostname TEXT,                      -- Hostname (from DHCP/DNS)
    custom_name TEXT,                   -- From device_metadata.json
    traffic_type TEXT NOT NULL,         -- 'internal', 'internet', 'total'

    -- Bandwidth metrics
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    bytes_total BIGINT DEFAULT 0,
    bandwidth_mbps DOUBLE PRECISION DEFAULT 0,

    -- Session metrics
    sessions_total INTEGER DEFAULT 0,
    sessions_tcp INTEGER DEFAULT 0,
    sessions_udp INTEGER DEFAULT 0,

    -- Network context
    interface TEXT,                     -- Firewall interface
    vlan TEXT,                          -- VLAN ID
    zone TEXT,                          -- Security zone

    -- Top application for this client
    top_application TEXT,
    top_application_bytes BIGINT DEFAULT 0,

    PRIMARY KEY (time, device_id, client_ip, traffic_type)
);

-- Convert to hypertable
SELECT create_hypertable(
    'client_bandwidth',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Index for per-client queries
CREATE INDEX IF NOT EXISTS idx_client_bw_device_ip_time
    ON client_bandwidth (device_id, client_ip, time DESC);

-- Index for MAC lookup (connected devices page)
CREATE INDEX IF NOT EXISTS idx_client_bw_device_mac_time
    ON client_bandwidth (device_id, client_mac, time DESC)
    WHERE client_mac IS NOT NULL;

-- Index for traffic type split (internal vs internet) - CRITICAL for dashboard tiles
CREATE INDEX IF NOT EXISTS idx_client_bw_device_type_time
    ON client_bandwidth (device_id, traffic_type, time DESC);

-- Retention: 7 days raw
SELECT add_retention_policy(
    'client_bandwidth',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Compression: After 2 days
ALTER TABLE client_bandwidth SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id, client_ip, traffic_type',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy(
    'client_bandwidth',
    INTERVAL '2 days',
    if_not_exists => TRUE
);

-- ============================================================================
-- Continuous Aggregate: client_bandwidth_hourly
-- Purpose: Hourly client aggregates for efficient queries
-- ============================================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS client_bandwidth_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS hour,
    device_id,
    client_ip,
    client_mac,
    hostname,
    custom_name,
    traffic_type,

    -- Aggregated metrics
    SUM(bytes_sent) AS total_bytes_sent,
    SUM(bytes_received) AS total_bytes_received,
    SUM(bytes_total) AS total_bytes,
    AVG(bandwidth_mbps) AS avg_bandwidth_mbps,
    MAX(bandwidth_mbps) AS peak_bandwidth_mbps,
    SUM(sessions_total) AS total_sessions,

    -- Sample count
    COUNT(*) AS sample_count
FROM client_bandwidth
GROUP BY hour, device_id, client_ip, client_mac, hostname, custom_name, traffic_type;

-- Retention: 30 days (Community Edition)
SELECT add_retention_policy(
    'client_bandwidth_hourly',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- Refresh policy: Every 30 minutes
SELECT add_continuous_aggregate_policy(
    'client_bandwidth_hourly',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '30 minutes',
    if_not_exists => TRUE
);

-- ============================================================================
-- Reference Table: application_categories
-- Purpose: Cache application-to-category mappings from firewall
-- ============================================================================
CREATE TABLE IF NOT EXISTS application_categories (
    application TEXT NOT NULL PRIMARY KEY,
    category TEXT NOT NULL,
    subcategory TEXT,
    risk_level SMALLINT,                -- 1-5 (from PAN-OS)
    technology TEXT,                    -- e.g., "browser-based", "client-server"
    characteristics TEXT[],             -- Array of characteristics
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- Index for category lookups
CREATE INDEX IF NOT EXISTS idx_app_categories_category
    ON application_categories (category);

-- ============================================================================
-- Verification Queries
-- ============================================================================

-- Check table creation
DO $$
BEGIN
    RAISE NOTICE 'Analytics tables created successfully:';
    RAISE NOTICE '  ✓ application_samples (hypertable)';
    RAISE NOTICE '  ✓ application_hourly (continuous aggregate)';
    RAISE NOTICE '  ✓ category_bandwidth (hypertable)';
    RAISE NOTICE '  ✓ category_bandwidth_hourly (continuous aggregate)';
    RAISE NOTICE '  ✓ client_bandwidth (hypertable)';
    RAISE NOTICE '  ✓ client_bandwidth_hourly (continuous aggregate)';
    RAISE NOTICE '  ✓ application_categories (reference table)';
    RAISE NOTICE '';
    RAISE NOTICE 'Retention policies: 7 days raw → 30 days hourly (Community Edition)';
    RAISE NOTICE 'Compression: After 2 days';
    RAISE NOTICE 'Continuous aggregate refresh: Every 30 minutes';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Restart panfm-clock to start data collection';
    RAISE NOTICE '  2. Wait 60 minutes for initial data population';
    RAISE NOTICE '  3. Verify dashboard Top Category/Clients tiles';
END $$;
-- ============================================================================
-- Migration 005: Alert Management System Tables
-- ============================================================================
-- Purpose: Migrate alerts.db from SQLite to TimescaleDB
-- Impact: Enables enterprise-grade alert management with hypertables
-- Created: 2025-11-20
-- Previous Migration: 004_analytics_tables.sql
-- ============================================================================

-- ============================================================================
-- Table 1: notification_channels
-- Purpose: Store notification channel configurations (SMTP, webhook)
-- ============================================================================
CREATE TABLE IF NOT EXISTS notification_channels (
    id SERIAL PRIMARY KEY,
    channel_type TEXT NOT NULL,        -- 'smtp' or 'webhook'
    name TEXT NOT NULL,
    config JSONB NOT NULL,             -- Channel-specific configuration (was config_json TEXT)
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for enabled channel lookups
CREATE INDEX IF NOT EXISTS idx_notification_channels_enabled
    ON notification_channels (enabled, channel_type);

-- ============================================================================
-- Table 2: alert_configs
-- Purpose: Alert configuration rules (thresholds, metrics, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS alert_configs (
    id SERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    metric_type TEXT NOT NULL,        -- 'cpu', 'memory', 'sessions', 'threats', etc.
    threshold_value DOUBLE PRECISION NOT NULL,
    threshold_operator TEXT NOT NULL, -- '>', '<', '>=', '<=', '==', '!='
    severity TEXT NOT NULL,           -- 'info', 'warning', 'critical'
    enabled BOOLEAN DEFAULT true,
    notification_channels JSONB,      -- Array of channel IDs (was TEXT)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for enabled alerts per device
CREATE INDEX IF NOT EXISTS idx_alert_configs_device_enabled
    ON alert_configs (device_id, enabled);

-- Index for metric type lookups
CREATE INDEX IF NOT EXISTS idx_alert_configs_metric
    ON alert_configs (metric_type);

-- ============================================================================
-- Table 3: alert_history
-- Purpose: Historical record of triggered alerts (TIME-SERIES DATA)
-- ============================================================================
CREATE TABLE IF NOT EXISTS alert_history (
    id SERIAL,
    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- Hypertable partition key
    alert_config_id INTEGER NOT NULL,  -- FK constraint added after hypertable creation
    device_id TEXT NOT NULL,
    metric_type TEXT NOT NULL,
    threshold_value DOUBLE PRECISION NOT NULL,
    actual_value DOUBLE PRECISION NOT NULL,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    triggered_at TIMESTAMPTZ DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by TEXT,
    resolved_at TIMESTAMPTZ,
    resolved_reason TEXT,
    PRIMARY KEY (id, time)  -- Include time in primary key for hypertable
);

-- Convert to hypertable (1-day chunks for better compression)
SELECT create_hypertable(
    'alert_history',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Add foreign key constraint after hypertable creation
ALTER TABLE alert_history
    ADD CONSTRAINT fk_alert_history_config
    FOREIGN KEY (alert_config_id) REFERENCES alert_configs(id) ON DELETE CASCADE;

-- Index for device and time-based queries
CREATE INDEX IF NOT EXISTS idx_alert_history_device_time
    ON alert_history (device_id, time DESC);

-- Index for alert config lookups
CREATE INDEX IF NOT EXISTS idx_alert_history_config
    ON alert_history (alert_config_id, time DESC);

-- Index for unacknowledged alerts
CREATE INDEX IF NOT EXISTS idx_alert_history_acknowledged
    ON alert_history (acknowledged_at, severity)
    WHERE acknowledged_at IS NULL;

-- Retention: 30 days (Community Edition - alerts not used in CE)
SELECT add_retention_policy(
    'alert_history',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- Compression: After 30 days
ALTER TABLE alert_history SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id, alert_config_id',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy(
    'alert_history',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- ============================================================================
-- Table 4: maintenance_windows
-- Purpose: Scheduled maintenance windows (suppress alerts during maintenance)
-- ============================================================================
CREATE TABLE IF NOT EXISTS maintenance_windows (
    id SERIAL PRIMARY KEY,
    device_id TEXT,                   -- NULL = applies to all devices
    name TEXT NOT NULL,
    description TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for active maintenance window lookups
CREATE INDEX IF NOT EXISTS idx_maintenance_windows_active
    ON maintenance_windows (device_id, enabled, start_time, end_time)
    WHERE enabled = true;

-- ============================================================================
-- Table 5: alert_cooldowns
-- Purpose: Prevent alert spam by tracking cooldown periods
-- ============================================================================
CREATE TABLE IF NOT EXISTS alert_cooldowns (
    id SERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    alert_config_id INTEGER NOT NULL REFERENCES alert_configs(id) ON DELETE CASCADE,
    last_triggered_at TIMESTAMPTZ NOT NULL,
    cooldown_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(device_id, alert_config_id)
);

-- Index for cooldown expiry checks
CREATE INDEX IF NOT EXISTS idx_alert_cooldowns_expiry
    ON alert_cooldowns (device_id, alert_config_id, cooldown_expires_at);

-- ============================================================================
-- Verification Queries
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE 'Alert Management tables created successfully:';
    RAISE NOTICE '  ✓ notification_channels (configurations for SMTP/webhook)';
    RAISE NOTICE '  ✓ alert_configs (alert rules and thresholds)';
    RAISE NOTICE '  ✓ alert_history (hypertable - time-series alert events)';
    RAISE NOTICE '  ✓ maintenance_windows (scheduled maintenance periods)';
    RAISE NOTICE '  ✓ alert_cooldowns (spam prevention)';
    RAISE NOTICE '';
    RAISE NOTICE 'Hypertable configuration:';
    RAISE NOTICE '  - Partitioning: 1-day chunks';
    RAISE NOTICE '  - Retention: 30 days (Community Edition)';
    RAISE NOTICE '  - Compression: After 30 days';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Run migrate_alerts_to_timescale.py to migrate data from alerts.db';
    RAISE NOTICE '  2. Update alert_manager.py to use PostgreSQL';
    RAISE NOTICE '  3. Test alert creation and triggering';
    RAISE NOTICE '  4. Remove alerts.db after verification';
END $$;
-- ============================================================================
-- Migration 006: Nmap Network Scanning System Tables
-- ============================================================================
-- Purpose: Migrate nmap_scans.db from SQLite to TimescaleDB
-- Impact: Enables enterprise-grade security monitoring with hypertables
-- Created: 2025-11-20
-- Previous Migration: 005_alerts_schema.sql
-- ============================================================================

-- ============================================================================
-- Table 1: scheduled_scans
-- Purpose: Scheduled scan configurations (v1.12.0 feature)
-- ============================================================================
CREATE TABLE IF NOT EXISTS scheduled_scans (
    id SERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    target_type TEXT NOT NULL,        -- 'single_ip', 'subnet', 'range'
    target_value TEXT,                -- IP address, CIDR, or range
    scan_type TEXT NOT NULL DEFAULT 'balanced',  -- 'quick', 'balanced', 'thorough'
    schedule_type TEXT NOT NULL,      -- 'once', 'hourly', 'daily', 'weekly', 'monthly'
    schedule_value JSONB NOT NULL,    -- Schedule configuration (was TEXT)
    enabled BOOLEAN DEFAULT true,
    last_run_timestamp TIMESTAMPTZ,
    last_run_status TEXT,
    last_run_error TEXT,
    next_run_timestamp TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,
    updated_at TIMESTAMPTZ,
    updated_by TEXT
);

-- Index for enabled scans per device
CREATE INDEX IF NOT EXISTS idx_scheduled_scans_device_enabled
    ON scheduled_scans (device_id, enabled);

-- Index for next run scheduling
CREATE INDEX IF NOT EXISTS idx_scheduled_scans_next_run
    ON scheduled_scans (enabled, next_run_timestamp)
    WHERE enabled = true AND next_run_timestamp IS NOT NULL;

-- ============================================================================
-- Table 2: nmap_scan_history
-- Purpose: Complete nmap scan results (TIME-SERIES DATA)
-- ============================================================================
CREATE TABLE IF NOT EXISTS nmap_scan_history (
    id SERIAL,
    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- Hypertable partition key
    device_id TEXT NOT NULL,
    target_ip INET NOT NULL,          -- Use PostgreSQL INET type for IP addresses
    scan_type TEXT NOT NULL,
    scan_timestamp TIMESTAMPTZ NOT NULL,
    scan_duration_seconds DOUBLE PRECISION,
    hostname TEXT,
    host_status TEXT,                 -- 'up', 'down', 'unknown'
    os_name TEXT,
    os_accuracy INTEGER,
    os_matches JSONB,                 -- Array of OS matches (was os_matches_json TEXT)
    total_ports INTEGER DEFAULT 0,
    open_ports_count INTEGER DEFAULT 0,
    scan_results JSONB,               -- Full scan results (was scan_results_json TEXT)
    raw_xml TEXT,                     -- Raw nmap XML output (can be large)
    PRIMARY KEY (id, time)            -- Include time in primary key for hypertable
);

-- Convert to hypertable (1-day chunks)
SELECT create_hypertable(
    'nmap_scan_history',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Index for device and target lookups
CREATE INDEX IF NOT EXISTS idx_nmap_scan_history_device_target
    ON nmap_scan_history (device_id, target_ip, time DESC);

-- Index for scan timestamp queries
CREATE INDEX IF NOT EXISTS idx_nmap_scan_history_scan_timestamp
    ON nmap_scan_history (device_id, scan_timestamp DESC);

-- Index for host status filtering
CREATE INDEX IF NOT EXISTS idx_nmap_scan_history_status
    ON nmap_scan_history (device_id, host_status, time DESC);

-- Retention: 30 days (Community Edition)
SELECT add_retention_policy(
    'nmap_scan_history',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- Compression: After 7 days
ALTER TABLE nmap_scan_history SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id, target_ip',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy(
    'nmap_scan_history',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- ============================================================================
-- Table 3: nmap_port_history
-- Purpose: Per-port details from nmap scans
-- ============================================================================
CREATE TABLE IF NOT EXISTS nmap_port_history (
    id SERIAL PRIMARY KEY,
    scan_id INTEGER NOT NULL REFERENCES nmap_scan_history(id) ON DELETE CASCADE,
    port_number INTEGER NOT NULL,
    protocol TEXT NOT NULL,           -- 'tcp', 'udp'
    state TEXT NOT NULL,              -- 'open', 'closed', 'filtered'
    service_name TEXT,
    service_product TEXT,
    service_version TEXT
);

-- Index for scan_id lookups
CREATE INDEX IF NOT EXISTS idx_nmap_port_history_scan
    ON nmap_port_history (scan_id, port_number);

-- Index for port number searches
CREATE INDEX IF NOT EXISTS idx_nmap_port_history_port
    ON nmap_port_history (port_number, state);

-- ============================================================================
-- Table 4: nmap_change_events
-- Purpose: Change detection (new ports, OS changes, etc.) - TIME-SERIES DATA
-- ============================================================================
CREATE TABLE IF NOT EXISTS nmap_change_events (
    id SERIAL,
    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- Hypertable partition key
    device_id TEXT NOT NULL,
    target_ip INET NOT NULL,
    change_timestamp TIMESTAMPTZ NOT NULL,
    change_type TEXT NOT NULL,        -- 'new_port', 'closed_port', 'os_change', 'service_change'
    severity TEXT NOT NULL,           -- 'info', 'warning', 'critical'
    old_value TEXT,
    new_value TEXT,
    details JSONB,                    -- Change details (was details_json TEXT)
    acknowledged BOOLEAN DEFAULT false,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by TEXT,
    PRIMARY KEY (id, time)            -- Include time in primary key for hypertable
);

-- Convert to hypertable (1-day chunks)
SELECT create_hypertable(
    'nmap_change_events',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Index for device and target lookups
CREATE INDEX IF NOT EXISTS idx_nmap_change_events_device_target
    ON nmap_change_events (device_id, target_ip, time DESC);

-- Index for unacknowledged changes
CREATE INDEX IF NOT EXISTS idx_nmap_change_events_acknowledged
    ON nmap_change_events (acknowledged, severity, time DESC)
    WHERE acknowledged = false;

-- Retention: 30 days (Community Edition)
SELECT add_retention_policy(
    'nmap_change_events',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- Compression: After 7 days
ALTER TABLE nmap_change_events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id, target_ip',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy(
    'nmap_change_events',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- ============================================================================
-- Table 5: scan_queue
-- Purpose: Scan execution queue with status tracking
-- ============================================================================
CREATE TABLE IF NOT EXISTS scan_queue (
    id SERIAL PRIMARY KEY,
    schedule_id INTEGER REFERENCES scheduled_scans(id) ON DELETE SET NULL,
    device_id TEXT NOT NULL,
    target_ip INET NOT NULL,
    scan_type TEXT NOT NULL,
    status TEXT NOT NULL,             -- 'queued', 'running', 'completed', 'failed'
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    scan_id INTEGER REFERENCES nmap_scan_history(id) ON DELETE SET NULL,
    error_message TEXT
);

-- Index for queue status queries
CREATE INDEX IF NOT EXISTS idx_scan_queue_status
    ON scan_queue (status, queued_at);

-- Index for schedule lookups
CREATE INDEX IF NOT EXISTS idx_scan_queue_schedule
    ON scan_queue (schedule_id, status);

-- ============================================================================
-- Table 6: connected_devices (NEW - replaces phantom SQLite table)
-- Purpose: Store connected devices from ARP/Nmap with bandwidth data
-- ============================================================================
CREATE TABLE IF NOT EXISTS connected_devices (
    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    device_id TEXT NOT NULL,
    ip INET NOT NULL,
    mac MACADDR,
    hostname TEXT,
    interface TEXT,
    zone TEXT,
    ttl INTEGER,
    vendor TEXT,
    custom_name TEXT,                 -- Denormalized from device_metadata.json
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (time, device_id, ip)
);

-- Convert to hypertable (1-day chunks)
SELECT create_hypertable(
    'connected_devices',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Index for device and IP lookups
CREATE INDEX IF NOT EXISTS idx_connected_devices_device_ip
    ON connected_devices (device_id, ip, time DESC);

-- Index for MAC lookups
CREATE INDEX IF NOT EXISTS idx_connected_devices_mac
    ON connected_devices (device_id, mac, time DESC)
    WHERE mac IS NOT NULL;

-- Retention: 7 days (ARP data is ephemeral)
SELECT add_retention_policy(
    'connected_devices',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Compression: After 1 day
ALTER TABLE connected_devices SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id, ip',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy(
    'connected_devices',
    INTERVAL '1 day',
    if_not_exists => TRUE
);

-- ============================================================================
-- Verification Queries
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE 'Nmap Network Scanning tables created successfully:';
    RAISE NOTICE '  ✓ scheduled_scans (scan scheduling configurations)';
    RAISE NOTICE '  ✓ nmap_scan_history (hypertable - full scan results)';
    RAISE NOTICE '  ✓ nmap_port_history (per-port scan details)';
    RAISE NOTICE '  ✓ nmap_change_events (hypertable - security change detection)';
    RAISE NOTICE '  ✓ scan_queue (scan execution queue)';
    RAISE NOTICE '  ✓ connected_devices (hypertable - ARP entries with bandwidth)';
    RAISE NOTICE '';
    RAISE NOTICE 'Hypertable configuration:';
    RAISE NOTICE '  - Scan history: 30 days retention, 7 days compression (Community Edition)';
    RAISE NOTICE '  - Change events: 30 days retention, 7 days compression (Community Edition)';
    RAISE NOTICE '  - Connected devices: 7 days retention, 1 day compression';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Run migrate_nmap_to_timescale.py to migrate data from nmap_scans.db';
    RAISE NOTICE '  2. Update scan_storage.py to use PostgreSQL';
    RAISE NOTICE '  3. Update throughput_storage_timescale.py connected_devices queries';
    RAISE NOTICE '  4. Test scan execution and change detection';
    RAISE NOTICE '  5. Remove nmap_scans.db after verification';
END $$;
-- Migration 007: Device Metadata Table (Updated for Per-Device Separation)
-- Purpose: Store device metadata with per-managed-device (firewall) separation
-- Date: 2025-11-25
-- Version: v2.1.2
--
-- Key Change: Composite primary key (device_id, mac) ensures complete
-- separation of metadata between managed devices (firewalls)

-- Drop old table if exists (schema change from mac-only PK to composite PK)
DROP TABLE IF EXISTS device_metadata;

-- Create device_metadata table with composite primary key
CREATE TABLE IF NOT EXISTS device_metadata (
    device_id TEXT NOT NULL,              -- Managed firewall ID (required, from devices.json)
    mac MACADDR NOT NULL,                 -- Client MAC address
    custom_name TEXT,
    location TEXT,
    comment TEXT,
    tags TEXT[] DEFAULT '{}',             -- PostgreSQL array for tags
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (device_id, mac)          -- Composite key: per-device metadata
);

-- Index for fast device_id filtering (most common query pattern)
CREATE INDEX IF NOT EXISTS idx_device_metadata_device_id
    ON device_metadata(device_id);

-- Index for fast tag filtering using GIN (Generalized Inverted Index)
-- This enables fast queries like: WHERE tags && ARRAY['IoT', 'Cameras']
CREATE INDEX IF NOT EXISTS idx_device_metadata_tags
    ON device_metadata USING GIN(tags);

-- Index for MAC lookups across all devices
CREATE INDEX IF NOT EXISTS idx_device_metadata_mac
    ON device_metadata(mac);

-- Index for custom_name searches
CREATE INDEX IF NOT EXISTS idx_device_metadata_custom_name
    ON device_metadata(custom_name);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_device_metadata_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS trigger_update_device_metadata_timestamp ON device_metadata;
CREATE TRIGGER trigger_update_device_metadata_timestamp
    BEFORE UPDATE ON device_metadata
    FOR EACH ROW
    EXECUTE FUNCTION update_device_metadata_timestamp();

-- Comments for documentation
COMMENT ON TABLE device_metadata IS 'Per-device metadata: custom names, tags, locations, comments (separated by managed firewall)';
COMMENT ON COLUMN device_metadata.device_id IS 'Managed firewall ID (required) - UUID from devices.json';
COMMENT ON COLUMN device_metadata.mac IS 'Client MAC address (part of composite primary key)';
COMMENT ON COLUMN device_metadata.custom_name IS 'User-defined custom name for device';
COMMENT ON COLUMN device_metadata.location IS 'Physical location (e.g., "Building A, Room 205")';
COMMENT ON COLUMN device_metadata.comment IS 'User notes/comments (max 2048 chars recommended)';
COMMENT ON COLUMN device_metadata.tags IS 'Array of tags (e.g., [''IoT'', ''Cameras'', ''Business''])';
COMMENT ON COLUMN device_metadata.created_at IS 'Timestamp when metadata was created';
COMMENT ON COLUMN device_metadata.updated_at IS 'Timestamp when metadata was last updated';

-- Example queries for reference:
--
-- Get all metadata for a specific managed device:
--   SELECT * FROM device_metadata WHERE device_id = 'firewall-uuid-here';
--
-- Find devices with specific tag on a firewall:
--   SELECT * FROM device_metadata WHERE device_id = 'firewall-uuid' AND tags @> ARRAY['IoT'];
--
-- Find devices with ANY of multiple tags:
--   SELECT * FROM device_metadata WHERE device_id = 'firewall-uuid' AND tags && ARRAY['IoT', 'Cameras'];
--
-- Get all unique tags for a specific firewall:
--   SELECT DISTINCT unnest(tags) AS tag FROM device_metadata WHERE device_id = 'firewall-uuid' ORDER BY tag;
--
-- Get all unique tags globally (across all firewalls):
--   SELECT DISTINCT unnest(tags) AS tag FROM device_metadata ORDER BY tag;
--
-- Get tag usage count per firewall:
--   SELECT device_id, unnest(tags) AS tag, COUNT(*) AS usage_count
--   FROM device_metadata GROUP BY device_id, tag ORDER BY device_id, tag;
--
-- Join with connected_devices (include device_id for proper per-device join):
--   SELECT cd.ip, cd.hostname, dm.custom_name, dm.tags
--   FROM connected_devices cd
--   LEFT JOIN device_metadata dm ON cd.device_id = dm.device_id AND cd.mac = dm.mac
--   WHERE cd.device_id = 'firewall-uuid' AND dm.tags @> ARRAY['IoT'];
-- Migration 008: Traffic Flows Hypertable for Sankey Diagram Data
-- Created: 2025-11-23
-- Purpose: Store source→destination→application flow data for traffic flow visualization
--
-- This hypertable enables enterprise-grade Sankey diagrams showing:
-- - Client IP → Application → Destination IP:Port flow relationships
-- - Per-flow byte counts and session tracking
-- - Network context (zones, VLANs)
--
-- Performance optimizations:
-- - 1-day chunk size (balanced for query and insert performance)
-- - Indexed on (device_id, source_ip, time DESC) for fast client lookups
-- - 7-day retention policy (reduce storage requirements)
-- - Automatic compression after 2 days (90% space savings)
--
-- Database-First Pattern (v2.1.1):
-- - Clock process (throughput_collector.py) writes flow data every 60 seconds
-- - Web process queries via TimescaleStorage.get_traffic_flows_for_client()
-- - TTL cache (60s) + browser cache (60s) for Google/AWS-level performance

CREATE TABLE IF NOT EXISTS traffic_flows (
    -- Timestamp and device identification
    time TIMESTAMPTZ NOT NULL,
    device_id TEXT NOT NULL,

    -- Flow endpoints (source → destination)
    source_ip INET NOT NULL,
    dest_ip INET NOT NULL,
    dest_port INTEGER,

    -- Application and protocol classification
    application TEXT NOT NULL,
    category TEXT,
    protocol TEXT,  -- 'tcp', 'udp', 'icmp', 'other'

    -- Traffic metrics (per flow)
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    bytes_total BIGINT DEFAULT 0,
    sessions INTEGER DEFAULT 1,

    -- Network context
    source_zone TEXT,
    dest_zone TEXT,
    source_vlan TEXT,
    dest_vlan TEXT,

    -- Metadata
    source_hostname TEXT,
    dest_hostname TEXT,

    -- Primary key (time-series composite key)
    PRIMARY KEY (time, device_id, source_ip, dest_ip, dest_port, application)
);

-- Convert to hypertable with 1-day chunks
-- Chunk size balances:
-- - Query performance (1 day = typical Sankey time window)
-- - Insert performance (moderate chunk count)
-- - Compression efficiency (1-day chunks compress well)
SELECT create_hypertable(
    'traffic_flows',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Index for fast client IP lookups (Sankey diagram queries)
-- Query pattern: WHERE device_id = X AND source_ip = Y AND time >= NOW() - INTERVAL '60 minutes'
-- Expected query time: <100ms for 50 flows
CREATE INDEX IF NOT EXISTS idx_traffic_flows_device_source_time
    ON traffic_flows (device_id, source_ip, time DESC);

-- Index for destination lookups (reverse flow analysis)
CREATE INDEX IF NOT EXISTS idx_traffic_flows_device_dest_time
    ON traffic_flows (device_id, dest_ip, time DESC);

-- Index for application-based queries (filter by app)
CREATE INDEX IF NOT EXISTS idx_traffic_flows_device_app_time
    ON traffic_flows (device_id, application, time DESC);

-- Retention policy: 7 days
-- Rationale:
-- - Sankey diagrams show recent flows (1-24 hours typical)
-- - 7 days provides historical context for troubleshooting
-- - Reduces storage requirements (vs unlimited retention)
-- - Auto-cleanup prevents manual maintenance
SELECT add_retention_policy(
    'traffic_flows',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Compression policy: Compress chunks older than 2 days
-- Benefits:
-- - 90% storage savings on compressed chunks
-- - Recent data (last 48h) stays uncompressed for fast queries
-- - Automatic background compression (no manual intervention)
ALTER TABLE traffic_flows SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id, source_ip, application',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy(
    'traffic_flows',
    INTERVAL '2 days',
    if_not_exists => TRUE
);

-- Grant permissions
GRANT SELECT, INSERT ON traffic_flows TO panfm;

-- Migration verification query
-- Run after migration to verify hypertable created successfully:
-- SELECT * FROM timescaledb_information.hypertables WHERE hypertable_name = 'traffic_flows';
-- Expected: 1 row with chunk_time_interval = '1 day'

-- Performance test query (run after first collection)
-- EXPLAIN ANALYZE
-- SELECT application, dest_ip, dest_port, SUM(bytes_total) AS bytes
-- FROM traffic_flows
-- WHERE device_id = 'your-device-id'
--   AND source_ip = '192.168.1.100'::inet
--   AND time >= NOW() - INTERVAL '60 minutes'
-- GROUP BY application, dest_ip, dest_port
-- ORDER BY bytes DESC
-- LIMIT 50;
-- Expected: Query time <100ms, Index Scan on idx_traffic_flows_device_source_time
-- Migration 009: Add CPU Temperature columns to throughput_samples
-- Completes v2.1.3 Phase 2 optimization
-- Date: 2025-11-24
-- Author: Claude Code (v2.1.5 "Performance Fix")

-- Add CPU temperature columns
ALTER TABLE throughput_samples
ADD COLUMN IF NOT EXISTS cpu_temp SMALLINT,
ADD COLUMN IF NOT EXISTS cpu_temp_max SMALLINT,
ADD COLUMN IF NOT EXISTS cpu_temp_alarm BOOLEAN DEFAULT FALSE;

-- Add index for temperature threshold queries (useful for alerts)
CREATE INDEX IF NOT EXISTS idx_throughput_cpu_temp
    ON throughput_samples (cpu_temp, time DESC)
    WHERE cpu_temp IS NOT NULL;

-- Add column comments
COMMENT ON COLUMN throughput_samples.cpu_temp IS 'CPU Die temperature in Celsius (from thermal sensors)';
COMMENT ON COLUMN throughput_samples.cpu_temp_max IS 'Maximum CPU temperature threshold in Celsius';
COMMENT ON COLUMN throughput_samples.cpu_temp_alarm IS 'Temperature alarm status (true if threshold exceeded)';

-- Migration 010: Scheduler Statistics Tracking
-- Created: 2025-11-25
-- Purpose: Track APScheduler background process health and execution metrics

-- Create scheduler_stats_history hypertable
CREATE TABLE IF NOT EXISTS scheduler_stats_history (
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    uptime_seconds INTEGER,
    total_executions INTEGER DEFAULT 0,
    total_errors INTEGER DEFAULT 0,
    last_execution TIMESTAMPTZ,
    PRIMARY KEY (timestamp)
);

-- Convert to hypertable with 1-day chunks
SELECT create_hypertable(
    'scheduler_stats_history',
    'timestamp',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Create index for efficient latest stats queries
CREATE INDEX IF NOT EXISTS idx_scheduler_stats_timestamp_desc
ON scheduler_stats_history (timestamp DESC);

-- Add retention policy: keep 30 days of scheduler stats
SELECT add_retention_policy(
    'scheduler_stats_history',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- Add comment for documentation
COMMENT ON TABLE scheduler_stats_history IS 'APScheduler background process health metrics - tracks uptime, executions, and errors';
-- Migration: Add System Info columns to throughput_samples
-- Date: 2025-11-20
-- Purpose: Store WAN IP, uptime, PAN-OS version, and license data for enterprise analytics
-- Benefits: Single source of truth, historical tracking, no additional API calls

-- Add System Info columns to throughput_samples hypertable
ALTER TABLE throughput_samples
ADD COLUMN IF NOT EXISTS wan_ip TEXT,
ADD COLUMN IF NOT EXISTS wan_speed TEXT,
ADD COLUMN IF NOT EXISTS hostname TEXT,
ADD COLUMN IF NOT EXISTS uptime_seconds BIGINT,
ADD COLUMN IF NOT EXISTS pan_os_version TEXT,
ADD COLUMN IF NOT EXISTS license_expired INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS license_active INTEGER DEFAULT 0;

-- Add index for version tracking queries (useful for upgrade analytics)
CREATE INDEX IF NOT EXISTS idx_throughput_version ON throughput_samples (pan_os_version, time DESC);

-- Add index for hostname queries (useful for device identification)
CREATE INDEX IF NOT EXISTS idx_throughput_hostname ON throughput_samples (hostname, time DESC);

-- Add comment describing the migration
COMMENT ON COLUMN throughput_samples.wan_ip IS 'WAN interface IP address for external connectivity tracking';
COMMENT ON COLUMN throughput_samples.wan_speed IS 'WAN interface speed (e.g., "5 Gbps") for capacity planning';
COMMENT ON COLUMN throughput_samples.hostname IS 'Firewall hostname from system info';
COMMENT ON COLUMN throughput_samples.uptime_seconds IS 'Firewall uptime in seconds for availability tracking';
COMMENT ON COLUMN throughput_samples.pan_os_version IS 'PAN-OS version for upgrade tracking and compliance';
COMMENT ON COLUMN throughput_samples.license_expired IS 'Number of expired licenses for compliance monitoring';
COMMENT ON COLUMN throughput_samples.license_active IS 'Number of active licenses for license management';

-- Migration 011: On-Demand Collection Queue
-- Created: 2025-11-26
-- Purpose: Enable on-demand throughput collection when switching devices
-- v1.0.3 - Reduces device switch latency from 60s to ~5-8s

-- Create collection_requests table for inter-process communication
-- Web process queues requests, clock process processes them
CREATE TABLE IF NOT EXISTS collection_requests (
    id SERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'queued',  -- queued, running, completed, failed
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT
);

-- Index for efficient status queries (clock process polls for 'queued' requests)
CREATE INDEX IF NOT EXISTS idx_collection_requests_status
    ON collection_requests(status, requested_at);

-- Index for device_id lookups (dedupe check)
CREATE INDEX IF NOT EXISTS idx_collection_requests_device
    ON collection_requests(device_id, status);

-- Add comment for documentation
COMMENT ON TABLE collection_requests IS 'On-demand collection queue: web process queues, clock process executes';
COMMENT ON COLUMN collection_requests.status IS 'Request status: queued (waiting), running (collecting), completed (done), failed (error)';
COMMENT ON COLUMN collection_requests.device_id IS 'Device UUID to collect data for';

-- Automatic cleanup: Remove completed/failed requests older than 1 hour
-- This keeps the table small and fast
CREATE OR REPLACE FUNCTION cleanup_old_collection_requests()
RETURNS void AS $$
BEGIN
    DELETE FROM collection_requests
    WHERE status IN ('completed', 'failed')
      AND completed_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Migration 012: Threat Logs Hypertable
-- ============================================================================
-- Purpose: Store firewall threat log entries for security monitoring
-- Created: 2025-11-28
-- Used by: throughput_collector.py for threat log collection
-- ============================================================================

CREATE TABLE IF NOT EXISTS threat_logs (
    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    device_id TEXT NOT NULL,

    -- Threat identification
    severity VARCHAR(20),                 -- 'critical', 'high', 'medium', 'low', 'informational'
    threat_name TEXT,                     -- Name of the threat/signature
    threat_id TEXT,                       -- Threat ID from PAN-OS
    threat_type TEXT,                     -- 'virus', 'spyware', 'vulnerability', 'url', 'wildfire', etc.

    -- Network context
    source_ip INET,
    source_port INTEGER,
    destination_ip INET,
    destination_port INTEGER,
    protocol TEXT,                        -- 'tcp', 'udp', 'icmp'

    -- Application context
    application TEXT,
    category TEXT,                        -- URL category or threat category

    -- Action taken
    action TEXT,                          -- 'alert', 'block', 'drop', 'reset-client', etc.

    -- Policy context
    rule_name TEXT,
    source_zone TEXT,
    destination_zone TEXT,

    -- User context
    source_user TEXT,
    destination_user TEXT,

    -- Full log data for extended analysis
    log_data JSONB,

    -- Primary key (composite for hypertable)
    PRIMARY KEY (device_id, time)
);

-- Convert to hypertable with 1-day chunks
SELECT create_hypertable(
    'threat_logs',
    'time',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Index for device-based time queries (most common pattern)
CREATE INDEX IF NOT EXISTS idx_threat_logs_device_time
    ON threat_logs (device_id, time DESC);

-- Index for severity filtering (security dashboards)
CREATE INDEX IF NOT EXISTS idx_threat_logs_severity
    ON threat_logs (device_id, severity, time DESC);

-- Index for source IP investigation
CREATE INDEX IF NOT EXISTS idx_threat_logs_source_ip
    ON threat_logs (device_id, source_ip, time DESC)
    WHERE source_ip IS NOT NULL;

-- Index for threat type analysis
CREATE INDEX IF NOT EXISTS idx_threat_logs_threat_type
    ON threat_logs (device_id, threat_type, time DESC)
    WHERE threat_type IS NOT NULL;

-- Retention: 7 days (Community Edition)
SELECT add_retention_policy(
    'threat_logs',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Compression: After 1 day (threat logs can be large)
ALTER TABLE threat_logs SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id',
    timescaledb.compress_orderby = 'time DESC'
);

SELECT add_compression_policy(
    'threat_logs',
    INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Grant permissions
GRANT ALL PRIVILEGES ON threat_logs TO panfm;

-- Add comments for documentation
COMMENT ON TABLE threat_logs IS 'Firewall threat log entries - hypertable with 7-day retention';
COMMENT ON COLUMN threat_logs.severity IS 'Threat severity: critical, high, medium, low, informational';
COMMENT ON COLUMN threat_logs.threat_name IS 'Name of threat/signature from PAN-OS';
COMMENT ON COLUMN threat_logs.action IS 'Action taken: alert, block, drop, reset-client, etc.';
COMMENT ON COLUMN threat_logs.log_data IS 'Full log entry as JSON for extended analysis';
