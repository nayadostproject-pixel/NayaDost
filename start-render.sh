#!/bin/sh
set -e
if [ ! -d node_modules/express ]; then
  echo "Dependencies missing; installing production dependencies..."
  npm install --omit=dev --no-audit --no-fund
fi
exec node server.js
