#!/usr/bin/env sh
# GymTracker bridge (Linux). Extra flags pass through, e.g. ./start-bridge.sh --fake
cd "$(dirname "$0")" || exit 1
exec uv run --python 3.11 server.py "$@"
