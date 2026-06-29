#!/bin/bash
# Build the Cacti web app for Capacitor (native mobile app)
# This builds with VITE_API_BASE_URL pointing to the live Vercel backend
# so that API calls work from inside the native shell.

set -e

cd "$(dirname "$0")/.."

echo "Building Cacti web app for Capacitor..."
echo "API base URL: https://cacti-website-mauve.vercel.app"

# Build with native-app env vars
VITE_API_BASE_URL="https://cacti-website-mauve.vercel.app" \
VITE_SITE_URL="https://cacti-website-mauve.vercel.app" \
npm run build

# Sync to native platforms
npx cap sync

echo ""
echo "✓ Build complete. Web assets synced to native platforms."
echo ""
echo "Next steps:"
echo "  Android: npx cap open android  (then Build > Make Project in Android Studio)"
echo "  iOS:     npx cap open ios      (then Product > Archive in Xcode)"
echo ""
echo "Or build APK from command line:"
echo "  cd android && ./gradlew assembleDebug"
echo "  APK at: android/app/build/outputs/apk/debug/app-debug.apk"