# Loyverse Catalog Sync

`scripts/loyverse-sync.mjs` syncs the website menu (Google Sheet, served via the
Apps Script `getMenu` action) into the **live** Loyverse POS catalog.

Because it writes to a **live POS**, it is **dry-run by default**. It only reads
from Loyverse and prints a plan unless you pass `--apply`. It **never deletes or
archives** anything.

## What it does

1. Loads all 140 website menu items (including `status=hidden`).
2. Loads the Loyverse catalog (items, categories, the single store) — paginated.
3. Normalizes website categories to Loyverse category names:
   - `Mains` / `main course` → **Main Course**
   - `Salads` / `salad` → **Salads**
   - `sandwich` / `Sandwiches` → **Sandwiches**
   - `Ramadan` → **Ramadan**
   - anything else → **Main Course** (logged)
   - Ensures each needed category exists; plans/creates the missing ones
     (`Salads`, `Ramadan` are expected to be missing).
4. Matches items by **normalized name** (lowercase, alphanumerics only):
   - no match → plan a **CREATE** (name, category, website price in the store).
   - match → plan an **UPDATE** when the price differs **or** the category needs
     fixing (sheet is the source of truth). Genuinely-unchanged items are skipped.
5. Reports name collisions (duplicate website rows; duplicate Loyverse names).
6. After `--apply`, re-fetches the catalog and writes
   `scripts/loyverse-item-map.json` (used by the order-push):
   ```json
   { "<normalized name>": { "variant_id": "...", "item_name": "...", "loyverse_id": "..." } }
   ```

## Environment variables (required)

| Var | Meaning |
| --- | --- |
| `LOYVERSE_TOKEN` | Loyverse API bearer token |
| `APPS_SCRIPT_URL` | Apps Script web app `/exec` URL |
| `APPS_SCRIPT_PASSWORD` | admin password for the `getMenu` action |

Secrets are read from `process.env` only — nothing is hardcoded.

## Commands

Set the env vars inline (or export them) before each command.

```bash
# 1. DRY RUN — print the plan, make ZERO writes (default)
LOYVERSE_TOKEN=... APPS_SCRIPT_URL='https://script.google.com/.../exec' APPS_SCRIPT_PASSWORD=... \
  node scripts/loyverse-sync.mjs

# 2. VALIDATION — apply only the first 2 items, to confirm the POST /items body
#    shape works on the live API BEFORE the full run
LOYVERSE_TOKEN=... APPS_SCRIPT_URL='...' APPS_SCRIPT_PASSWORD=... \
  node scripts/loyverse-sync.mjs --apply --limit 2

# 3. FULL APPLY — execute the entire plan (writes loyverse-item-map.json)
LOYVERSE_TOKEN=... APPS_SCRIPT_URL='...' APPS_SCRIPT_PASSWORD=... \
  node scripts/loyverse-sync.mjs --apply
```

Useful extras:
- `--limit N` — process only the first N website items (works in dry-run too).
- Dry-run writes `scripts/loyverse-item-map.dry.json` for inspection only
  (planned creates have `null` ids). The **real** map is only written on `--apply`.

## Recommended rollout

1. Run the **dry run** and read the plan (~127 creates, ~12 updates, 2 categories).
2. Run **`--apply --limit 2`** and confirm 2 items appear in Loyverse correctly.
   - If this errors, the `POST /items` body shape needs adjusting — it is built
     in the single `buildItemBody()` function in `loyverse-sync.mjs`, designed to
     be easy to fix.
3. Run the **full `--apply`**.
4. Commit nothing secret. `loyverse-item-map.json*` is gitignored.
