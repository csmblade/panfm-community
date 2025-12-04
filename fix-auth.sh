#!/bin/bash
# Fix auth.json structure for existing installations
# Run this if you're getting 401 errors after upgrading

echo "Fixing auth.json structure..."

docker exec panfm python3 -c "
import json
import bcrypt
from encryption import encrypt_dict

# Create new structure with bcrypt hash
hashed_password = bcrypt.hashpw('admin'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

auth_data = {
    'users': {
        'admin': {
            'password_hash': hashed_password,
            'must_change_password': True
        }
    }
}

# Encrypt and save
encrypted_data = encrypt_dict(auth_data)
with open('auth.json', 'w') as f:
    json.dump(encrypted_data, f, indent=2)

print('✓ auth.json structure fixed')
print('✓ Username: admin')
print('✓ Password: admin')
"

if [ $? -eq 0 ]; then
    echo ""
    echo "Success! Restarting container..."
    docker compose restart panfm
    echo ""
    echo "✓ You can now login with admin/admin"
else
    echo "✗ Error fixing auth.json"
    exit 1
fi
