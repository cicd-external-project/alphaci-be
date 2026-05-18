#!/bin/bash
set -e

echo "Starting Render build..."
npm install
npm run build
echo "Build complete!"
