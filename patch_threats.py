#!/usr/bin/env python3
"""
Enterprise Threat System Patch
Separates threat severities: Critical, High, Medium, Blocked URLs
Makes the system reusable and scalable for future features
"""

# Read the firewall_api_logs.py file
with open('firewall_api_logs.py', 'r') as f:
    content = f.read()

# Step 1: Add high_count and high_logs variables
old_vars = '''        medium_count = 0
        critical_count = 0
        url_blocked = 0

        critical_logs = []
        medium_logs = []
        blocked_url_logs = []'''

new_vars = '''        critical_count = 0
        high_count = 0
        medium_count = 0
        url_blocked = 0

        critical_logs = []
        high_logs = []
        medium_logs = []
        blocked_url_logs = []'''

content = content.replace(old_vars, new_vars)

# Step 2: Update severity checking logic to separate critical and high
old_severity_check = '''                # Check severity (try different common severity values)
                if severity is not None and severity.text:
                    sev_lower = severity.text.lower()

                    if sev_lower in ['medium', 'med']:
                        medium_count += 1
                        if len(medium_logs) < max_logs:
                            medium_logs.append(log_entry)
                    elif sev_lower in ['critical', 'high', 'crit']:
                        critical_count += 1
                        if len(critical_logs) < max_logs:
                            critical_logs.append(log_entry)'''

new_severity_check = '''                # Check severity - Enterprise scalable structure
                # Supports: critical, high, medium (easy to extend for low, informational)
                if severity is not None and severity.text:
                    sev_lower = severity.text.lower()

                    if sev_lower in ['critical', 'crit']:
                        critical_count += 1
                        if len(critical_logs) < max_logs:
                            critical_logs.append(log_entry)
                    elif sev_lower in ['high']:
                        high_count += 1
                        if len(high_logs) < max_logs:
                            high_logs.append(log_entry)
                    elif sev_lower in ['medium', 'med']:
                        medium_count += 1
                        if len(medium_logs) < max_logs:
                            medium_logs.append(log_entry)'''

content = content.replace(old_severity_check, new_severity_check)

# Step 3: Update return statement to include high severity data
old_return = '''        return {
            'critical_count': critical_count,
            'medium_count': medium_count,
            'url_blocked': url_blocked,
            'critical_logs': critical_logs,
            'medium_logs': medium_logs,
            'blocked_url_logs': blocked_url_logs,'''

new_return = '''        return {
            'critical_count': critical_count,
            'high_count': high_count,
            'medium_count': medium_count,
            'url_blocked': url_blocked,
            'critical_logs': critical_logs,
            'high_logs': high_logs,
            'medium_logs': medium_logs,
            'blocked_url_logs': blocked_url_logs,'''

content = content.replace(old_return, new_return)

# Write the patched content back
with open('firewall_api_logs.py', 'w') as f:
    f.write(content)

print('[OK] firewall_api_logs.py patched successfully')
print('   - Added high_count and high_logs tracking')
print('   - Separated critical from high severity')
print('   - Returns enterprise-grade threat data structure')
