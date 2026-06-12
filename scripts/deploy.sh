#!/usr/bin/env bash
#
# deploy.sh — Build and prepare files for GitHub Pages deployment.
#
# Usage:  npm run deploy
#
# This script:
#   1. Runs `vite build` (always compiles from src/main.tsx thanks to the
#      fixHtmlEntry plugin, regardless of what index.html currently says).
#   2. Copies built assets (JS, CSS, images) into root /assets/.
#   3. Copies the built index.html to root (with hashed bundle references
#      that GitHub Pages will serve).
#
# After running, commit and push to deploy via GitHub Pages.
#
# NOTE: The fixHtmlEntry plugin in vite.config.ts ensures that even after
# this script overwrites index.html with production bundle references,
# the NEXT build still compiles from source. You do NOT need to manually
# restore index.html.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Step 1: Building with Vite..."
npx vite build
echo ""

echo "==> Step 2: Copying built assets to root /assets/..."
# Copy all new assets (JS, CSS, images) from dist/assets/ to root assets/
for file in dist/assets/*; do
  basename="$(basename "$file")"
  if [ ! -f "assets/$basename" ]; then
    cp "$file" "assets/$basename"
    echo "    + $basename (new)"
  fi
done
echo ""

echo "==> Step 3: Updating root index.html with production bundle..."
cp dist/index.html index.html
echo "    index.html updated."
echo ""

echo "==> Step 4: Creating 404.html for SPA routing..."
cp dist/index.html 404.html
echo "    404.html created (GitHub Pages SPA fallback)."

echo "==> Deploy prep complete!"
echo ""
echo "    Next steps:"
echo "      git add -A"
echo "      git commit -m 'Deploy: <description>'"
echo "      git push"
echo ""
echo "    The fixHtmlEntry plugin in vite.config.ts ensures future builds"
echo "    always compile from src/main.tsx, even though index.html now"
echo "    references the production bundle."
