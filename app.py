"""
Main Flask Application for Palo Alto Firewall Dashboard
Refactored for modularity and maintainability
"""
from flask import Flask, request
from flask_cors import CORS
from flask_wtf.csrf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_session import Session
from flask_compress import Compress
import redis
from datetime import timedelta
import urllib3
import os
from logger import debug, info, warning, error

# Disable SSL warnings for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Initialize Flask app
app = Flask(__name__)

# Enable Gzip Compression (compresses responses > 1KB for faster loading)
# This reduces index.html from 283KB → ~70KB (75% reduction)
app.config['COMPRESS_MIMETYPES'] = [
    'text/html', 'text/css', 'text/xml', 'application/json',
    'application/javascript', 'text/javascript'
]
app.config['COMPRESS_LEVEL'] = 6  # Compression level (1-9, 6 is good balance)
app.config['COMPRESS_MIN_SIZE'] = 1024  # Only compress responses > 1KB
Compress(app)

# Configuration
# SECRET_KEY stored in file for persistence across container restarts
# With gthread worker (1 worker, multiple threads), all threads share memory
def get_or_create_secret_key():
    """Get or create a persistent SECRET_KEY for Flask sessions."""
    secret_key_file = os.path.join(os.getcwd(), 'data', 'secret.key')

    # Try environment variable first
    secret_key = os.environ.get('SECRET_KEY')
    if secret_key:
        return secret_key

    # Try loading from file
    if os.path.exists(secret_key_file):
        try:
            with open(secret_key_file, 'r') as f:
                return f.read().strip()
        except Exception:
            pass

    # Generate new key and save to file
    os.makedirs(os.path.dirname(secret_key_file), exist_ok=True)
    new_key = os.urandom(24).hex()
    try:
        with open(secret_key_file, 'w') as f:
            f.write(new_key)
        os.chmod(secret_key_file, 0o600)  # Secure permissions
    except Exception:
        pass

    return new_key

app.config['SECRET_KEY'] = get_or_create_secret_key()
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=24)
app.config['SESSION_COOKIE_SECURE'] = False  # Set to True if using HTTPS
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

# Flask-Session configuration (Redis for enterprise reliability)
# Redis provides automatic session expiration and cleanup
# Prevents "Loading devices..." hang on container restart
redis_host = os.environ.get('REDIS_HOST', 'localhost')
redis_port = int(os.environ.get('REDIS_PORT', 6379))

app.config['SESSION_TYPE'] = 'redis'
app.config['SESSION_REDIS'] = redis.Redis(
    host=redis_host,
    port=redis_port
)
app.config['SESSION_PERMANENT'] = True
app.config['SESSION_USE_SIGNER'] = True  # Enable session signing for security
app.config['SESSION_KEY_PREFIX'] = 'panfm_session:'

info(f"Configured Redis session store at {redis_host}:{redis_port}")

# Initialize Flask-Session
Session(app)

# CSRF Protection
csrf = CSRFProtect(app)

# CORS Configuration
CORS(app, origins=['http://localhost:3000', 'http://127.0.0.1:3000'], supports_credentials=True)

# Rate Limiting
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["100 per hour"],
    storage_uri="memory://"
)

# Initialize authentication
from auth import init_auth_file
init_auth_file()

# Initialize device metadata file
from device_metadata import init_metadata_file, load_metadata
init_metadata_file()
# Pre-load metadata at startup for immediate availability
load_metadata(use_cache=False)  # Load fresh at startup

# Initialize MAC vendor and service port databases in background thread
# This eliminates the 9-second startup delay from loading 7.5 MB of JSON
import threading
from config import load_vendor_database, load_service_port_database
from logger import debug

def load_databases_async():
    """Load databases in background thread after startup"""
    debug("Loading MAC vendor database in background...")
    vendor_db = load_vendor_database(use_cache=False)
    debug(f"MAC vendor database loaded with {len(vendor_db)} entries")
    debug("Loading service port database in background...")
    service_db = load_service_port_database(use_cache=False)
    debug(f"Service port database loaded with {len(service_db)} entries")

# Start background thread for database loading (daemon=True means it will exit when main thread exits)
threading.Thread(target=load_databases_async, daemon=True).start()
debug("Database loading started in background thread")

# Check and fix encryption key permissions
from encryption import check_key_permissions
check_key_permissions()

# CRITICAL: Initialize database schema eagerly at startup (v1.14.0 - Enterprise Reliability)
# This ensures the database and all tables exist BEFORE any web request arrives.
# Without this, pages can fail with "Database not initialized" errors during the 30-60 second
# window between web server start and first clock collection cycle.
info("PANfm v2.0.0: Using TimescaleDB for throughput storage")
try:
    from throughput_storage_timescale import TimescaleStorage
    from config import TIMESCALE_DSN

    # Create TimescaleStorage instance to initialize schema (hypertables, continuous aggregates, policies)
    # This is intentionally separate from the collector - we only need the schema, not collection logic
    schema_init_storage = TimescaleStorage(TIMESCALE_DSN)
    info("✓ TimescaleDB schema initialized successfully at startup")

except Exception as e:
    # Log error but don't crash - clock process will retry initialization
    error(f"Failed to initialize TimescaleDB schema at startup: {e}")
    warning("Database will be initialized when clock process starts")

# NOTE: Scheduled tasks (throughput collection, database cleanup, alerts) are now handled
# by the separate clock.py process. This keeps the Flask web server lightweight and
# follows production best practices for separating web and background task concerns.
#
# The web server has READ-ONLY access to TimescaleDB to serve dashboard data via API
# endpoints. Web routes query the database directly using TimescaleStorage(TIMESCALE_DSN).
# NO collector initialization happens in the web process - only clock.py initializes
# the collector for writing data. This dual-process architecture eliminates locking
# issues and enables high-performance concurrent reads.

# Security: Disable caching for static files and API responses (v2.1.1)
# Prevents sensitive API data from being cached in browsers or proxies
@app.after_request
def add_security_headers(response):
    """Add security headers to prevent caching and improve security"""
    # Disable caching for static files (fix browser cache issues)
    if '/static/' in request.path:
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'

    # SECURITY: Disable caching for API responses (prevent sensitive data caching)
    if request.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, private'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'

    # Add security headers for all responses
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'

    return response

# Register all routes
from routes import register_routes
register_routes(app, csrf, limiter)

if __name__ == '__main__':
    # Get debug mode from environment variable (default: False for production)
    debug_mode = os.environ.get('FLASK_DEBUG', 'False').lower() in ('true', '1', 'yes')

    print("Starting Flask app (web server only)...")
    print("Scheduled tasks are handled by separate clock.py process")
    app.run(debug=debug_mode, host='0.0.0.0', port=3000, use_reloader=False, threaded=True)
