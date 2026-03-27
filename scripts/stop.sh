#!/usr/bin/env bash
set -e

echo "🛡️  Sentinel DRF — Stopping all services…"
docker compose down
echo "✅ All services stopped."
