-- =========================================
-- PANfm - TimescaleDB Extension Only
-- =========================================
-- This file ONLY enables the TimescaleDB extension.
-- All tables are created by the Python schema manager
-- (schema/manager.py) during container startup.
--
-- This approach is more robust because:
-- 1. Python can handle errors gracefully
-- 2. Tables are created idempotently
-- 3. Partial failures don't break the installation
-- =========================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Grant permissions to panfm user
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO panfm;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO panfm;
GRANT USAGE ON SCHEMA public TO panfm;

-- Database optimization settings (optional, improve performance)
ALTER SYSTEM SET shared_buffers = '512MB';
ALTER SYSTEM SET work_mem = '32MB';
ALTER SYSTEM SET maintenance_work_mem = '256MB';
ALTER SYSTEM SET random_page_cost = 1.1;
