"""
PANfm Version Management
Semantic Versioning: MAJOR.MINOR.PATCH

MAJOR: Breaking changes, major architecture changes
MINOR: New features, significant updates (backward compatible)
PATCH: Bug fixes, small improvements, documentation updates
"""

# Current version
VERSION_MAJOR = 1
VERSION_MINOR = 0
VERSION_PATCH = 15

# Build metadata (optional)
VERSION_BUILD = "20251127"  # YYYYMMDD format

# Pre-release identifier (optional, e.g., 'alpha', 'beta', 'rc1')
VERSION_PRERELEASE = None  # Stable release

# Codename for this version (optional)
VERSION_CODENAME = "File Size Reduction"


def get_version():
    """
    Get the full version string
    Returns: str - Full version string (e.g., "1.0.3" or "1.0.3-beta")
    """
    version = f"{VERSION_MAJOR}.{VERSION_MINOR}.{VERSION_PATCH}"

    if VERSION_PRERELEASE:
        version += f"-{VERSION_PRERELEASE}"

    return version


def get_version_info():
    """
    Get detailed version information
    Returns: dict - Dictionary with version details
    """
    return {
        'version': get_version(),
        'major': VERSION_MAJOR,
        'minor': VERSION_MINOR,
        'patch': VERSION_PATCH,
        'build': VERSION_BUILD,
        'prerelease': VERSION_PRERELEASE,
        'codename': VERSION_CODENAME,
        'display': get_display_version()
    }


def get_display_version():
    """
    Get version string suitable for UI display
    Returns: str - Formatted version for display (e.g., "v1.0.3 - Tech Support")
    """
    version = f"v{get_version()}"

    if VERSION_CODENAME:
        version += f" - {VERSION_CODENAME}"

    return version


def get_short_version():
    """
    Get short version string (MAJOR.MINOR only)
    Returns: str - Short version (e.g., "1.0")
    """
    return f"{VERSION_MAJOR}.{VERSION_MINOR}"


# Version history moved to CHANGELOG.md for better maintainability
# See CHANGELOG.md for full release history


if __name__ == '__main__':
    # Print version information when run directly
    print(f"PANfm Version: {get_display_version()}")
    print(f"Full version: {get_version()}")
    print(f"Build: {VERSION_BUILD}")
    print(f"\nVersion Info:")
    import json
    print(json.dumps(get_version_info(), indent=2))
