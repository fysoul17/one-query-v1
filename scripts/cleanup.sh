#!/usr/bin/env bash
set -euo pipefail

# Disable Compose bake integration — buildx bake hangs on metadata-file write
# on Docker Desktop (macOS). The legacy compose builder works reliably.
export COMPOSE_BAKE=false

COMPOSE_FILE="$(cd "$(dirname "$0")/.." && pwd)/docker/docker-compose.yaml"

echo "=== Agent Forge Cleanup ==="
echo ""

# Check Docker is running
if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker is not running. Please start Docker Desktop and try again."
  exit 1
fi

# Parse flags
REMOVE_VOLUMES=false
PRUNE_SYSTEM=false

for arg in "$@"; do
  case "$arg" in
    --volumes) REMOVE_VOLUMES=true ;;
    --prune)   PRUNE_SYSTEM=true ;;
    --all)     REMOVE_VOLUMES=true; PRUNE_SYSTEM=true ;;
    --help|-h)
      echo "Usage: ./scripts/cleanup.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --volumes  Remove named volumes (agent-data, memory-data, neo4j-data)"
      echo "  --prune    Run docker system prune to free disk space"
      echo "  --all      Both --volumes and --prune"
      echo "  -h, --help Show this help"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (use --help for usage)"
      exit 1
      ;;
  esac
done

# Stop and remove containers for both profiles
echo "Stopping containers..."
docker compose -f "$COMPOSE_FILE" --profile full down

if [ "$REMOVE_VOLUMES" = true ]; then
  echo "Removing volumes..."
  docker compose -f "$COMPOSE_FILE" --profile full down -v
fi

# Remove built images
echo "Removing built images..."
docker rmi docker-runtime docker-dashboard 2>/dev/null || true

if [ "$PRUNE_SYSTEM" = true ]; then
  echo "Pruning Docker system (unused images, build cache, networks)..."
  docker system prune -af
fi

echo ""
echo "Cleanup complete!"
if [ "$REMOVE_VOLUMES" = false ]; then
  echo "  (Data volumes preserved. Use --volumes to remove them.)"
fi
