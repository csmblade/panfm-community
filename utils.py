"""
Utility functions for API statistics tracking
Note: Debug logging has been moved to logger.py module
"""
import requests
import urllib3
import time
import socket
from functools import wraps
from logger import debug, exception, warning

# Disable SSL warnings for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# API call counter
api_call_count = 0
api_call_start_time = time.time()

# Backward compatibility - redirect to new logger
def log_debug(message):
    """
    Legacy function for backward compatibility.
    Redirects to new centralized logger.
    Use logger.debug() directly for new code.
    """
    debug(message)

def increment_api_call():
    """Increment the API call counter"""
    global api_call_count
    api_call_count += 1

def get_api_stats():
    """Get API call statistics"""
    global api_call_count, api_call_start_time
    uptime_seconds = time.time() - api_call_start_time
    calls_per_minute = (api_call_count / uptime_seconds) * 60 if uptime_seconds > 0 else 0
    return {
        'total_calls': api_call_count,
        'calls_per_minute': round(calls_per_minute, 1)
    }

def retry_on_timeout(max_retries=3, backoff_factor=2, initial_delay=2):
    """
    Decorator to retry a function on timeout or connection errors with exponential backoff

    Args:
        max_retries: Maximum number of retry attempts (default: 3)
        backoff_factor: Multiplier for delay between retries (default: 2)
        initial_delay: Initial delay in seconds before first retry (default: 2)

    Returns:
        Decorator function

    Example:
        @retry_on_timeout(max_retries=3, backoff_factor=2, initial_delay=2)
        def my_api_call():
            return requests.get(url, timeout=30)

    Retry delays with default settings:
        Attempt 1: Immediate
        Attempt 2: 2 seconds after failure
        Attempt 3: 4 seconds after failure (2 * 2)
        Attempt 4: 8 seconds after failure (4 * 2)
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None

            for attempt in range(max_retries + 1):  # +1 for initial attempt
                try:
                    # Log retry attempts (but not the first attempt)
                    if attempt > 0:
                        delay = initial_delay * (backoff_factor ** (attempt - 1))
                        warning(f"Retry attempt {attempt}/{max_retries} for {func.__name__} after {delay}s delay")
                        time.sleep(delay)

                    # Call the actual function
                    result = func(*args, **kwargs)

                    # If we get here and it's a retry, log success
                    if attempt > 0:
                        debug(f"{func.__name__} succeeded on retry attempt {attempt}")

                    return result

                except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
                    last_exception = e
                    exception_type = "Timeout" if isinstance(e, requests.exceptions.Timeout) else "ConnectionError"

                    if attempt < max_retries:
                        warning(f"{func.__name__} failed with {exception_type}, will retry ({attempt + 1}/{max_retries})")
                    else:
                        exception(f"{func.__name__} failed with {exception_type} after {max_retries} retries: {e}")

                    # Continue to next retry
                    continue

                except Exception as e:
                    # Don't retry on other exceptions (HTTP errors, authentication failures, etc.)
                    exception(f"{func.__name__} failed with non-retryable error: {e}")
                    raise

            # If we get here, all retries failed
            if last_exception:
                raise last_exception

        return wrapper
    return decorator

def api_request_get(url, **kwargs):
    """Wrapper for requests.get that tracks API calls"""
    increment_api_call()
    return requests.get(url, **kwargs)

@retry_on_timeout(max_retries=3, backoff_factor=2, initial_delay=2)
def api_request_post(firewall_ip, api_key, cmd, cmd_type='op'):
    """
    Wrapper for Palo Alto API POST requests with retry logic and tracking

    Features:
    - Automatic retry on timeout/connection errors (3 retries with exponential backoff)
    - 60-second timeout for large operations (downloads, installs)
    - API call tracking
    - Debug logging

    Args:
        firewall_ip: Firewall IP address
        api_key: API key for authentication
        cmd: XML command to execute
        cmd_type: Type of command ('op' for operational, 'config' for configuration)

    Returns:
        XML response string or None on error

    Raises:
        requests.exceptions.Timeout: If all retry attempts timeout
        requests.exceptions.ConnectionError: If all retry attempts fail to connect
        requests.exceptions.HTTPError: For HTTP 4xx/5xx errors (no retry)
    """
    increment_api_call()

    url = f'https://{firewall_ip}/api/'
    params = {
        'type': cmd_type,
        'cmd': cmd,
        'key': api_key
    }

    try:
        start_time = time.time()
        debug(f"Making POST request to {url}")

        # Increased timeout from 30s to 60s for large operations
        response = requests.post(url, data=params, verify=False, timeout=60)

        elapsed = time.time() - start_time
        debug(f"Response received in {elapsed:.2f}s, status code: {response.status_code}")

        response.raise_for_status()
        return response.text

    except requests.exceptions.HTTPError as e:
        # HTTP errors (4xx/5xx) should not retry - likely auth or permission issues
        exception(f"API POST HTTP error to {firewall_ip}: {e}")
        return None
    except (requests.exceptions.Timeout, requests.exceptions.ConnectionError):
        # Let the retry decorator handle these - it will re-raise after max retries
        raise
    except Exception as e:
        # Other exceptions (e.g., invalid URL, SSL errors) should not retry
        exception(f"API POST request failed to {firewall_ip}: {e}")
        return None

def reverse_dns_lookup(ip_addresses, timeout=5):
    """
    Perform reverse DNS lookups on a list of IP addresses using dnspython.

    Args:
        ip_addresses: List of IP addresses to lookup
        timeout: Timeout in seconds for each lookup (default: 5)

    Returns:
        Dictionary mapping IP addresses to hostnames (or IP if lookup fails)
    """
    try:
        import dns.resolver
        import dns.reversename
    except ImportError:
        debug("dnspython not available, DNS lookups will fail")
        return {ip: ip for ip in ip_addresses}

    debug("Starting reverse DNS lookup for %d IP addresses with timeout=%ds", len(ip_addresses), timeout)

    results = {}
    success_count = 0
    fail_count = 0

    # Create a resolver with custom timeout and public DNS servers
    resolver = dns.resolver.Resolver()
    resolver.timeout = timeout
    resolver.lifetime = timeout
    # Use Google and Cloudflare public DNS servers for better PTR record availability
    resolver.nameservers = ['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1']

    for ip in ip_addresses:
        try:
            # Convert IP to reverse DNS format (e.g., 8.8.8.8 -> 8.8.8.8.in-addr.arpa)
            rev_name = dns.reversename.from_address(ip)

            # Perform PTR lookup
            answers = resolver.resolve(rev_name, "PTR")

            # Get the first PTR record and remove trailing dot
            hostname = str(answers[0]).rstrip('.')
            results[ip] = hostname
            success_count += 1
            debug("Successfully resolved %s to %s", ip, hostname)

        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            # No PTR record exists
            results[ip] = ip
            fail_count += 1
            debug("No PTR record found for %s", ip)

        except dns.exception.Timeout:
            # DNS query timed out
            results[ip] = ip
            fail_count += 1
            debug("DNS lookup timeout for %s", ip)

        except Exception as e:
            # Catch any other exceptions
            results[ip] = ip
            fail_count += 1
            debug("DNS lookup error for %s: %s", ip, str(e))

    debug("Reverse DNS lookup completed: %d successful, %d failed", success_count, fail_count)
    return results


