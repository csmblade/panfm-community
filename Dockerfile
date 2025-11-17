# Use Python 3.11 slim image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    nmap \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Make entrypoint script executable
RUN chmod +x /app/docker-entrypoint.sh

# Create directories for persistent data and sessions
RUN mkdir -p /app/data /app/data/flask_session

# Expose port (app runs on 3000)
EXPOSE 3000

# Set environment variables
ENV FLASK_APP=app.py
ENV FLASK_ENV=production
ENV FLASK_DEBUG=False

# Use entrypoint script for validation before starting app
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Run the application with Gunicorn WSGI server
CMD ["gunicorn", "--bind", "0.0.0.0:3000", "--worker-class", "gthread", "--workers", "1", "--threads", "8", "--worker-tmp-dir", "/dev/shm", "--timeout", "120", "--access-logfile", "-", "--error-logfile", "-", "app:app"]
