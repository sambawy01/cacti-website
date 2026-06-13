import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import path from 'path'
import fs from 'fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

/**
 * DEPLOYMENT NOTE — GitHub Pages serves from the repo root.
 *
 * Workflow:
 *   1. Edit source files in src/.
 *   2. Run `npm run deploy` — builds and copies output to root.
 *   3. Commit and push — GitHub Pages picks up the new bundle.
 *
 * The fixHtmlEntry plugin below ensures that `vite build` always compiles
 * from src/main.tsx, even if the root index.html currently references a
 * pre-built production bundle (e.g. /assets/index-XXXX.js). This prevents
 * the "frozen build" problem where Vite re-bundles a stale bundle instead
 * of compiling from source.
 */

/**
 * Plugin: fixHtmlEntry
 *
 * On build start, reads index.html and — if it contains a reference to a
 * pre-built bundle (/assets/index-*.js) instead of the Vite source entry
 * (src/main.tsx) — rewrites it IN PLACE before Vite parses it. After the
 * build completes, the original content is restored.
 *
 * This makes `vite build` idempotent: it always compiles from source,
 * regardless of whether index.html was last touched by a developer or by
 * the deploy script.
 */
function fixHtmlEntry() {
  const indexPath = path.resolve(__dirname, 'index.html')
  let originalContent: string | null = null

  return {
    name: 'fix-html-entry',
    enforce: 'pre' as const,

    // Before Vite reads index.html, patch it if needed.
    buildStart() {
      const html = fs.readFileSync(indexPath, 'utf-8')
      const stalePattern = /<script\s+type="module"\s+crossorigin\s+src="\/assets\/index-[^"]+\.js"><\/script>/
      if (stalePattern.test(html)) {
        originalContent = html
        const fixed = html.replace(
          stalePattern,
          '<script type="module" src="/src/main.tsx"></script>'
        )
        fs.writeFileSync(indexPath, fixed, 'utf-8')
      }
    },

    // After build, restore the original index.html so the committed file
    // keeps the production bundle reference for GitHub Pages.
    closeBundle() {
      if (originalContent !== null) {
        fs.writeFileSync(indexPath, originalContent, 'utf-8')
        originalContent = null
      }
    },
  }
}

export default defineConfig({
  plugins: [
    fixHtmlEntry(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      external: id => id && id.startsWith('figma:')
    }
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  // The vercel-app/ directory is a separate npm project with its own vitest
  // config and "@" alias; keep its tests out of the root suite.
  test: {
    exclude: [...configDefaults.exclude, 'vercel-app/**'],
  },
})
