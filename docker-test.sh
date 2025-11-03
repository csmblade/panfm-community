#!/bin/bash
# Docker deployment validation script for PANfm
# Tests that the Docker setup is functional

set -e  # Exit on error

echo "======================================"
echo "PANfm Docker Deployment Test"
echo "======================================"
echo ""

# Check if Docker is installed
echo "1. Checking Docker installation..."
if ! command -v docker &> /dev/null; then
    echo "   ✗ Docker not found. Please install Docker first."
    exit 1
fi
echo "   ✓ Docker found: $(docker --version)"

# Check if docker compose is installed
echo ""
echo "2. Checking $COMPOSE_CMD installation..."
# Try modern 'docker compose' first, fallback to legacy '$COMPOSE_CMD'
if command -v docker &> /dev/null && docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
    echo "   ✓ $COMPOSE_CMD found: $(docker compose version)"
elif command -v $COMPOSE_CMD &> /dev/null; then
    COMPOSE_CMD="$COMPOSE_CMD"
    echo "   ✓ $COMPOSE_CMD found: $($COMPOSE_CMD --version)"
else
    echo "   ✗ $COMPOSE_CMD not found. Please install Docker Compose."
    exit 1
fi

# Check if Dockerfile exists
echo ""
echo "3. Checking Dockerfile..."
if [ ! -f "Dockerfile" ]; then
    echo "   ✗ Dockerfile not found"
    exit 1
fi
echo "   ✓ Dockerfile exists"

# Check if $COMPOSE_CMD.yml exists
echo ""
echo "4. Checking $COMPOSE_CMD.yml..."
if [ ! -f "$COMPOSE_CMD.yml" ]; then
    echo "   ✗ $COMPOSE_CMD.yml not found"
    exit 1
fi
echo "   ✓ $COMPOSE_CMD.yml exists"

# Check if requirements.txt includes cryptography
echo ""
echo "5. Checking requirements.txt for cryptography..."
if ! grep -q "cryptography" requirements.txt; then
    echo "   ✗ cryptography not found in requirements.txt"
    exit 1
fi
echo "   ✓ cryptography dependency found"

# Build the Docker image
echo ""
echo "6. Building Docker image..."
if $COMPOSE_CMD build 2>&1 | tail -5; then
    echo "   ✓ Docker image built successfully"
else
    echo "   ✗ Docker build failed"
    exit 1
fi

# Check if the image was created
echo ""
echo "7. Verifying Docker image..."
if docker images | grep -q "panfm\|palo-alto"; then
    echo "   ✓ Docker image verified"
else
    echo "   ✗ Docker image not found"
    exit 1
fi

# Test container startup (non-blocking)
echo ""
echo "8. Testing container startup..."
echo "   Starting container in background..."
$COMPOSE_CMD up -d

# Wait for container to start
echo "   Waiting 10 seconds for application to initialize..."
sleep 10

# Check if container is running
echo ""
echo "9. Checking container status..."
if docker ps | grep -q "panfm"; then
    echo "   ✓ Container is running"
else
    echo "   ✗ Container is not running"
    $COMPOSE_CMD logs --tail=20
    $COMPOSE_CMD down
    exit 1
fi

# Check if application is responding
echo ""
echo "10. Testing application response..."
if curl -s http://localhost:3000 > /dev/null; then
    echo "   ✓ Application is responding on port 3000"
else
    echo "   ✗ Application is not responding"
    echo "   Container logs:"
    $COMPOSE_CMD logs --tail=20
    $COMPOSE_CMD down
    exit 1
fi

# Check if encryption module is available in container
echo ""
echo "11. Testing encryption module in container..."
if $COMPOSE_CMD exec -T panfm python -c "from encryption import encrypt_string; print('OK')" 2>&1 | grep -q "OK"; then
    echo "   ✓ Encryption module available in container"
else
    echo "   ✗ Encryption module not available"
    $COMPOSE_CMD down
    exit 1
fi

# Stop the container
echo ""
echo "12. Stopping container..."
$COMPOSE_CMD down
echo "   ✓ Container stopped"

echo ""
echo "======================================"
echo "✓ All Docker deployment tests passed!"
echo "======================================"
echo ""
echo "To run the application with Docker:"
echo "  $COMPOSE_CMD up -d"
echo ""
echo "To view logs:"
echo "  $COMPOSE_CMD logs -f"
echo ""
echo "To stop:"
echo "  $COMPOSE_CMD down"
echo ""
