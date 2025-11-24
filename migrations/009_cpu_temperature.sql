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

-- Verify changes
\d throughput_samples;
