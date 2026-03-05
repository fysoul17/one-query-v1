#!/usr/bin/env bash
set -euo pipefail

REGISTRY="ghcr.io"
IMAGE="ghcr.io/fysoul17/pyx-memory"
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"

echo "=== Agent Forge Setup ==="
echo ""

# Check Docker is running
if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker is not running. Please start Docker Desktop and try again."
  exit 1
fi

# Check if already authenticated
if docker pull "$IMAGE:0.1.1-beta" --quiet >/dev/null 2>&1; then
  echo "GHCR authentication: OK"
  echo "Setup complete! Run:"
  echo "  docker compose -f docker/docker-compose.yaml --profile full up --build"
  exit 0
fi

# Read token from .env
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found."
  echo "Copy .env.example to .env and set GHCR_TOKEN:"
  echo "  cp .env.example .env"
  exit 1
fi

GHCR_TOKEN=$(grep -E '^GHCR_TOKEN=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '[:space:]')

if [ -z "$GHCR_TOKEN" ] || [ "$GHCR_TOKEN" = "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" ]; then
  echo "Error: GHCR_TOKEN is not set in .env"
  echo "Add your token to .env:"
  echo "  GHCR_TOKEN=ghp_your_token_here"
  exit 1
fi

echo "Logging into GHCR..."
echo "$GHCR_TOKEN" | docker login "$REGISTRY" --username "agent-forge" --password-stdin

echo ""
echo "Setup complete! Run:"
echo "  docker compose -f docker/docker-compose.yaml --profile full up --build"
