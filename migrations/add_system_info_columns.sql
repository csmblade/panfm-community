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
