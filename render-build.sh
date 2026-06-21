#!/bin/bash
set -e

echo "Starting Render build..."

echo "Cloning workflow templates..."
git clone https://github.com/Tone-Lloyd-Sir-Catubag-CICD/cicd-workflow.git /opt/cicd-workflow || true

npm install
npm run build
echo "Build complete!"
