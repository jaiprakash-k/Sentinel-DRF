#!/usr/bin/env bash
set -e

echo "🛡️  Sentinel DRF — Starting all services…"
echo ""

docker compose up --build -d

echo ""
echo "✅ All services started!"
echo ""
echo "  🌐 Frontend:       http://localhost"
echo "  🔧 Traefik Dashboard: http://localhost:8080"
echo "  📦 MinIO Console:  http://localhost:9001  (minioadmin/minioadmin)"
echo ""
echo "  📡 API Endpoints:"
echo "     POST /api/flows/execute   — Execute a new flow"
echo "     GET  /api/flows           — List all flows"
echo "     POST /api/flows/:id/replay — Replay a specific flow"
echo "     POST /api/replay/process  — Process replay queue"
echo ""
