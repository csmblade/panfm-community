#!/usr/bin/env python3
"""Check database schema for throughput_samples table"""
import sqlite3

conn = sqlite3.connect('/app/throughput_history.db', timeout=5)
cursor = conn.cursor()
cursor.execute('PRAGMA table_info(throughput_samples)')
columns = cursor.fetchall()
print(f'Total columns: {len(columns)}')
print('\nColumn list:')
for col in columns:
    print(f'{col[1]}  (type: {col[2]})')
conn.close()
