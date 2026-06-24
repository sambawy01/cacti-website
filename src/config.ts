// Base URL of the Vercel orders backend. Override at build time with
// VITE_ORDERS_API_BASE; falls back to the production deployment.
export const ORDERS_API_BASE: string =
  (import.meta.env.VITE_ORDERS_API_BASE as string | undefined) ||
  "https://cacti-orders.vercel.app";