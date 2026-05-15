#!/bin/bash
set -e

echo "Starting Render custom build script..."

# 1. Build the shared SDK
echo "Building @apicenter/sdk..."
cd ../../api-shared
npm install
npm run build

# 2. Build the backend
echo "Building the backend app..."
cd ../repo-be/template-repo-be
npm install
npm run build

echo "Build complete!"