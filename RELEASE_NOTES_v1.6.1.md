# v1.6.1 - Secure Backup Recovery

## 🔴 Critical Security & Data Recovery Release

This release fixes a **CRITICAL DATA LOSS BUG** that would cause complete backup restoration failure when reinstalling PANfm or migrating to a different server.

---

## 🚨 Critical Issue Fixed

### Problem: Backup Restore Failure After Reinstall

**Before v1.6.1**: If you created a backup and then reinstalled PANfm (or moved to a different server), restoring the backup would **completely fail** because:

1. Original installation generated encryption key `KEY_A`
2. Backup contained data encrypted with `KEY_A`
3. Fresh installation generated new encryption key `KEY_B`
4. Restore attempted to decrypt `KEY_A` data with `KEY_B`
5. **Result**: Decryption failure → all API keys, device metadata, and credentials **LOST**

**Impact**: Backup/Restore feature was **unusable** for disaster recovery scenarios.

### Solution: Encryption Key Included in Backups

**After v1.6.1**: Backups now include the encryption key, enabling successful restore across installations:

1. Original installation generates encryption key `KEY_A`
2. Backup contains data encrypted with `KEY_A` **plus KEY_A itself**
3. Fresh installation generates new encryption key `KEY_B`
4. Restore **writes KEY_A to disk first**, replacing `KEY_B`
5. **Result**: All encrypted data decrypts successfully ✅

---

## 🔐 Security Implications

### Backup File Sensitivity

**IMPORTANT**: Backup files now contain the encryption key, which allows decryption of ALL sensitive data in the backup:
- Device API keys
- User passwords
- Device metadata (names, tags, locations, comments)

### Required Security Measures

Backup files **MUST** be stored securely:

✅ **RECOMMENDED**:
- Encrypted USB drives
- Password manager secure notes
- Encrypted cloud storage (e.g., Tresorit, ProtonDrive)
- Offline encrypted backup location

❌ **DO NOT**:
- Email backup files
- Store in unencrypted cloud storage (Dropbox, Google Drive, etc.)
- Share via messaging apps
- Store in plaintext on shared drives

### Security Enhancements in This Release

1. **Filename Warning**: Backup filename now includes "SECURE" keyword
   - Old: `panfm_backup_20251103_120000.json`
   - New: `panfm_backup_SECURE_20251103_120000.json`

2. **UI Warning**: Prominent security warning displayed after backup creation
   - Explains encryption key inclusion
   - Provides secure storage recommendations
   - Warns against email/unencrypted storage

3. **Documentation**: Updated docstrings with security warnings
   - `create_full_backup()` - Security warning in docstring
   - `export_backup_to_file()` - Security warning in docstring

---

## 📝 Changes in This Release

### Backend Changes

**File**: [backup_restore.py](backup_restore.py)

1. **create_full_backup()** - Lines 54-69:
   ```python
   # Load encryption key (CRITICAL for restore to work)
   import base64
   from encryption import load_key
   encryption_key = load_key()
   encryption_key_b64 = base64.b64encode(encryption_key).decode('utf-8')

   # Add to backup structure
   backup = {
       'version': '1.6.1',
       'encryption_key': encryption_key_b64,  # NEW FIELD
       ...
   }
   ```

2. **restore_from_backup()** - Lines 123-152:
   ```python
   # Restore encryption key FIRST (before any encrypted data)
   if 'encryption_key' in backup_data:
       key_bytes = base64.b64decode(backup_data['encryption_key'])
       with open(KEY_FILE, 'wb') as f:
           f.write(key_bytes)
       os.chmod(KEY_FILE, 0o600)  # Secure permissions
   ```

3. **export_backup_to_file()** - Line 241:
   ```python
   # Filename includes "SECURE" warning
   filename = f"panfm_backup_SECURE_{timestamp}.json"
   ```

### Frontend Changes

**File**: [static/pages-backup-restore.js](static/pages-backup-restore.js)

1. **createAndDownloadBackup()** - Lines 89-109:
   - Changed success message background to warning yellow (`#fff3cd`)
   - Added prominent security warning box (red left border)
   - Lists recommended secure storage locations
   - Warns against email and plaintext storage

### Version Updates

**File**: [version.py](version.py)

1. Updated version to v1.6.1 "Secure Backup Recovery"
2. Added comprehensive changelog entry
3. Updated backup version in `create_full_backup()` to "1.6.1"

---

## 🔄 Backwards Compatibility

### Old Backups (v1.6.0 and earlier)

Backups created **before v1.6.1** do not contain the encryption key field.

**What happens when restoring old backups:**
1. PANfm detects missing `encryption_key` field
2. Logs warning: "Backup does not contain encryption_key field (old format)"
3. Proceeds with restore attempt using **current** encryption.key
4. **Success** if current key matches original key (same installation)
5. **Failure** if current key differs (reinstall/migration)

**Recommendation**: Create new backups with v1.6.1+ for disaster recovery.

---

## 🧪 Testing Recommendations

### Test Scenario 1: Fresh Install with Restore

1. Create backup with current installation
2. Stop PANfm and **delete** `encryption.key`
3. Restart PANfm (new key generated)
4. Restore backup
5. ✅ Verify devices load with correct API keys
6. ✅ Verify device metadata displays correctly
7. ✅ Verify can log in with user credentials

### Test Scenario 2: Server Migration

1. Create backup on Server A
2. Install PANfm on Server B (fresh installation)
3. Restore backup from Server A on Server B
4. ✅ Verify all devices, metadata, and settings restored

### Test Scenario 3: Backup File Contents

1. Create backup
2. Open downloaded JSON file
3. ✅ Verify `encryption_key` field exists
4. ✅ Verify key is base64-encoded string (44 characters)
5. ✅ Verify filename contains "SECURE" keyword

---

## 📦 Upgrade Instructions

### Docker Deployment

```bash
git pull
docker-compose down
docker-compose up -d --build
```

### CLI Deployment

```bash
git pull
source venv/bin/activate  # Linux/Mac
# or: venv\Scripts\activate  # Windows
pip install -r requirements.txt
python app.py
```

---

## 🔗 Related Releases

- **v1.6.0** - Backup & Restore (2025-11-03)
- **v1.5.4** - Security & Compliance (2025-11-03)
- **v1.5.3** - Device Metadata (2025-11-03)

---

## ⚠️ Breaking Changes

**None** - This release is fully backward compatible with v1.6.0.

---

## 🙏 Acknowledgments

Special thanks to the user who identified this critical issue during testing. This fix ensures PANfm backups work correctly for disaster recovery scenarios.

---

## 📊 File Changes Summary

| File | Lines Changed | Purpose |
|------|--------------|---------|
| backup_restore.py | +35 | Add encryption key to backup/restore |
| pages-backup-restore.js | +19 | Add security warnings in UI |
| version.py | +24 | Update version and changelog |
| RELEASE_NOTES_v1.6.1.md | +230 | This document |

**Total**: 4 files modified, 308 lines changed

---

**Full Changelog**: https://github.com/csmblade/panfm/compare/v1.6.0...v1.6.1

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
