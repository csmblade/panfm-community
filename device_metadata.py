"""
Device Metadata Manager for PANfm

Manages custom names, comments, and tags for connected devices keyed by MAC address.
Uses per-device format with device_id as top-level key: {device_id: {mac: metadata}}
Metadata is stored encrypted at rest in device_metadata.json.

This file is kept for backward compatibility with:
  - backup_restore.py (backup/restore)
  - firewall_api_devices.py (metadata enrichment)
  - throughput_collector.py (metadata enrichment)
"""
import os
import json
import re
from config import METADATA_FILE, load_settings
from encryption import encrypt_dict, decrypt_dict
from logger import debug, info, warning, error, exception

# Global cache for metadata (loaded at startup, updated on changes)
_metadata_cache = None
_cache_loaded = False


def init_metadata_file():
    """
    Initialize device_metadata.json with empty structure if it doesn't exist.
    Sets file permissions to 600 (owner read/write only) for security.
    
    Returns:
        bool: True on success, False on error
    """
    debug("Checking if metadata file exists")
    if not os.path.exists(METADATA_FILE):
        debug("Metadata file not found, creating with empty structure")
        empty_data = {}
        
        try:
            # Encrypt empty structure (following encryption pattern)
            encrypted_data = encrypt_dict(empty_data)
            with open(METADATA_FILE, 'w') as f:
                json.dump(encrypted_data, f, indent=2)
            
            # Set file permissions to 600
            os.chmod(METADATA_FILE, 0o600)
            
            info("Created empty device metadata file")
            return True
        except Exception as e:
            error(f"Failed to create metadata file: {str(e)}")
            return False
    else:
        debug("Metadata file exists")
        return True


def load_metadata(device_id=None, use_cache=True):
    """
    Load and decrypt device metadata from JSON file.
    Supports both per-device format (v1.6.0+) and global format (legacy).

    Args:
        device_id: Specific device ID to load metadata for. If None and per-device format, returns all.
        use_cache: If True, returns cached metadata if available. If False, forces reload from disk.

    Returns:
        dict: If device_id provided: {mac: metadata}
              If device_id None: {device_id: {mac: metadata}} (per-device) or {mac: metadata} (legacy)
    """
    global _metadata_cache, _cache_loaded

    # Return cached data if available and cache is enabled
    if use_cache and _cache_loaded and _metadata_cache is not None:
        debug("Returning cached device metadata")
        if device_id:
            # Return specific device's metadata
            return _metadata_cache.get(device_id, {}).copy()
        else:
            return _metadata_cache.copy()

    debug(f"Loading device metadata from disk (device_id={device_id})")
    try:
        # Check if file exists
        if not os.path.exists(METADATA_FILE):
            debug("Metadata file does not exist, initializing")
            init_metadata_file()
            return {}

        # Check if file is empty
        if os.path.getsize(METADATA_FILE) == 0:
            debug("Metadata file is empty, initializing")
            init_metadata_file()
            return {}

        # Load data
        with open(METADATA_FILE, 'r') as f:
            data = json.load(f)

        # Try to decrypt
        try:
            decrypted_data = decrypt_dict(data)
            debug("Successfully loaded and decrypted metadata")

            if not decrypted_data:
                debug("Decrypted metadata is empty")
                return {}

            # Detect format: Check if first key is UUID (per-device) or MAC (global)
            first_key = list(decrypted_data.keys())[0]
            uuid_pattern = r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'

            if re.match(uuid_pattern, first_key, re.IGNORECASE):
                # New per-device format: {device_id: {mac: metadata}}
                debug("Detected per-device format")

                # Normalize MAC addresses within each device
                normalized_data = {}
                for dev_id, device_metadata in decrypted_data.items():
                    normalized_device = {}
                    for mac, metadata in device_metadata.items():
                        normalized_mac = mac.lower()
                        normalized_device[normalized_mac] = metadata
                    normalized_data[dev_id] = normalized_device

                # Update global cache
                _metadata_cache = normalized_data.copy()
                _cache_loaded = True

                # Return specific device or all
                if device_id:
                    result = normalized_data.get(device_id, {})
                    debug(f"Loaded metadata for device {device_id}: {len(result)} entries")
                    return result
                else:
                    total = sum(len(v) for v in normalized_data.values())
                    debug(f"Loaded metadata for {len(normalized_data)} devices, {total} total entries")
                    return normalized_data
            else:
                # Old global format: {mac: metadata}
                debug("Detected global (legacy) format")

                # Normalize MAC addresses
                normalized_data = {}
                for mac, metadata in decrypted_data.items():
                    normalized_mac = mac.lower()
                    normalized_data[normalized_mac] = metadata

                # Update global cache (store in old format)
                _metadata_cache = normalized_data.copy()
                _cache_loaded = True

                debug(f"Loaded {len(normalized_data)} entries in legacy format")
                return normalized_data

        except Exception as decrypt_error:
            # Decryption failed - try unencrypted
            debug(f"Decryption failed: {decrypt_error}")
            if isinstance(data, dict):
                debug("Metadata file appears unencrypted, encrypting...")
                encrypted_data = encrypt_dict(data)
                with open(METADATA_FILE, 'w') as f:
                    json.dump(encrypted_data, f, indent=2)
                os.chmod(METADATA_FILE, 0o600)
                return load_metadata(device_id=device_id, use_cache=False)
            else:
                raise decrypt_error

    except (json.JSONDecodeError, ValueError) as e:
        error(f"Metadata file corrupted: {str(e)}")
        init_metadata_file()
        return {}
    except Exception as e:
        exception(f"Failed to load metadata: {str(e)}")
        return {}


def save_metadata(metadata_dict):
    """
    Encrypt and save device metadata to JSON file.
    Supports both per-device format {device_id: {mac: metadata}} and global format {mac: metadata}.

    Args:
        metadata_dict: Metadata dictionary (per-device or global format)

    Returns:
        bool: True on success, False on error
    """
    global _metadata_cache, _cache_loaded

    debug("Saving device metadata")
    try:
        # Detect format and normalize
        if metadata_dict:
            first_key = list(metadata_dict.keys())[0]
            uuid_pattern = r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'

            if re.match(uuid_pattern, first_key, re.IGNORECASE):
                # Per-device format
                normalized_dict = {}
                for dev_id, device_metadata in metadata_dict.items():
                    normalized_device = {}
                    for mac, metadata in device_metadata.items():
                        normalized_mac = mac.lower()
                        normalized_device[normalized_mac] = metadata
                    normalized_dict[dev_id] = normalized_device
            else:
                # Global format
                normalized_dict = {}
                for mac, metadata in metadata_dict.items():
                    normalized_mac = mac.lower()
                    normalized_dict[normalized_mac] = metadata
        else:
            normalized_dict = {}

        # Encrypt and save
        encrypted_data = encrypt_dict(normalized_dict)
        with open(METADATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(encrypted_data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())

        os.chmod(METADATA_FILE, 0o600)

        # Update cache
        _metadata_cache = normalized_dict.copy()
        _cache_loaded = True

        debug("Successfully saved metadata")
        return True
    except Exception as e:
        exception(f"Failed to save metadata: {str(e)}")
        return False


def get_device_metadata(mac_address, device_id=None):
    """
    Get metadata for a specific MAC address.

    Args:
        mac_address (str): MAC address (will be normalized to lowercase)
        device_id (str, optional): Device ID for per-device format. If None, uses legacy global format.

    Returns:
        dict: Metadata dict with 'name', 'comment', 'tags', 'location' keys, or None if not found
    """
    debug(f"Getting metadata for MAC: {mac_address}, device: {device_id}")

    if device_id:
        # Per-device format
        metadata = load_metadata(device_id=device_id)
    else:
        # Legacy global format
        metadata = load_metadata()

    normalized_mac = mac_address.lower()

    result = metadata.get(normalized_mac)
    if result:
        debug(f"Found metadata for MAC {normalized_mac}")
    else:
        debug(f"No metadata found for MAC {normalized_mac}")

    return result


def update_device_metadata(mac_address, name=None, comment=None, tags=None, location=None, device_id=None):
    """
    Update metadata for a specific MAC address.
    Only provided fields are updated; others remain unchanged.

    Args:
        mac_address (str): MAC address (will be normalized to lowercase)
        name (str, optional): Custom device name
        comment (str, optional): Device comment
        tags (list, optional): List of tag strings
        location (str, optional): Device location/room/building
        device_id (str, optional): Device ID for per-device format. If None, uses legacy global format.

    Returns:
        bool: True on success, False on error
    """
    debug(f"Updating metadata for MAC: {mac_address}, device: {device_id}")

    if device_id:
        # Per-device format
        all_metadata = load_metadata(use_cache=False)
        if device_id not in all_metadata:
            all_metadata[device_id] = {}

        device_metadata = all_metadata[device_id]
        normalized_mac = mac_address.lower()

        if normalized_mac not in device_metadata:
            device_metadata[normalized_mac] = {}

        # Update fields
        if name is not None:
            device_metadata[normalized_mac]['name'] = name
            debug(f"Updated name to: {name}")

        if comment is not None:
            device_metadata[normalized_mac]['comment'] = comment
            debug(f"Updated comment")

        if location is not None:
            device_metadata[normalized_mac]['location'] = location
            debug(f"Updated location to: {location}")

        if tags is not None:
            device_metadata[normalized_mac]['tags'] = [tag.strip() for tag in tags if tag and tag.strip()] if isinstance(tags, list) else []
            debug(f"Updated tags: {device_metadata[normalized_mac]['tags']}")

        all_metadata[device_id] = device_metadata
        return save_metadata(all_metadata)
    else:
        # Legacy global format
        metadata = load_metadata()
        normalized_mac = mac_address.lower()

        if normalized_mac not in metadata:
            metadata[normalized_mac] = {}

        # Update fields
        if name is not None:
            metadata[normalized_mac]['name'] = name
            debug(f"Updated name to: {name}")

        if comment is not None:
            metadata[normalized_mac]['comment'] = comment
            debug(f"Updated comment")

        if location is not None:
            metadata[normalized_mac]['location'] = location
            debug(f"Updated location to: {location}")

        if tags is not None:
            if isinstance(tags, list):
                metadata[normalized_mac]['tags'] = [tag.strip() for tag in tags if tag and tag.strip()]
            else:
                metadata[normalized_mac]['tags'] = []
            debug(f"Updated tags: {metadata[normalized_mac]['tags']}")

        return save_metadata(metadata)


def delete_device_metadata(mac_address, device_id=None):
    """
    Remove metadata entry for a specific MAC address.

    Args:
        mac_address (str): MAC address (will be normalized to lowercase)
        device_id (str, optional): Device ID for per-device format. If None, uses legacy global format.

    Returns:
        bool: True on success, False on error
    """
    debug(f"Deleting metadata for MAC: {mac_address}, device: {device_id}")

    if device_id:
        # Per-device format
        all_metadata = load_metadata(use_cache=False)
        if device_id in all_metadata:
            device_metadata = all_metadata[device_id]
            normalized_mac = mac_address.lower()

            if normalized_mac in device_metadata:
                del device_metadata[normalized_mac]
                debug(f"Deleted metadata for MAC {normalized_mac} from device {device_id}")
                all_metadata[device_id] = device_metadata
                return save_metadata(all_metadata)
            else:
                debug(f"No metadata found for MAC {normalized_mac}, nothing to delete")
                return True
        else:
            debug(f"No metadata found for device {device_id}, nothing to delete")
            return True
    else:
        # Legacy global format
        metadata = load_metadata()
        normalized_mac = mac_address.lower()

        if normalized_mac in metadata:
            del metadata[normalized_mac]
            debug(f"Deleted metadata for MAC {normalized_mac}")
            return save_metadata(metadata)
        else:
            debug(f"No metadata found for MAC {normalized_mac}, nothing to delete")
            return True


def get_all_tags(device_id=None):
    """
    Get a list of all unique tags across all devices.
    Uses cached metadata if available.

    Args:
        device_id (str, optional): Device ID for per-device format. If None, gets tags from all devices.

    Returns:
        list: Sorted list of unique tag strings
    """
    debug(f"Getting all unique tags for device: {device_id}")
    metadata = load_metadata(device_id=device_id, use_cache=True)  # Use cache for performance
    all_tags = set()

    # Check if this is per-device format
    if metadata and any(isinstance(v, dict) and any(isinstance(vv, dict) for vv in v.values()) for v in metadata.values() if isinstance(v, dict)):
        # Per-device format: {device_id: {mac: metadata}}
        for dev_id, device_metadata in metadata.items():
            if isinstance(device_metadata, dict):
                for mac, device_meta in device_metadata.items():
                    if isinstance(device_meta, dict) and 'tags' in device_meta and isinstance(device_meta['tags'], list):
                        all_tags.update(device_meta['tags'])
    else:
        # Legacy global format: {mac: metadata}
        for mac, device_meta in metadata.items():
            if isinstance(device_meta, dict) and 'tags' in device_meta and isinstance(device_meta['tags'], list):
                all_tags.update(device_meta['tags'])

    unique_tags = sorted(list(all_tags))
    debug(f"Found {len(unique_tags)} unique tags")
    return unique_tags

def get_all_locations(device_id=None):
    """
    Get a list of all unique locations across all devices.
    Uses cached metadata if available.

    Args:
        device_id (str, optional): Device ID for per-device format. If None, gets locations from all devices.

    Returns:
        list: Sorted list of unique location strings
    """
    debug(f"Getting all unique locations for device: {device_id}")
    metadata = load_metadata(device_id=device_id, use_cache=True)  # Use cache for performance
    all_locations = set()

    # Check if this is per-device format
    if metadata and any(isinstance(v, dict) and any(isinstance(vv, dict) for vv in v.values()) for v in metadata.values() if isinstance(v, dict)):
        # Per-device format: {device_id: {mac: metadata}}
        for dev_id, device_metadata in metadata.items():
            if isinstance(device_metadata, dict):
                for mac, device_meta in device_metadata.items():
                    if isinstance(device_meta, dict) and 'location' in device_meta and device_meta['location']:
                        location = device_meta['location'].strip()
                        if location:
                            all_locations.add(location)
    else:
        # Legacy global format: {mac: metadata}
        for mac, device_meta in metadata.items():
            if isinstance(device_meta, dict) and 'location' in device_meta and device_meta['location']:
                location = device_meta['location'].strip()
                if location:
                    all_locations.add(location)

    unique_locations = sorted(list(all_locations))
    debug(f"Found {len(unique_locations)} unique locations")
    return unique_locations

def reload_metadata_cache():
    """
    Force reload metadata from disk, updating the global cache.
    Call this when you know metadata has been modified externally.

    Returns:
        dict: Reloaded metadata dictionary
    """
    global _cache_loaded
    _cache_loaded = False  # Force reload
    return load_metadata(use_cache=False)


def import_metadata(metadata_dict):
    """
    Import metadata dictionary, merging with existing metadata.
    This is used for importing backup metadata files.
    Merges imported data with existing data (imported data takes precedence).
    
    Args:
        metadata_dict (dict): Metadata dictionary keyed by MAC address (may be unnormalized)
    
    Returns:
        bool: True on success, False on error
    """
    debug("Importing device metadata")
    try:
        # Load existing metadata
        existing_metadata = load_metadata(use_cache=False)  # Force reload to get latest
        
        # Normalize MAC addresses in imported data
        normalized_import = {}
        for mac, metadata in metadata_dict.items():
            normalized_mac = mac.lower()
            normalized_import[normalized_mac] = metadata
        
        # Merge: imported data takes precedence over existing
        merged_metadata = existing_metadata.copy()
        merged_metadata.update(normalized_import)
        
        # Save merged metadata
        return save_metadata(merged_metadata)
    except Exception as e:
        exception(f"Failed to import metadata: {str(e)}")
        return False

