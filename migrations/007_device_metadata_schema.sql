-- Migration 007: Device Metadata Table
-- Purpose: Move device metadata (custom names, tags, locations, comments) from JSON to PostgreSQL
-- Date: 2025-11-22
-- Version: v2.0.1

-- Create device_metadata table
CREATE TABLE IF NOT EXISTS device_metadata (
    mac MACADDR PRIMARY KEY,
    device_id UUID,  -- Optional: link to specific device, NULL = global metadata
    custom_name TEXT,
    location TEXT,
    comment TEXT,
    tags TEXT[] DEFAULT '{}',  -- PostgreSQL array for tags
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Foreign key to devices table (if device_id is specified)
    -- Note: device_id can be NULL for global metadata (legacy format)
    CONSTRAINT fk_device_metadata_device FOREIGN KEY (device_id)
        REFERENCES devices(device_id) ON DELETE CASCADE
);

-- Index for fast tag filtering using GIN (Generalized Inverted Index)
-- This enables fast queries like: WHERE tags && ARRAY['IoT', 'Cameras']
CREATE INDEX IF NOT EXISTS idx_device_metadata_tags
    ON device_metadata USING GIN(tags);

-- Index for device_id lookups
CREATE INDEX IF NOT EXISTS idx_device_metadata_device_id
    ON device_metadata(device_id);

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
COMMENT ON TABLE device_metadata IS 'Device metadata: custom names, tags, locations, and comments for network devices';
COMMENT ON COLUMN device_metadata.mac IS 'MAC address (primary key) - normalized to lowercase';
COMMENT ON COLUMN device_metadata.device_id IS 'Optional device ID link (NULL = global metadata)';
COMMENT ON COLUMN device_metadata.custom_name IS 'User-defined custom name for device';
COMMENT ON COLUMN device_metadata.location IS 'Physical location (e.g., "Building A, Room 205")';
COMMENT ON COLUMN device_metadata.comment IS 'User notes/comments (max 2048 chars recommended)';
COMMENT ON COLUMN device_metadata.tags IS 'Array of tags (e.g., [''IoT'', ''Cameras'', ''Business''])';
COMMENT ON COLUMN device_metadata.created_at IS 'Timestamp when metadata was created';
COMMENT ON COLUMN device_metadata.updated_at IS 'Timestamp when metadata was last updated';

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON device_metadata TO panfm_app;

-- Example queries for reference:
--
-- Find devices with specific tag:
--   SELECT * FROM device_metadata WHERE tags @> ARRAY['IoT'];
--
-- Find devices with ANY of multiple tags:
--   SELECT * FROM device_metadata WHERE tags && ARRAY['IoT', 'Cameras'];
--
-- Find devices with ALL of multiple tags:
--   SELECT * FROM device_metadata WHERE tags @> ARRAY['IoT', 'Business'];
--
-- Get all unique tags:
--   SELECT DISTINCT unnest(tags) AS tag FROM device_metadata ORDER BY tag;
--
-- Join with connected_devices:
--   SELECT cd.ip, cd.hostname, dm.custom_name, dm.tags
--   FROM connected_devices cd
--   LEFT JOIN device_metadata dm ON cd.mac = dm.mac
--   WHERE dm.tags @> ARRAY['IoT'];
