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
