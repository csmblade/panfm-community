"""
Flask route handlers for authentication
Handles login, logout, password management, and session keepalive
"""
from flask import jsonify, request, session, render_template
from auth import (
    login_required,
    verify_password,
    create_session,
    destroy_session,
    change_password,
    must_change_password
)
from logger import debug, error


def register_auth_routes(app, csrf, limiter):
    """Register authentication-related routes"""
    debug("Registering authentication routes")

    # ============================================================================
    # Authentication Routes (no @login_required)
    # ============================================================================

    @app.route('/login')
    @csrf.exempt  # Exempt login page from CSRF (form has its own token)
    def login_page():
        """Serve the login page"""
        return render_template('login.html')

    @app.route('/api/login', methods=['POST'])
    @csrf.exempt  # Exempt login API from CSRF (not yet authenticated)
    @limiter.limit("5 per minute")  # Strict rate limit on login attempts
    def login():
        """Handle login authentication"""
        try:
            data = request.get_json()
            username = data.get('username', '').strip()
            password = data.get('password', '')

            if not username or not password:
                return jsonify({
                    'status': 'error',
                    'message': 'Username and password are required'
                }), 400

            if verify_password(username, password):
                create_session(username)

                # Check if password must be changed
                if must_change_password():
                    return jsonify({
                        'status': 'success',
                        'message': 'Login successful - password change required',
                        'must_change_password': True
                    })

                return jsonify({
                    'status': 'success',
                    'message': 'Login successful'
                })
            else:
                return jsonify({
                    'status': 'error',
                    'message': 'Invalid username or password'
                }), 401
        except Exception as e:
            error(f"Login error: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': 'Login failed'
            }), 500

    @app.route('/api/logout', methods=['POST'])
    @limiter.limit("60 per hour")  # Reasonable limit for logout
    @login_required
    def logout():
        """Handle logout"""
        destroy_session()
        return jsonify({
            'status': 'success',
            'message': 'Logged out successfully'
        })

    @app.route('/api/session-keepalive', methods=['GET'])
    @limiter.limit("600 per hour")  # Support frequent keepalive pings
    @login_required
    def session_keepalive():
        """Session keepalive endpoint for Tony Mode - refreshes session expiry"""
        # Simply accessing this endpoint with @login_required refreshes the session
        # Flask automatically updates session.modified when accessed
        return jsonify({
            'status': 'success',
            'message': 'Session refreshed'
        })

    @app.route('/api/auth/status', methods=['GET'])
    @csrf.exempt  # Public endpoint for login page
    @limiter.limit("100 per hour")
    def auth_status():
        """Check if default password is still in use (for login page warning)"""
        try:
            from auth import load_auth_data
            auth_data = load_auth_data()

            if auth_data and 'users' in auth_data and 'admin' in auth_data['users']:
                must_change = auth_data['users']['admin'].get('must_change_password', False)
                return jsonify({
                    'status': 'success',
                    'must_change_password': must_change
                })

            # If no admin user, assume password was changed
            return jsonify({
                'status': 'success',
                'must_change_password': False
            })
        except Exception as e:
            error(f"Auth status check error: {str(e)}")
            # On error, don't show the warning
            return jsonify({
                'status': 'error',
                'must_change_password': False
            })

    @app.route('/api/change-password', methods=['POST'])
    @login_required
    @limiter.limit("3 per hour")
    def change_password_route():
        """Handle password change"""
        try:
            data = request.get_json()
            old_password = data.get('old_password', '')
            new_password = data.get('new_password', '')

            if not old_password or not new_password:
                return jsonify({
                    'status': 'error',
                    'message': 'Old and new passwords are required'
                }), 400

            if len(new_password) < 8:
                return jsonify({
                    'status': 'error',
                    'message': 'New password must be at least 8 characters'
                }), 400

            username = session.get('username')
            success, message = change_password(username, old_password, new_password)

            if success:
                return jsonify({
                    'status': 'success',
                    'message': message
                })
            else:
                return jsonify({
                    'status': 'error',
                    'message': message
                }), 400
        except Exception as e:
            error(f"Password change error: {str(e)}")
            return jsonify({
                'status': 'error',
                'message': 'Failed to change password'
            }), 500

    debug("Authentication routes registered successfully")
