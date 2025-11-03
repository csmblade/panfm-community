# PANfm v1.6.0 - Backup & Restore System Implementation Guide

**Feature**: Site-Wide Backup & Restore with Per-Device Metadata
**Branch**: test
**Target Version**: v1.6.0 "Backup & Restore"

---

## Implementation Status: READY TO IMPLEMENT

This document provides complete implementation details for adding comprehensive backup/restore functionality and migrating device metadata to per-device structure.

---

## Overview

**Problem**:
- Device metadata is currently global (shared across all firewalls)
- No comprehensive backup/restore capability
- Import/export buried in Databases tab

**Solution**:
- Migrate metadata to per-device structure (`{device_id: {mac: metadata}}`)
- Create comprehensive backup system (Settings + Devices + Metadata)
- New dedicated "Backup & Restore" tab in Settings
- Full site restore capability

---

## Phase 1: Migrate Metadata to Per-Device Structure

### Step 1.1: Update device_metadata.py

**File**: `device_metadata.py` (366 lines → ~480 lines)

Add these imports at top:
```python
import re
from config import load_settings
```

Add migration detection function after `reload_metadata_cache()`:

```python
def check_migration_needed():
    """
    Check if metadata needs migration from global to per-device format.

    Returns:
        bool: True if migration needed, False if already migrated or empty
    """
    debug("Checking if metadata migration is needed")
    try:
        if not os.path.exists(METADATA_FILE):
            debug("Metadata file doesn't exist, no migration needed")
            return False

        if os.path.getsize(METADATA_FILE) == 0:
            debug("Metadata file is empty, no migration needed")
            return False

        # Load raw data
        with open(METADATA_FILE, 'r') as f:
            encrypted_data = json.load(f)

        decrypted_data = decrypt_dict(encrypted_data)

        if not decrypted_data:
            debug("Metadata is empty, no migration needed")
            return False

        # Check structure: UUID pattern at top level = new format
        first_key = list(decrypted_data.keys())[0]
        uuid_pattern = r'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'

        if re.match(uuid_pattern, first_key, re.IGNORECASE):
            debug("Metadata already in per-device format")
            return False
        else:
            debug("Metadata needs migration from global to per-device format")
            return True
    except Exception as e:
        exception(f"Error checking migration status: {str(e)}")
        return False
```

Add migration function:

```python
def migrate_global_to_per_device(target_device_id=None):
    """
    One-time migration: Convert old global structure to per-device structure.
    Assigns all existing metadata to target_device_id.

    Args:
        target_device_id: Device ID to assign metadata to. If None, uses selected_device_id from settings.

    Returns:
        bool: True on success, False on error
    """
    debug("Starting metadata migration from global to per-device format")
    try:
        # Determine target device
        if target_device_id is None:
            settings = load_settings()
            target_device_id = settings.get('selected_device_id')
            if not target_device_id:
                error("No target device specified and no selected device in settings")
                return False

        debug(f"Migrating metadata to device: {target_device_id}")

        # Load old format data
        with open(METADATA_FILE, 'r') as f:
            encrypted_data = json.load(f)

        old_data = decrypt_dict(encrypted_data)
        debug(f"Loaded {len(old_data)} metadata entries in old format")

        # Create new format: {device_id: {mac: metadata}}
        new_data = {
            target_device_id: old_data
        }

        # Save in new format
        success = save_metadata(new_data)

        if success:
            info(f"Successfully migrated {len(old_data)} metadata entries to device {target_device_id}")
        else:
            error("Failed to save migrated metadata")

        return success
    except Exception as e:
        exception(f"Metadata migration failed: {str(e)}")
        return False
```

Update `load_metadata()` function - replace entire function:

```python
def load_metadata(device_id=None, use_cache=True):
    """
    Load and decrypt device metadata from JSON file.
    Supports both per-device format (new) and global format (legacy).

    Args:
        device_id: Specific device ID to load metadata for. If None and per-device format, returns all.
        use_cache: If True, returns cached metadata if available. If False, forces reload from disk.

    Returns:
        dict: If device_id provided: {mac: metadata}
              If device_id None: {device_id: {mac: metadata}} (per-device format) or {mac: metadata} (legacy)
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
```

Update `save_metadata()` - replace entire function:

```python
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
```

Update remaining functions to accept `device_id` parameter - modify these functions:

**get_device_metadata** - add device_id parameter:
```python
def get_device_metadata(mac_address, device_id=None):
    """Get metadata for specific MAC on specific device"""
    debug(f"Getting metadata for MAC: {mac_address}, device: {device_id}")

    if device_id:
        metadata = load_metadata(device_id=device_id)
    else:
        # Legacy: load global
        metadata = load_metadata()

    normalized_mac = mac_address.lower()
    return metadata.get(normalized_mac)
```

**update_device_metadata** - add device_id parameter:
```python
def update_device_metadata(mac_address, name=None, comment=None, tags=None, location=None, device_id=None):
    """Update metadata for specific MAC on specific device"""
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

        # Update fields...
        if name is not None:
            device_metadata[normalized_mac]['name'] = name
        if comment is not None:
            device_metadata[normalized_mac]['comment'] = comment
        if location is not None:
            device_metadata[normalized_mac]['location'] = location
        if tags is not None:
            device_metadata[normalized_mac]['tags'] = [tag.strip() for tag in tags if tag and tag.strip()] if isinstance(tags, list) else []

        all_metadata[device_id] = device_metadata
        return save_metadata(all_metadata)
    else:
        # Legacy global format
        metadata = load_metadata()
        normalized_mac = mac_address.lower()

        if normalized_mac not in metadata:
            metadata[normalized_mac] = {}

        # Update fields...
        if name is not None:
            metadata[normalized_mac]['name'] = name
        if comment is not None:
            metadata[normalized_mac]['comment'] = comment
        if location is not None:
            metadata[normalized_mac]['location'] = location
        if tags is not None:
            metadata[normalized_mac]['tags'] = [tag.strip() for tag in tags if tag and tag.strip()] if isinstance(tags, list) else []

        return save_metadata(metadata)
```

Similarly update `delete_device_metadata`, `get_all_tags`, `get_all_locations` with device_id parameter.

---

## DUE TO CONTEXT LIMITS

This implementation is too large to complete in one session. I recommend:

1. **Stop here** and I'll create separate focused commits
2. **OR** Continue in a new conversation with this implementation guide
3. **OR** I can create a pull request template with all code changes

The complete implementation requires modifying 11 files with ~1500 lines of changes total. This exceeds what can be done effectively in remaining context.

**Recommendation**: Let's commit the branching strategy documentation we just added, then start fresh for this major v1.6.0 feature in a new session.

Would you like me to:
- A) Commit the branch documentation now
- B) Continue with partial implementation (just Phase 1)
- C) Pause and resume in new conversation
