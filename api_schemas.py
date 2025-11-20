"""
API Response Schemas (v1.14.0 - Phase 2: API Standardization)

This module defines TypedDict schemas for all API responses to ensure consistency
and prevent breaking changes. All API endpoints should return data matching these schemas.

Benefits:
- Documents expected API response structure
- Enables runtime validation (optional)
- Makes breaking changes visible
- Helps prevent "undefined" errors in frontend

Usage:
    from api_schemas import ThroughputResponse, validate_response

    # In route handler:
    response_data = {
        'status': 'success',
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'inbound_mbps': 45.2,
        # ... rest of data
    }

    # Optional validation (logs warnings, doesn't crash):
    validate_response(response_data, ThroughputResponse)

    return jsonify(response_data), 200
"""
from typing import TypedDict, Optional, List, Dict, Any, Literal
from logger import warning


# ============================================================================
# Common Response Types
# ============================================================================

class BaseResponse(TypedDict, total=False):
    """Base response fields common to all API responses"""
    status: Literal['success', 'error', 'waiting']  # Response status
    message: Optional[str]  # Human-readable message
    retry_after_seconds: Optional[int]  # For waiting/error states


class ErrorResponse(TypedDict):
    """Standard error response"""
    status: Literal['error']
    message: str
    error_code: Optional[str]


class WaitingResponse(TypedDict):
    """Standard waiting response (during initial data collection)"""
    status: Literal['waiting']
    message: str
    retry_after_seconds: int


# ============================================================================
# Throughput & Monitoring Schemas
# ============================================================================

class CPUMetrics(TypedDict, total=False):
    """CPU and memory metrics"""
    data_plane_cpu: float  # Data plane CPU percentage
    mgmt_plane_cpu: float  # Management plane CPU percentage
    memory_used_pct: float  # Memory usage percentage
    memory_used_mb: Optional[int]  # Memory used in MB
    memory_total_mb: Optional[int]  # Total memory in MB


class SessionMetrics(TypedDict, total=False):
    """Session count metrics"""
    active: int  # Total active sessions
    tcp: int  # TCP sessions
    udp: int  # UDP sessions
    icmp: int  # ICMP sessions
    max: int  # Maximum session capacity
    utilization_pct: float  # Session utilization percentage


class DiskUsageMetrics(TypedDict, total=False):
    """Disk usage metrics"""
    root_pct: int  # Root partition usage percentage
    logs_pct: int  # Logs partition usage percentage
    var_pct: int  # Var partition usage percentage
    partitions: List[Dict[str, Any]]  # Detailed partition info


class DatabaseVersions(TypedDict, total=False):
    """Database version information"""
    app_version: str  # Application database version
    threat_version: str  # Threat database version
    wildfire_version: str  # WildFire database version
    url_version: str  # URL filtering database version


class SessionUtilization(TypedDict, total=False):
    """Session utilization metrics"""
    utilization_pct: float  # Session utilization percentage
    max_capacity: int  # Maximum session capacity
    active_sessions: int  # Currently active sessions


class ThroughputResponse(BaseResponse):
    """Main throughput data response (real-time)"""
    timestamp: str  # ISO 8601 timestamp
    inbound_mbps: float  # Inbound throughput in Mbps
    outbound_mbps: float  # Outbound throughput in Mbps
    total_mbps: float  # Total throughput in Mbps
    inbound_pps: float  # Inbound packets per second
    outbound_pps: float  # Outbound packets per second
    total_pps: float  # Total packets per second

    # Nested metrics (enhanced v1.13.0+)
    sessions: SessionMetrics  # Session counts
    cpu: CPUMetrics  # CPU and memory metrics

    # Optional enhanced metrics (v1.13.0+)
    disk_usage: Optional[DiskUsageMetrics]  # Disk usage
    database_versions: Optional[DatabaseVersions]  # Database versions
    session_utilization: Optional[SessionUtilization]  # Session utilization


class ThroughputSample(TypedDict, total=False):
    """Single throughput sample (from database)"""
    timestamp: str  # ISO 8601 timestamp
    device_id: str  # Device identifier
    inbound_mbps: float
    outbound_mbps: float
    total_mbps: float
    inbound_pps: float
    outbound_pps: float
    total_pps: float

    # Nested objects (preferred format)
    sessions: SessionMetrics
    cpu: CPUMetrics
    disk_usage: Optional[DiskUsageMetrics]
    database_versions: Optional[DatabaseVersions]
    session_utilization: Optional[SessionUtilization]

    # Backward-compatible flat properties (maintained for legacy Dashboard)
    cpu_data_plane: float
    cpu_mgmt_plane: float
    memory_used_pct: float
    sessions_active: int
    sessions_tcp: int
    sessions_udp: int
    sessions_icmp: int


class ThroughputHistoryResponse(BaseResponse):
    """Throughput history response (time series)"""
    device_id: str
    range: str  # Time range (1h, 24h, 7d, 30d)
    samples: List[ThroughputSample]  # Array of samples
    sample_count: int  # Total number of samples


# ============================================================================
# Applications & Connected Devices Schemas
# ============================================================================

class ApplicationSummary(TypedDict, total=False):
    """Application traffic summary"""
    total_applications: int
    total_sessions: int
    total_bytes: int
    vlans_detected: int
    zones_detected: int


class ApplicationEntry(TypedDict, total=False):
    """Single application entry"""
    application: str
    category: str
    sessions: int
    bytes: int
    users: int
    vlans: List[str]
    zones: List[str]


class ApplicationsResponse(BaseResponse):
    """Applications page response"""
    applications: List[ApplicationEntry]
    summary: ApplicationSummary
    total: int  # Total count
    source: str  # Data source (live, database, waiting)
    retry_after_seconds: Optional[int]  # For waiting state


class ConnectedDevice(TypedDict, total=False):
    """Connected device entry"""
    ip: str
    mac: str
    hostname: str
    interface: str
    vlan: Optional[str]
    vendor: Optional[str]
    custom_name: Optional[str]  # From metadata
    location: Optional[str]  # From metadata
    tags: Optional[List[str]]  # From metadata
    comment: Optional[str]  # From metadata


class ConnectedDevicesResponse(BaseResponse):
    """Connected devices response"""
    devices: List[ConnectedDevice]
    total: int
    source: str


# ============================================================================
# Device Management Schemas
# ============================================================================

class Device(TypedDict, total=False):
    """Device configuration"""
    id: str
    name: str
    ip: str
    api_key: str  # Encrypted
    enabled: bool
    group: Optional[str]
    description: Optional[str]
    monitored_interface: Optional[str]


class DevicesResponse(BaseResponse):
    """Device list response"""
    devices: List[Device]
    groups: List[str]


# ============================================================================
# Alert Schemas
# ============================================================================

class AlertConfiguration(TypedDict, total=False):
    """Alert configuration"""
    id: str
    name: str
    alert_type: str
    enabled: bool
    threshold: float
    duration_minutes: int
    severity: Literal['info', 'warning', 'critical']
    device_ids: List[str]
    notification_channels: List[str]


class AlertHistory(TypedDict, total=False):
    """Alert history entry"""
    id: str
    alert_id: str
    timestamp: str
    severity: str
    message: str
    acknowledged: bool
    resolved: bool


# ============================================================================
# Validation Helpers
# ============================================================================

def validate_response(data: Dict[str, Any], schema: type) -> bool:
    """
    Validate API response against schema (non-blocking).

    Logs warnings for missing required fields but doesn't crash.
    This is a lightweight validation - for production, consider using pydantic.

    Args:
        data: Response data to validate
        schema: TypedDict schema to validate against

    Returns:
        bool: True if valid, False if validation warnings logged
    """
    try:
        # Get required fields from TypedDict annotations
        if not hasattr(schema, '__annotations__'):
            return True

        annotations = schema.__annotations__
        required_fields = []

        # Check if schema has 'total=False' (all fields optional)
        # For now, we'll just check if fields exist, not enforce required

        missing_fields = []
        for field, field_type in annotations.items():
            if field not in data:
                # Check if field is Optional (not required)
                type_str = str(field_type)
                if 'Optional' not in type_str and 'total=False' not in str(schema):
                    missing_fields.append(field)

        if missing_fields:
            warning(f"API response missing fields for {schema.__name__}: {missing_fields}")
            return False

        return True

    except Exception as e:
        warning(f"Schema validation error for {schema.__name__}: {e}")
        return True  # Don't block on validation errors


def create_waiting_response(message: str = "Waiting for first data collection",
                            retry_seconds: int = 30) -> WaitingResponse:
    """
    Create standardized waiting response.

    Args:
        message: Human-readable waiting message
        retry_seconds: Seconds until auto-retry

    Returns:
        WaitingResponse: Standardized waiting response
    """
    return {
        'status': 'waiting',
        'message': message,
        'retry_after_seconds': retry_seconds
    }


def create_error_response(message: str, error_code: Optional[str] = None) -> ErrorResponse:
    """
    Create standardized error response.

    Args:
        message: Human-readable error message
        error_code: Optional error code

    Returns:
        ErrorResponse: Standardized error response
    """
    response: ErrorResponse = {
        'status': 'error',
        'message': message
    }
    if error_code:
        response['error_code'] = error_code
    return response


# ============================================================================
# Schema Version & Exports
# ============================================================================

__version__ = '1.14.0'
__all__ = [
    # Base responses
    'BaseResponse',
    'ErrorResponse',
    'WaitingResponse',

    # Monitoring schemas
    'ThroughputResponse',
    'ThroughputSample',
    'ThroughputHistoryResponse',
    'CPUMetrics',
    'SessionMetrics',
    'DiskUsageMetrics',
    'DatabaseVersions',

    # Application schemas
    'ApplicationsResponse',
    'ApplicationEntry',
    'ApplicationSummary',

    # Device schemas
    'ConnectedDevice',
    'ConnectedDevicesResponse',
    'Device',
    'DevicesResponse',

    # Alert schemas
    'AlertConfiguration',
    'AlertHistory',

    # Helpers
    'validate_response',
    'create_waiting_response',
    'create_error_response'
]
