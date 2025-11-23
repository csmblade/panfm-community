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
