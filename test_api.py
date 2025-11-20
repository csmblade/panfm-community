#!/usr/bin/env python3
"""Test API endpoint with session authentication"""
import requests
import json

# Create session
session = requests.Session()

# Login
login_response = session.post('http://localhost:3000/login',
                              data={'username': 'admin', 'password': 'adminadmin'},
                              headers={'Content-Type': 'application/x-www-form-urlencoded'})

print(f"Login status: {login_response.status_code}")
print(f"Login response: {login_response.text[:200]}")

# Test throughput endpoint
api_response = session.get('http://localhost:3000/api/throughput?device_id=22a533e6-95ba-4dd2-9eaa-6aa44caf91c1')
print(f"\nAPI status: {api_response.status_code}")

if api_response.status_code == 200:
    data = api_response.json()
    print(f"\nAPI Response:")
    print(json.dumps(data, indent=2)[:2000])
else:
    print(f"API error: {api_response.text}")
