#!/bin/bash
# Automated Docker Restart Script for PANfm
# This script stops, removes volumes, and restarts the Docker containers
# Use this after making code changes to ensure clean restart

set -e  # Exit on error

echo "======================================"
echo "PANfm Docker Restart"
echo "======================================"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "Error: Docker is not running. Please start Docker Desktop first."
    exit 1
fi

# Navigate to project directory
cd "$(dirname "$0")"
echo "Working directory: $(pwd)"
echo ""

# Run setup to ensure all required files exist
echo "0. Running setup to ensure all required files exist..."
if [ -f "setup.sh" ]; then
    chmod +x setup.sh
    ./setup.sh
    echo "   ✓ Setup complete"
else
    echo "   ⚠ Warning: setup.sh not found, skipping setup"
fi
echo ""

# Stop and remove containers with volumes
echo "1. Stopping and removing Docker containers (with volumes)..."
docker compose down -v
echo "   ✓ Containers stopped and volumes removed"
echo ""

# Optional: Clean up dangling images (commented out by default)
# echo "2. Cleaning up dangling images..."
# docker image prune -f
# echo "   ✓ Dangling images removed"
# echo ""

# Rebuild and start containers
echo "2. Building and starting Docker containers..."
docker compose up -d --build
echo "   ✓ Containers started"
echo ""

# Wait for application to be ready
echo "3. Waiting for application to start..."
sleep 5
echo ""

# Check if container is running
echo "4. Checking container status..."
if docker ps | grep -q "panfm"; then
    echo "   ✓ Container is running"
else
    echo "   ✗ Container is not running"
    echo ""
    echo "Container logs:"
    docker compose logs --tail=20
    exit 1
fi
echo ""

# Show logs
echo "5. Container logs (last 10 lines):"
docker compose logs --tail=10
echo ""

echo "======================================"
echo "✓ Docker restart complete!"
echo "======================================"
echo ""
echo "Application should be available at: http://localhost:3000"
echo ""
echo "To view live logs, run:"
echo "  docker compose logs -f"
echo ""
