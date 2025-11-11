"""
Notification Manager for PANfm Alerting System
Handles sending notifications via email, webhooks, and Slack
"""
import os
import json
import smtplib
import requests
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from typing import Dict, List, Optional
from logger import debug, info, warning, error, exception


class NotificationManager:
    """
    Manages notification dispatch for triggered alerts.

    Supports:
    - Email notifications via SMTP
    - Webhook notifications (generic HTTP POST)
    - Slack notifications via incoming webhooks
    """

    def __init__(self):
        """Initialize notification manager."""
        debug("NotificationManager initialized")
        self.email_config = self._load_email_config()
        self.webhook_config = self._load_webhook_config()
        self.slack_config = self._load_slack_config()

    def _load_email_config(self) -> Dict:
        """
        Load email configuration from settings.json first, then fall back to environment variables.

        Returns:
            Dict with email configuration
        """
        try:
            from config import load_notification_channels
            channels = load_notification_channels()
            email_config = channels.get('email', {})

            # If settings.json has email config, use it
            if email_config and email_config.get('smtp_host'):
                debug("Loading email config from settings.json")
                # Ensure to_emails is a list
                to_emails = email_config.get('to_emails', [])
                if isinstance(to_emails, str):
                    to_emails = [e.strip() for e in to_emails.split(',') if e.strip()]

                return {
                    'enabled': email_config.get('enabled', False),
                    'smtp_host': email_config.get('smtp_host', 'smtp.gmail.com'),
                    'smtp_port': email_config.get('smtp_port', 587),
                    'smtp_user': email_config.get('smtp_user', ''),
                    'smtp_password': email_config.get('smtp_password', ''),
                    'from_email': email_config.get('from_email', ''),
                    'to_emails': to_emails,
                    'use_tls': email_config.get('use_tls', True)
                }
        except Exception as e:
            debug(f"Failed to load email config from settings.json: {e}")

        # Fall back to environment variables
        debug("Loading email config from environment variables")
        to_emails = os.environ.get('ALERT_TO_EMAILS', '')
        to_emails_list = [e.strip() for e in to_emails.split(',') if e.strip()] if to_emails else []

        return {
            'enabled': os.environ.get('ALERT_EMAIL_ENABLED', 'false').lower() == 'true',
            'smtp_host': os.environ.get('ALERT_SMTP_HOST', 'smtp.gmail.com'),
            'smtp_port': int(os.environ.get('ALERT_SMTP_PORT', '587')),
            'smtp_user': os.environ.get('ALERT_SMTP_USER', ''),
            'smtp_password': os.environ.get('ALERT_SMTP_PASSWORD', ''),
            'from_email': os.environ.get('ALERT_FROM_EMAIL', ''),
            'to_emails': to_emails_list,
            'use_tls': os.environ.get('ALERT_SMTP_TLS', 'true').lower() == 'true'
        }

    def _load_webhook_config(self) -> Dict:
        """
        Load webhook configuration from settings.json first, then fall back to environment variables.

        Returns:
            Dict with webhook configuration
        """
        try:
            from config import load_notification_channels
            channels = load_notification_channels()
            webhook_config = channels.get('webhook', {})

            # If settings.json has webhook config, use it
            if webhook_config and webhook_config.get('url'):
                debug("Loading webhook config from settings.json")
                # Parse headers if provided as string
                headers = webhook_config.get('headers', {})
                if isinstance(headers, str):
                    try:
                        headers = json.loads(headers)
                    except json.JSONDecodeError:
                        debug("Failed to parse webhook headers JSON, using empty dict")
                        headers = {}

                return {
                    'enabled': webhook_config.get('enabled', False),
                    'url': webhook_config.get('url', ''),
                    'headers': headers
                }
        except Exception as e:
            debug(f"Failed to load webhook config from settings.json: {e}")

        # Fall back to environment variables
        debug("Loading webhook config from environment variables")
        return {
            'enabled': os.environ.get('ALERT_WEBHOOK_ENABLED', 'false').lower() == 'true',
            'url': os.environ.get('ALERT_WEBHOOK_URL', ''),
            'headers': json.loads(os.environ.get('ALERT_WEBHOOK_HEADERS', '{}'))
        }

    def _load_slack_config(self) -> Dict:
        """
        Load Slack configuration from settings.json first, then fall back to environment variables.

        Returns:
            Dict with Slack configuration
        """
        try:
            from config import load_notification_channels
            channels = load_notification_channels()
            slack_config = channels.get('slack', {})

            # If settings.json has Slack config, use it
            if slack_config and slack_config.get('webhook_url'):
                debug("Loading Slack config from settings.json")
                return {
                    'enabled': slack_config.get('enabled', False),
                    'webhook_url': slack_config.get('webhook_url', ''),
                    'channel': slack_config.get('channel', '#alerts'),
                    'username': slack_config.get('username', 'PANfm Alerts')
                }
        except Exception as e:
            debug(f"Failed to load Slack config from settings.json: {e}")

        # Fall back to environment variables
        debug("Loading Slack config from environment variables")
        return {
            'enabled': os.environ.get('ALERT_SLACK_ENABLED', 'false').lower() == 'true',
            'webhook_url': os.environ.get('ALERT_SLACK_WEBHOOK_URL', ''),
            'channel': os.environ.get('ALERT_SLACK_CHANNEL', '#alerts'),
            'username': os.environ.get('ALERT_SLACK_USERNAME', 'PANfm Alerts')
        }

    def reload_config(self):
        """
        Reload notification channel configurations from settings.json.
        Useful after updating notification settings via the API.
        """
        debug("Reloading notification configurations from settings.json")
        self.email_config = self._load_email_config()
        self.webhook_config = self._load_webhook_config()
        self.slack_config = self._load_slack_config()
        info("Notification configurations reloaded successfully")

    def send_alert(self, alert_config: Dict, message: str, history_id: int,
                  device_name: str = None, actual_value: float = None) -> Dict:
        """
        Send alert notification via all configured channels.

        Args:
            alert_config: Alert configuration dictionary
            message: Formatted alert message
            history_id: Alert history ID
            device_name: Optional device name
            actual_value: Optional actual metric value

        Returns:
            Dict with success status per channel
        """
        debug(f"Sending alert notification (ID: {history_id})")

        notification_channels = alert_config.get('notification_channels', [])
        results = {
            'email': {'enabled': False, 'sent': False, 'error': None},
            'webhook': {'enabled': False, 'sent': False, 'error': None},
            'slack': {'enabled': False, 'sent': False, 'error': None}
        }

        # Prepare alert data
        alert_data = {
            'alert_id': history_id,
            'severity': alert_config['severity'],
            'metric_type': alert_config['metric_type'],
            'threshold_value': alert_config['threshold_value'],
            'threshold_operator': alert_config['threshold_operator'],
            'actual_value': actual_value,
            'message': message,
            'device_name': device_name,
            'device_id': alert_config['device_id'],
            'timestamp': datetime.now().isoformat()
        }

        # Send email notification
        if 'email' in notification_channels and self.email_config['enabled']:
            results['email']['enabled'] = True
            email_result = self._send_email(alert_data)
            results['email']['sent'] = email_result['success']
            results['email']['error'] = email_result.get('error')

        # Send webhook notification
        if 'webhook' in notification_channels and self.webhook_config['enabled']:
            results['webhook']['enabled'] = True
            webhook_result = self._send_webhook(alert_data)
            results['webhook']['sent'] = webhook_result['success']
            results['webhook']['error'] = webhook_result.get('error')

        # Send Slack notification
        if 'slack' in notification_channels and self.slack_config['enabled']:
            results['slack']['enabled'] = True
            slack_result = self._send_slack(alert_data)
            results['slack']['sent'] = slack_result['success']
            results['slack']['error'] = slack_result.get('error')

        # Log results
        sent_count = sum(1 for r in results.values() if r['sent'])
        enabled_count = sum(1 for r in results.values() if r['enabled'])
        info(f"Alert {history_id} sent to {sent_count}/{enabled_count} channels")

        return results

    def _send_email(self, alert_data: Dict) -> Dict:
        """
        Send email notification.

        Args:
            alert_data: Alert data dictionary

        Returns:
            Dict with success status and optional error
        """
        debug("Attempting to send email notification")

        try:
            # Validate configuration
            if not self.email_config['smtp_user'] or not self.email_config['from_email']:
                warning("Email configuration incomplete, skipping")
                return {'success': False, 'error': 'Configuration incomplete'}

            # Build email
            msg = MIMEMultipart('alternative')
            msg['Subject'] = self._format_email_subject(alert_data)
            msg['From'] = self.email_config['from_email']
            msg['To'] = ', '.join(self.email_config['to_emails'])

            # Plain text version
            text_body = self._format_email_text(alert_data)
            msg.attach(MIMEText(text_body, 'plain'))

            # HTML version
            html_body = self._format_email_html(alert_data)
            msg.attach(MIMEText(html_body, 'html'))

            # Send email
            with smtplib.SMTP(self.email_config['smtp_host'], self.email_config['smtp_port']) as server:
                if self.email_config['use_tls']:
                    server.starttls()

                if self.email_config['smtp_password']:
                    server.login(self.email_config['smtp_user'], self.email_config['smtp_password'])

                server.send_message(msg)

            debug("Email notification sent successfully")
            return {'success': True}

        except Exception as e:
            exception(f"Failed to send email: {e}")
            return {'success': False, 'error': str(e)}

    def _send_webhook(self, alert_data: Dict) -> Dict:
        """
        Send webhook notification.

        Args:
            alert_data: Alert data dictionary

        Returns:
            Dict with success status and optional error
        """
        debug("Attempting to send webhook notification")

        try:
            if not self.webhook_config['url']:
                warning("Webhook URL not configured, skipping")
                return {'success': False, 'error': 'URL not configured'}

            # Build webhook payload
            payload = {
                'event': 'alert_triggered',
                'alert': alert_data
            }

            # Send webhook
            headers = {'Content-Type': 'application/json'}
            headers.update(self.webhook_config.get('headers', {}))

            response = requests.post(
                self.webhook_config['url'],
                json=payload,
                headers=headers,
                timeout=10
            )

            if response.status_code < 300:
                debug(f"Webhook sent successfully (status: {response.status_code})")
                return {'success': True}
            else:
                warning(f"Webhook returned status {response.status_code}")
                return {'success': False, 'error': f'HTTP {response.status_code}'}

        except Exception as e:
            exception(f"Failed to send webhook: {e}")
            return {'success': False, 'error': str(e)}

    def _send_slack(self, alert_data: Dict) -> Dict:
        """
        Send Slack notification.

        Args:
            alert_data: Alert data dictionary

        Returns:
            Dict with success status and optional error
        """
        debug("Attempting to send Slack notification")

        try:
            if not self.slack_config['webhook_url']:
                warning("Slack webhook URL not configured, skipping")
                return {'success': False, 'error': 'Webhook URL not configured'}

            # Build Slack message
            payload = self._format_slack_message(alert_data)

            # Send to Slack
            response = requests.post(
                self.slack_config['webhook_url'],
                json=payload,
                timeout=10
            )

            if response.status_code == 200:
                debug("Slack notification sent successfully")
                return {'success': True}
            else:
                warning(f"Slack returned status {response.status_code}")
                return {'success': False, 'error': f'HTTP {response.status_code}'}

        except Exception as e:
            exception(f"Failed to send Slack notification: {e}")
            return {'success': False, 'error': str(e)}

    def _format_email_subject(self, alert_data: Dict) -> str:
        """Format email subject line."""
        severity = alert_data['severity'].upper()
        device = alert_data.get('device_name', alert_data['device_id'])
        metric = alert_data['metric_type'].replace('_', ' ').title()

        return f"[PANfm {severity}] {metric} Alert - {device}"

    def _format_email_text(self, alert_data: Dict) -> str:
        """Format plain text email body."""
        lines = [
            "PANfm Alert Notification",
            "=" * 50,
            "",
            f"Severity: {alert_data['severity'].upper()}",
            f"Device: {alert_data.get('device_name', alert_data['device_id'])}",
            f"Metric: {alert_data['metric_type'].replace('_', ' ').title()}",
            f"Threshold: {alert_data['threshold_operator']} {alert_data['threshold_value']}",
            f"Actual Value: {alert_data['actual_value']}",
            f"Message: {alert_data['message']}",
            f"Time: {alert_data['timestamp']}",
            f"Alert ID: {alert_data['alert_id']}",
            "",
            "=" * 50,
            "This is an automated alert from PANfm.",
            "Please acknowledge this alert in the PANfm dashboard."
        ]
        return "\n".join(lines)

    def _format_email_html(self, alert_data: Dict) -> str:
        """Format HTML email body."""
        severity_colors = {
            'critical': '#dc3545',
            'warning': '#ffc107',
            'info': '#17a2b8'
        }
        color = severity_colors.get(alert_data['severity'], '#6c757d')

        html = f"""
        <html>
        <head>
            <style>
                body {{ font-family: Arial, sans-serif; line-height: 1.6; }}
                .container {{ max-width: 600px; margin: 0 auto; padding: 20px; }}
                .header {{ background-color: {color}; color: white; padding: 15px; border-radius: 5px; }}
                .content {{ background-color: #f8f9fa; padding: 20px; margin-top: 10px; border-radius: 5px; }}
                .field {{ margin-bottom: 10px; }}
                .label {{ font-weight: bold; color: #495057; }}
                .value {{ color: #212529; }}
                .footer {{ margin-top: 20px; padding-top: 10px; border-top: 1px solid #dee2e6; color: #6c757d; font-size: 0.9em; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2 style="margin: 0;">PANfm Alert - {alert_data['severity'].upper()}</h2>
                </div>
                <div class="content">
                    <div class="field">
                        <span class="label">Device:</span>
                        <span class="value">{alert_data.get('device_name', alert_data['device_id'])}</span>
                    </div>
                    <div class="field">
                        <span class="label">Metric:</span>
                        <span class="value">{alert_data['metric_type'].replace('_', ' ').title()}</span>
                    </div>
                    <div class="field">
                        <span class="label">Threshold:</span>
                        <span class="value">{alert_data['threshold_operator']} {alert_data['threshold_value']}</span>
                    </div>
                    <div class="field">
                        <span class="label">Actual Value:</span>
                        <span class="value">{alert_data['actual_value']}</span>
                    </div>
                    <div class="field">
                        <span class="label">Message:</span>
                        <span class="value">{alert_data['message']}</span>
                    </div>
                    <div class="field">
                        <span class="label">Time:</span>
                        <span class="value">{alert_data['timestamp']}</span>
                    </div>
                    <div class="field">
                        <span class="label">Alert ID:</span>
                        <span class="value">{alert_data['alert_id']}</span>
                    </div>
                </div>
                <div class="footer">
                    This is an automated alert from PANfm.<br>
                    Please acknowledge this alert in the PANfm dashboard.
                </div>
            </div>
        </body>
        </html>
        """
        return html

    def _format_slack_message(self, alert_data: Dict) -> Dict:
        """Format Slack message payload."""
        severity_colors = {
            'critical': 'danger',
            'warning': 'warning',
            'info': 'good'
        }
        color = severity_colors.get(alert_data['severity'], '#808080')

        severity_emojis = {
            'critical': ':rotating_light:',
            'warning': ':warning:',
            'info': ':information_source:'
        }
        emoji = severity_emojis.get(alert_data['severity'], ':bell:')

        return {
            'channel': self.slack_config['channel'],
            'username': self.slack_config['username'],
            'icon_emoji': emoji,
            'attachments': [{
                'color': color,
                'title': f"{emoji} PANfm Alert - {alert_data['severity'].upper()}",
                'text': alert_data['message'],
                'fields': [
                    {
                        'title': 'Device',
                        'value': alert_data.get('device_name', alert_data['device_id']),
                        'short': True
                    },
                    {
                        'title': 'Metric',
                        'value': alert_data['metric_type'].replace('_', ' ').title(),
                        'short': True
                    },
                    {
                        'title': 'Threshold',
                        'value': f"{alert_data['threshold_operator']} {alert_data['threshold_value']}",
                        'short': True
                    },
                    {
                        'title': 'Actual Value',
                        'value': str(alert_data['actual_value']),
                        'short': True
                    }
                ],
                'footer': 'PANfm Alerts',
                'footer_icon': 'https://platform.slack-edge.com/img/default_application_icon.png',
                'ts': int(datetime.now().timestamp())
            }]
        }

    def test_email(self) -> Dict:
        """
        Test email configuration by sending a test message.

        Returns:
            Dict with success status and message
        """
        info("Testing email configuration")

        test_alert = {
            'alert_id': 0,
            'severity': 'info',
            'metric_type': 'test',
            'threshold_value': 0,
            'threshold_operator': '>',
            'actual_value': 0,
            'message': 'This is a test alert from PANfm',
            'device_name': 'Test Device',
            'device_id': 'test',
            'timestamp': datetime.now().isoformat()
        }

        result = self._send_email(test_alert)

        if result['success']:
            return {'status': 'success', 'message': 'Test email sent successfully'}
        else:
            return {'status': 'error', 'message': f"Failed to send test email: {result.get('error', 'Unknown error')}"}

    def test_webhook(self) -> Dict:
        """
        Test webhook configuration by sending a test message.

        Returns:
            Dict with success status and message
        """
        info("Testing webhook configuration")

        test_alert = {
            'alert_id': 0,
            'severity': 'info',
            'metric_type': 'test',
            'threshold_value': 0,
            'threshold_operator': '>',
            'actual_value': 0,
            'message': 'This is a test alert from PANfm',
            'device_name': 'Test Device',
            'device_id': 'test',
            'timestamp': datetime.now().isoformat()
        }

        result = self._send_webhook(test_alert)

        if result['success']:
            return {'status': 'success', 'message': 'Test webhook sent successfully'}
        else:
            return {'status': 'error', 'message': f"Failed to send test webhook: {result.get('error', 'Unknown error')}"}

    def test_slack(self) -> Dict:
        """
        Test Slack configuration by sending a test message.

        Returns:
            Dict with success status and message
        """
        info("Testing Slack configuration")

        test_alert = {
            'alert_id': 0,
            'severity': 'info',
            'metric_type': 'test',
            'threshold_value': 0,
            'threshold_operator': '>',
            'actual_value': 0,
            'message': 'This is a test alert from PANfm',
            'device_name': 'Test Device',
            'device_id': 'test',
            'timestamp': datetime.now().isoformat()
        }

        result = self._send_slack(test_alert)

        if result['success']:
            return {'status': 'success', 'message': 'Test Slack message sent successfully'}
        else:
            return {'status': 'error', 'message': f"Failed to send test Slack message: {result.get('error', 'Unknown error')}"}


# Global notification manager instance
notification_manager = NotificationManager()
