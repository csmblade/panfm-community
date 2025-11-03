# Use Python 3.11 slim image
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Make entrypoint script executable
RUN chmod +x /app/docker-entrypoint.sh

# Create directory for persistent data
RUN mkdir -p /app/data

# Expose port (app runs on 3000)
EXPOSE 3000

# Set environment variables
ENV FLASK_APP=app.py
ENV FLASK_ENV=production
ENV FLASK_DEBUG=False

# Use entrypoint script for validation before starting app
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Run the application
CMD ["python", "app.py"]
