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

-- Retention: 90 days
SELECT add_retention_policy(
    'application_hourly',
    INTERVAL '90 days',
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

-- Retention: 90 days
SELECT add_retention_policy(
    'category_bandwidth_hourly',
    INTERVAL '90 days',
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

-- Retention: 90 days
SELECT add_retention_policy(
    'client_bandwidth_hourly',
    INTERVAL '90 days',
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
    RAISE NOTICE 'Retention policies: 7 days raw → 90 days hourly';
    RAISE NOTICE 'Compression: After 2 days';
    RAISE NOTICE 'Continuous aggregate refresh: Every 30 minutes';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Restart panfm-clock to start data collection';
    RAISE NOTICE '  2. Wait 60 minutes for initial data population';
    RAISE NOTICE '  3. Verify dashboard Top Category/Clients tiles';
END $$;
