-- =========================================
-- PANfm Database Schema
-- =========================================
-- All tables for Community and Enterprise editions
-- NO FK constraints on hypertables (they fail silently)
-- NO continuous aggregates (too fragile for init)
-- Each CREATE TABLE has IF NOT EXISTS for idempotency
-- =========================================

-- =========================================
-- Core Tables
-- =========================================

-- Main throughput metrics hypertable
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
    cpu_temp SMALLINT,
    cpu_temp_max SMALLINT,
    cpu_temp_alarm BOOLEAN DEFAULT FALSE,

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

    -- System info
    wan_ip TEXT,
    wan_speed TEXT,
    hostname TEXT,
    uptime_seconds BIGINT,
    pan_os_version TEXT,
    license_expired INTEGER DEFAULT 0,
    license_active INTEGER DEFAULT 0,

    -- Additional metrics
    threats_count INTEGER DEFAULT 0,
    interface_errors INTEGER DEFAULT 0,

    PRIMARY KEY (time, device_id)
);

-- Connected devices from ARP/Nmap
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
    custom_name TEXT,
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (time, device_id, ip)
);

-- Threat log entries
CREATE TABLE IF NOT EXISTS threat_logs (
    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    device_id TEXT NOT NULL,
    severity VARCHAR(20),
    threat TEXT,
    threat_id TEXT,
    threat_type TEXT,
    source_ip TEXT,
    source_port INTEGER,
    destination_ip TEXT,
    destination_port INTEGER,
    protocol TEXT,
    application TEXT,
    category TEXT,
    action TEXT,
    rule TEXT,
    source_zone TEXT,
    destination_zone TEXT,
    source_user TEXT,
    destination_user TEXT,
    log_data JSONB,
    PRIMARY KEY (device_id, time)
);

-- Device metadata (custom names, tags, locations)
CREATE TABLE IF NOT EXISTS device_metadata (
    device_id TEXT NOT NULL,
    mac MACADDR NOT NULL,
    custom_name TEXT,
    location TEXT,
    comment TEXT,
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (device_id, mac)
);

-- On-demand collection queue
CREATE TABLE IF NOT EXISTS collection_requests (
    id SERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'queued',
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT
);

-- Scheduler statistics
CREATE TABLE IF NOT EXISTS scheduler_stats_history (
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    uptime_seconds INTEGER,
    total_executions INTEGER DEFAULT 0,
    total_errors INTEGER DEFAULT 0,
    last_execution TIMESTAMPTZ,
    PRIMARY KEY (timestamp)
);

-- =========================================
-- Traffic Flow Tables (Sankey diagrams)
-- =========================================

CREATE TABLE IF NOT EXISTS traffic_flows (
    time TIMESTAMPTZ NOT NULL,
    device_id TEXT NOT NULL,
    source_ip INET NOT NULL,
    dest_ip INET NOT NULL,
    dest_port INTEGER,
    application TEXT NOT NULL,
    category TEXT,
    protocol TEXT,
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    bytes_total BIGINT DEFAULT 0,
    sessions INTEGER DEFAULT 1,
    source_zone TEXT,
    dest_zone TEXT,
    source_vlan TEXT,
    dest_vlan TEXT,
    source_hostname TEXT,
    dest_hostname TEXT,
    PRIMARY KEY (time, device_id, source_ip, dest_ip, dest_port, application)
);

-- =========================================
-- Analytics Tables
-- =========================================

CREATE TABLE IF NOT EXISTS application_samples (
    time TIMESTAMPTZ NOT NULL,
    device_id TEXT NOT NULL,
    application TEXT NOT NULL,
    category TEXT,
    sessions_total INTEGER DEFAULT 0,
    sessions_tcp INTEGER DEFAULT 0,
    sessions_udp INTEGER DEFAULT 0,
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    bytes_total BIGINT DEFAULT 0,
    bandwidth_mbps DOUBLE PRECISION DEFAULT 0,
    source_zone TEXT,
    dest_zone TEXT,
    vlan TEXT,
    top_source_ip INET,
    top_source_hostname TEXT,
    top_source_bytes BIGINT DEFAULT 0,
    PRIMARY KEY (time, device_id, application)
);

CREATE TABLE IF NOT EXISTS category_bandwidth (
    time TIMESTAMPTZ NOT NULL,
    device_id TEXT NOT NULL,
    category TEXT NOT NULL,
    traffic_type TEXT NOT NULL,
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    bytes_total BIGINT DEFAULT 0,
    bandwidth_mbps DOUBLE PRECISION DEFAULT 0,
    sessions_total INTEGER DEFAULT 0,
    top_application TEXT,
    top_application_bytes BIGINT DEFAULT 0,
    PRIMARY KEY (time, device_id, category, traffic_type)
);

CREATE TABLE IF NOT EXISTS client_bandwidth (
    time TIMESTAMPTZ NOT NULL,
    device_id TEXT NOT NULL,
    client_ip INET NOT NULL,
    client_mac MACADDR,
    hostname TEXT,
    custom_name TEXT,
    traffic_type TEXT NOT NULL,
    bytes_sent BIGINT DEFAULT 0,
    bytes_received BIGINT DEFAULT 0,
    bytes_total BIGINT DEFAULT 0,
    bandwidth_mbps DOUBLE PRECISION DEFAULT 0,
    sessions_total INTEGER DEFAULT 0,
    sessions_tcp INTEGER DEFAULT 0,
    sessions_udp INTEGER DEFAULT 0,
    interface TEXT,
    vlan TEXT,
    zone TEXT,
    top_application TEXT,
    top_application_bytes BIGINT DEFAULT 0,
    PRIMARY KEY (time, device_id, client_ip, traffic_type)
);

CREATE TABLE IF NOT EXISTS application_categories (
    application TEXT NOT NULL PRIMARY KEY,
    category TEXT NOT NULL,
    subcategory TEXT,
    risk_level SMALLINT,
    technology TEXT,
    characteristics TEXT[],
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================
-- Alert System Tables
-- =========================================

CREATE TABLE IF NOT EXISTS notification_channels (
    id SERIAL PRIMARY KEY,
    channel_type TEXT NOT NULL,
    name TEXT NOT NULL,
    config JSONB NOT NULL,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_configs (
    id SERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    metric_type TEXT NOT NULL,
    threshold_value DOUBLE PRECISION NOT NULL,
    threshold_operator TEXT NOT NULL,
    severity TEXT NOT NULL,
    enabled BOOLEAN DEFAULT true,
    notification_channels JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Alert history (hypertable) - NO FK constraint to alert_configs
CREATE TABLE IF NOT EXISTS alert_history (
    id SERIAL,
    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    alert_config_id INTEGER NOT NULL,
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
    PRIMARY KEY (id, time)
);

CREATE TABLE IF NOT EXISTS maintenance_windows (
    id SERIAL PRIMARY KEY,
    device_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_cooldowns (
    id SERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    alert_config_id INTEGER NOT NULL,
    last_triggered_at TIMESTAMPTZ NOT NULL,
    cooldown_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(device_id, alert_config_id)
);

-- =========================================
-- Nmap Scanning Tables
-- =========================================

CREATE TABLE IF NOT EXISTS scheduled_scans (
    id SERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    target_type TEXT NOT NULL,
    target_value TEXT,
    scan_type TEXT NOT NULL DEFAULT 'balanced',
    schedule_type TEXT NOT NULL,
    schedule_value JSONB NOT NULL,
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

-- Nmap scan history (hypertable)
CREATE TABLE IF NOT EXISTS nmap_scan_history (
    id SERIAL,
    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    device_id TEXT NOT NULL,
    target_ip INET NOT NULL,
    scan_type TEXT NOT NULL,
    scan_timestamp TIMESTAMPTZ NOT NULL,
    scan_duration_seconds DOUBLE PRECISION,
    hostname TEXT,
    host_status TEXT,
    os_name TEXT,
    os_accuracy INTEGER,
    os_matches JSONB,
    total_ports INTEGER DEFAULT 0,
    open_ports_count INTEGER DEFAULT 0,
    scan_results JSONB,
    raw_xml TEXT,
    PRIMARY KEY (id, time)
);

-- Port history - NO FK to nmap_scan_history (hypertable)
CREATE TABLE IF NOT EXISTS nmap_port_history (
    id SERIAL PRIMARY KEY,
    scan_id INTEGER NOT NULL,
    port_number INTEGER NOT NULL,
    protocol TEXT NOT NULL,
    state TEXT NOT NULL,
    service_name TEXT,
    service_product TEXT,
    service_version TEXT
);

-- Change events (hypertable)
CREATE TABLE IF NOT EXISTS nmap_change_events (
    id SERIAL,
    time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    device_id TEXT NOT NULL,
    target_ip INET NOT NULL,
    change_timestamp TIMESTAMPTZ NOT NULL,
    change_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    details JSONB,
    acknowledged BOOLEAN DEFAULT false,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by TEXT,
    PRIMARY KEY (id, time)
);

-- Scan queue - NO FK to nmap_scan_history (hypertable)
CREATE TABLE IF NOT EXISTS scan_queue (
    id SERIAL PRIMARY KEY,
    schedule_id INTEGER,
    device_id TEXT NOT NULL,
    target_ip INET NOT NULL,
    scan_type TEXT NOT NULL,
    status TEXT NOT NULL,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    scan_id INTEGER,
    error_message TEXT
);

-- =========================================
-- Indexes (created after tables)
-- =========================================

-- Throughput indexes
CREATE INDEX IF NOT EXISTS idx_throughput_device_time ON throughput_samples (device_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_throughput_time_device ON throughput_samples (time DESC, device_id);

-- Connected devices indexes
CREATE INDEX IF NOT EXISTS idx_connected_devices_device_ip ON connected_devices (device_id, ip, time DESC);
CREATE INDEX IF NOT EXISTS idx_connected_devices_mac ON connected_devices (device_id, mac, time DESC) WHERE mac IS NOT NULL;

-- Threat logs indexes
CREATE INDEX IF NOT EXISTS idx_threat_logs_device_time ON threat_logs (device_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_threat_logs_severity ON threat_logs (device_id, severity, time DESC);
CREATE INDEX IF NOT EXISTS idx_threat_logs_source_ip ON threat_logs (device_id, source_ip, time DESC) WHERE source_ip IS NOT NULL;

-- Device metadata indexes
CREATE INDEX IF NOT EXISTS idx_device_metadata_device_id ON device_metadata(device_id);
CREATE INDEX IF NOT EXISTS idx_device_metadata_tags ON device_metadata USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_device_metadata_mac ON device_metadata(mac);

-- Collection requests indexes
CREATE INDEX IF NOT EXISTS idx_collection_requests_status ON collection_requests(status, requested_at);
CREATE INDEX IF NOT EXISTS idx_collection_requests_device ON collection_requests(device_id, status);

-- Traffic flows indexes
CREATE INDEX IF NOT EXISTS idx_traffic_flows_device_source_time ON traffic_flows (device_id, source_ip, time DESC);
CREATE INDEX IF NOT EXISTS idx_traffic_flows_device_dest_time ON traffic_flows (device_id, dest_ip, time DESC);

-- Alert indexes
CREATE INDEX IF NOT EXISTS idx_alert_configs_device_enabled ON alert_configs (device_id, enabled);
CREATE INDEX IF NOT EXISTS idx_alert_history_device_time ON alert_history (device_id, time DESC);

-- Nmap indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_scans_device_enabled ON scheduled_scans (device_id, enabled);
CREATE INDEX IF NOT EXISTS idx_nmap_scan_history_device_target ON nmap_scan_history (device_id, target_ip, time DESC);
CREATE INDEX IF NOT EXISTS idx_nmap_change_events_device_target ON nmap_change_events (device_id, target_ip, time DESC);
CREATE INDEX IF NOT EXISTS idx_scan_queue_status ON scan_queue (status, queued_at);
