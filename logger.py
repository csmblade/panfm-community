"""
Centralized logging module for PANfm
Implements rotating file handler with 10MB size limit
"""
import logging
from logging.handlers import RotatingFileHandler
import os
from config import DEBUG_LOG_FILE

# Global logger instance
_logger = None

def get_logger():
    """
    Get or create the application logger with rotating file handler.

    Logger behavior:
    - Only logs to file when debug_logging is enabled in settings
    - Rotates log files when they exceed 10MB
    - Keeps up to 5 backup files (50MB total max)
    - Uses consistent format with timestamp, level, module, and message

    Returns:
        logging.Logger: Configured logger instance
    """
    global _logger

    if _logger is not None:
        return _logger

    # Create logger
    _logger = logging.getLogger('panfm')
    _logger.setLevel(logging.DEBUG)

    # Remove any existing handlers to avoid duplicates
    _logger.handlers.clear()

    # Create rotating file handler
    # maxBytes=10MB, backupCount=5 (keeps 5 old files, 50MB total max)
    handler = RotatingFileHandler(
        DEBUG_LOG_FILE,
        maxBytes=10 * 1024 * 1024,  # 10MB
        backupCount=5,
        encoding='utf-8'
    )

    # Create formatter with timestamp, level, module, and message
    formatter = logging.Formatter(
        fmt='[%(asctime)s] %(levelname)s [%(module)s.%(funcName)s:%(lineno)d] %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    handler.setFormatter(formatter)

    # Add handler to logger
    _logger.addHandler(handler)

    # Prevent propagation to root logger
    _logger.propagate = False

    return _logger

def is_debug_enabled():
    """
    Check if debug logging is enabled in settings.

    Returns:
        bool: True if debug logging is enabled, False otherwise
    """
    try:
        from config import load_settings  # Lazy import to avoid circular dependency
        settings = load_settings()
        return settings.get('debug_logging', False)
    except:
        return False

def debug(message, *args, **kwargs):
    """
    Log a debug message if debug logging is enabled.

    Args:
        message (str): The message to log
        *args: Additional positional arguments for message formatting
        **kwargs: Additional keyword arguments for message formatting

    Example:
        debug("Processing data for device: %s", device_id)
        debug("Found %d entries", count)
    """
    if is_debug_enabled():
        logger = get_logger()
        logger.debug(message, *args, **kwargs)

def info(message, *args, **kwargs):
    """
    Log an info message if debug logging is enabled.

    Args:
        message (str): The message to log
        *args: Additional positional arguments for message formatting
        **kwargs: Additional keyword arguments for message formatting
    """
    if is_debug_enabled():
        logger = get_logger()
        logger.info(message, *args, **kwargs)

def warning(message, *args, **kwargs):
    """
    Log a warning message if debug logging is enabled.

    Args:
        message (str): The message to log
        *args: Additional positional arguments for message formatting
        **kwargs: Additional keyword arguments for message formatting
    """
    if is_debug_enabled():
        logger = get_logger()
        logger.warning(message, *args, **kwargs)

def error(message, *args, **kwargs):
    """
    Log an error message if debug logging is enabled.

    Args:
        message (str): The message to log
        *args: Additional positional arguments for message formatting
        **kwargs: Additional keyword arguments for message formatting
    """
    if is_debug_enabled():
        logger = get_logger()
        logger.error(message, *args, **kwargs)

def exception(message, *args, **kwargs):
    """
    Log an exception with traceback if debug logging is enabled.
    Call this from an except block to log the exception with full traceback.

    Args:
        message (str): The message to log
        *args: Additional positional arguments for message formatting
        **kwargs: Additional keyword arguments for message formatting

    Example:
        try:
            risky_operation()
        except Exception as e:
            exception("Error during risky operation: %s", str(e))
    """
    if is_debug_enabled():
        logger = get_logger()
        logger.exception(message, *args, **kwargs)

# Convenience function for backward compatibility
def log_debug(message):
    """
    Legacy function for backward compatibility.
    Use debug() instead for new code.

    Args:
        message (str): The message to log
    """
    debug(message)


def safe_error_response(error_obj, default_message="An error occurred"):
    """
    Create a safe error message for client responses.

    SECURITY: This function logs the full error details server-side
    but returns a generic message to the client to prevent information disclosure.

    Args:
        error_obj: The exception or error object
        default_message (str): Generic message to return to client

    Returns:
        str: Safe error message for client response

    Usage:
        try:
            risky_operation()
        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': safe_error_response(e, "Operation failed")
            }), 500
    """
    # Log full error details server-side for debugging
    error(f"Error details (not sent to client): {str(error_obj)}")

    # Return generic message to client
    return default_message
