#!/usr/bin/env python3
"""Test script to check /api/throughput endpoint response"""
import requests
import json

# Make request to local API
response = requests.get('http://localhost:3000/api/throughput?device_id=22a533e6-95ba-4dd2-9eaa-6aa44caf91c1')

print(f"Status Code: {response.status_code}")
print(f"Content Length: {len(response.text)} bytes")
print(f"\nResponse Headers:")
print(response.headers)
print(f"\nResponse Body:")
try:
    data = response.json()
    print(json.dumps(data, indent=2))

    # Check throughput values specifically
    print(f"\n=== Throughput Values ===")
    print(f"Total: {data.get('total_mbps')}")
    print(f"Inbound: {data.get('inbound_mbps')}")
    print(f"Outbound: {data.get('outbound_mbps')}")
except Exception as e:
    print(f"ERROR parsing JSON: {e}")
    print(response.text)
