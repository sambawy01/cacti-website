/**
 * API base URL configuration.
 *
 * - In the browser (dev or Vercel): relative paths work — '' means '/api/...'
 * - In Capacitor native app: must point to the live Vercel backend
 *
 * The VITE_API_BASE_URL env var is set at build time:
 *   - Browser build: '' (relative)
 *   - Capacitor build: 'https://cacti-website-mauve.vercel.app'
 *
 * Usage: fetch(`${API_BASE}/api/order`, ...)
 */
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  '';

/** Full Vercel URL (used for absolute links, QR codes, etc.) */
export const SITE_URL: string =
  (import.meta.env.VITE_SITE_URL as string | undefined) ||
  'https://cacti-website-mauve.vercel.app';

/** Detect if running inside Capacitor native shell */
export function isNativeApp(): boolean {
  return typeof window !== 'undefined' &&
    (window as any).Capacitor?.isNativePlatform?.() === true;
}