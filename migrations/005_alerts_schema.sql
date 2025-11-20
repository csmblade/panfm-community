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

-- Retention: 365 days (1 year of alert history)
SELECT add_retention_policy(
    'alert_history',
    INTERVAL '365 days',
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
    RAISE NOTICE '  - Retention: 365 days';
    RAISE NOTICE '  - Compression: After 30 days';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '  1. Run migrate_alerts_to_timescale.py to migrate data from alerts.db';
    RAISE NOTICE '  2. Update alert_manager.py to use PostgreSQL';
    RAISE NOTICE '  3. Test alert creation and triggering';
    RAISE NOTICE '  4. Remove alerts.db after verification';
END $$;
