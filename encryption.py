"""
Encryption utilities for PANfm application.
Provides site-wide encryption for sensitive data including settings and credentials.

Uses Fernet symmetric encryption (AES 128 in CBC mode with HMAC for authentication).
"""

import os
import base64
from cryptography.fernet import Fernet


# Encryption key file location
KEY_FILE = 'encryption.key'


def generate_key():
    """
    Generate a new encryption key and save it to file.
    This should only be called once during initial setup.
    Sets file permissions to 600 (owner read/write only) for security.

    Returns:
        bytes: The generated encryption key
    """
    try:
        from logger import debug
        debug("generate_key called - creating new encryption key")
    except:
        pass
    key = Fernet.generate_key()

    try:
        with open(KEY_FILE, 'wb') as key_file:
            key_file.write(key)

        # Set file permissions to 600 (owner read/write only)
        os.chmod(KEY_FILE, 0o600)
    except Exception as e:
        raise Exception(f"Failed to save encryption key: {e}")

    return key


def check_key_permissions():
    """
    Check and fix encryption key file permissions.
    Ensures the key file has 600 permissions (owner read/write only).

    Returns:
        bool: True if permissions are correct or were fixed, False on error
    """
    try:
        from logger import debug
        debug("check_key_permissions called for %s", KEY_FILE)
    except:
        pass
    if not os.path.exists(KEY_FILE):
        return True  # File doesn't exist yet, will be created with correct permissions

    try:
        # Get current permissions
        current_permissions = os.stat(KEY_FILE).st_mode & 0o777

        # Check if permissions are too permissive (not 600)
        if current_permissions != 0o600:
            # Fix permissions
            os.chmod(KEY_FILE, 0o600)
            return True

        return True
    except Exception:
        return False


def load_key():
    """
    Load the encryption key from file.
    If the key file doesn't exist, generate a new one.
    Verifies/fixes file permissions on load.

    Returns:
        bytes: The encryption key
    """
    try:
        from logger import debug
        debug("load_key called for %s", KEY_FILE)
    except:
        pass
    if not os.path.exists(KEY_FILE):
        return generate_key()

    # Check and fix permissions if needed
    check_key_permissions()

    try:
        with open(KEY_FILE, 'rb') as key_file:
            key = key_file.read()
        return key
    except Exception as e:
        raise Exception(f"Failed to load encryption key: {e}")


def get_cipher():
    """
    Get a Fernet cipher instance using the loaded key.

    Returns:
        Fernet: Cipher instance for encryption/decryption
    """
    try:
        from logger import debug
        debug("get_cipher called")
    except:
        pass
    key = load_key()
    return Fernet(key)


def encrypt_string(plaintext):
    """
    Encrypt a string value.

    Args:
        plaintext (str): The string to encrypt

    Returns:
        str: Base64-encoded encrypted string

    Raises:
        Exception: If encryption fails
    """
    if not plaintext:
        return ""

    try:
        cipher = get_cipher()
        encrypted_bytes = cipher.encrypt(plaintext.encode('utf-8'))
        encrypted_string = base64.b64encode(encrypted_bytes).decode('utf-8')
        return encrypted_string
    except Exception as e:
        # Log the error (import logger only when needed to avoid circular deps)
        try:
            from logger import error
            error(f"Failed to encrypt string: {str(e)}")
        except:
            pass
        raise Exception(f"Encryption failed: {str(e)}")


def decrypt_string(encrypted_text):
    """
    Decrypt an encrypted string value.
    If decryption fails, logs the error and raises an exception.

    Args:
        encrypted_text (str): Base64-encoded encrypted string

    Returns:
        str: Decrypted plaintext string

    Raises:
        Exception: If decryption fails
    """
    if not encrypted_text:
        return ""

    try:
        cipher = get_cipher()
        encrypted_bytes = base64.b64decode(encrypted_text.encode('utf-8'))
        decrypted_bytes = cipher.decrypt(encrypted_bytes)
        decrypted_string = decrypted_bytes.decode('utf-8')
        return decrypted_string
    except Exception as e:
        # Log the error (import logger only when needed to avoid circular deps)
        try:
            from logger import error
            error(f"Failed to decrypt string: {str(e)}")
        except:
            pass
        raise Exception(f"Decryption failed: {str(e)}")


def encrypt_dict(data_dict):
    """
    Encrypt all string values in a dictionary (recursive).
    Non-string values are left unchanged.

    Args:
        data_dict (dict): Dictionary with values to encrypt

    Returns:
        dict: Dictionary with encrypted string values
    """
    if not isinstance(data_dict, dict):
        return data_dict

    encrypted_dict = {}

    for key, value in data_dict.items():
        if isinstance(value, str):
            encrypted_dict[key] = encrypt_string(value)
        elif isinstance(value, dict):
            encrypted_dict[key] = encrypt_dict(value)
        elif isinstance(value, list):
            encrypted_dict[key] = [
                encrypt_dict(item) if isinstance(item, dict)
                else encrypt_string(item) if isinstance(item, str)
                else item
                for item in value
            ]
        else:
            # Numbers, booleans, None, etc. are not encrypted
            encrypted_dict[key] = value

    return encrypted_dict


def decrypt_dict(encrypted_dict):
    """
    Decrypt all string values in a dictionary (recursive).
    Non-string values are left unchanged.

    Args:
        encrypted_dict (dict): Dictionary with encrypted string values

    Returns:
        dict: Dictionary with decrypted string values
    """
    if not isinstance(encrypted_dict, dict):
        return encrypted_dict

    decrypted_dict = {}

    for key, value in encrypted_dict.items():
        if isinstance(value, str):
            # Only decrypt if the value appears to be encrypted
            if is_encrypted(value):
                decrypted_dict[key] = decrypt_string(value)
            else:
                # Not encrypted (e.g., bcrypt hash), leave as-is
                decrypted_dict[key] = value
        elif isinstance(value, dict):
            decrypted_dict[key] = decrypt_dict(value)
        elif isinstance(value, list):
            decrypted_dict[key] = [
                decrypt_dict(item) if isinstance(item, dict)
                else decrypt_string(item) if (isinstance(item, str) and is_encrypted(item))
                else item
                for item in value
            ]
        else:
            # Numbers, booleans, None, etc. are not encrypted
            decrypted_dict[key] = value

    return decrypted_dict


def is_encrypted(value):
    """
    Check if a string value appears to be encrypted with Fernet.
    This checks for the actual Fernet token format.

    Args:
        value (str): String to check

    Returns:
        bool: True if the value appears to be Fernet-encrypted, False otherwise
    """
    try:
        from logger import debug
        debug("is_encrypted called for value of length: %d", len(value) if value else 0)
    except:
        pass
    if not isinstance(value, str) or not value:
        return False

    # Bcrypt hashes start with $2b$ or $2a$ or $2y$ - these are NOT encrypted
    if value.startswith(('$2b$', '$2a$', '$2y$')):
        return False

    try:
        # Encrypted values should be base64-encoded
        decoded = base64.b64decode(value.encode('utf-8'))
        # Fernet tokens MUST start with 'gAAAAA' (version byte 0x80) after base64 decoding
        # This is the Fernet token format signature
        is_fernet = decoded.startswith(b'gAAAAA')
        if is_fernet:
            try:
                debug(f"Value appears to be Fernet-encrypted (starts with gAAAAA, length {len(value)})")
            except:
                pass
        return is_fernet
    except Exception:
        return False


def migrate_unencrypted_data(data_dict):
    """
    Migrate unencrypted data to encrypted format.
    Only encrypts values that don't appear to be already encrypted.

    Args:
        data_dict (dict): Dictionary that may contain unencrypted data

    Returns:
        dict: Dictionary with all string values encrypted
    """
    try:
        from logger import debug
        debug("migrate_unencrypted_data called with %d top-level keys", len(data_dict))
    except:
        pass
    migrated_dict = {}

    for key, value in data_dict.items():
        if isinstance(value, str):
            if is_encrypted(value):
                migrated_dict[key] = value
            else:
                migrated_dict[key] = encrypt_string(value)
        elif isinstance(value, dict):
            migrated_dict[key] = migrate_unencrypted_data(value)
        elif isinstance(value, list):
            migrated_dict[key] = [
                migrate_unencrypted_data(item) if isinstance(item, dict)
                else encrypt_string(item) if isinstance(item, str) and not is_encrypted(item)
                else item
                for item in value
            ]
        else:
            migrated_dict[key] = value

    return migrated_dict
