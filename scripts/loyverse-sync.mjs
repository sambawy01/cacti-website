#!/usr/bin/env node
/**
 * loyverse-sync.mjs — Catalog sync: Website menu (Google Sheet) -> Loyverse POS.
 *
 * SAFETY MODEL (read this):
 *   - This script writes to a LIVE Loyverse POS catalog.
 *   - DEFAULT behavior is DRY-RUN: it only READS from Loyverse and prints a plan.
 *   - It performs WRITES (POST) ONLY when invoked with the explicit `--apply` flag.
 *   - It NEVER deletes or archives anything in Loyverse.
 *
 * USAGE:
 *   node scripts/loyverse-sync.mjs                 # dry-run: print plan, zero writes
 *   node scripts/loyverse-sync.mjs --apply --limit 2   # validation: create/update only first 2 items
 *   node scripts/loyverse-sync.mjs --apply         # full apply
 *   node scripts/loyverse-sync.mjs --limit 5       # dry-run, only first 5 website items
 *
 * ENV (required; never hardcode secrets):
 *   LOYVERSE_TOKEN        Loyverse API bearer token
 *   APPS_SCRIPT_URL       Apps Script web app /exec URL
 *   APPS_SCRIPT_PASSWORD  admin password for the getMenu action
 *
 * Run with Node 18+ (uses native global fetch). Tested on Node 22.
 */

// ---------------------------------------------------------------------------
// Config / constants
// ---------------------------------------------------------------------------
const LOYVERSE_BASE = 'https://api.loyverse.com/v1.0';
const WRITE_DELAY_MS = 120; // small pause between writes to respect rate limits
const MAP_FILE = new URL('./loyverse-item-map.json', import.meta.url);
const DRY_MAP_FILE = new URL('./loyverse-item-map.dry.json', import.meta.url);

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const limitIdx = argv.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(argv[limitIdx + 1], 10) : null;
if (limitIdx !== -1 && (!Number.isInteger(LIMIT) || LIMIT <= 0)) {
  fail('--limit requires a positive integer, e.g. --limit 2');
}

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------
const { LOYVERSE_TOKEN, APPS_SCRIPT_URL, APPS_SCRIPT_PASSWORD } = process.env;
const missing = [];
if (!LOYVERSE_TOKEN) missing.push('LOYVERSE_TOKEN');
if (!APPS_SCRIPT_URL) missing.push('APPS_SCRIPT_URL');
if (!APPS_SCRIPT_PASSWORD) missing.push('APPS_SCRIPT_PASSWORD');
if (missing.length) {
  fail(
    `Missing required env var(s): ${missing.join(', ')}\n` +
      `Run with them set, e.g.:\n` +
      `  LOYVERSE_TOKEN=... APPS_SCRIPT_URL='https://script.google.com/.../exec' APPS_SCRIPT_PASSWORD=... node scripts/loyverse-sync.mjs`
  );
}

// ---------------------------------------------------------------------------
// Category normalization: website category -> Loyverse category NAME
// (case-insensitive). Anything unrecognized defaults to "Main Course" (logged).
// ---------------------------------------------------------------------------
function normalizeCategory(raw, itemNameForLog) {
  const c = String(raw || '').trim().toLowerCase();
  switch (c) {
    case 'mains':
    case 'main course':
      return 'Main Course';
    case 'salads':
    case 'salad':
      return 'Salads';
    case 'sandwich':
    case 'sandwiches':
      return 'Sandwiches';
    case 'ramadan':
      return 'Ramadan';
    default:
      console.log(
        `  [category] unrecognized category "${raw}" for "${itemNameForLog}" -> defaulting to "Main Course"`
      );
      return 'Main Course';
  }
}

// Normalize a name for MATCHING: lowercase, strip every non-alphanumeric char.
function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
async function fetchMenu() {
  // Apps Script /exec issues a 302 redirect to googleusercontent; fetch follows
  // redirects by default (redirect: 'follow').
  const url = `${APPS_SCRIPT_URL}?action=getMenu&password=${encodeURIComponent(
    APPS_SCRIPT_PASSWORD
  )}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`getMenu HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data || data.success !== true || !Array.isArray(data.items)) {
    throw new Error(`getMenu returned unexpected payload: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.items;
}

function lvHeaders() {
  return {
    Authorization: `Bearer ${LOYVERSE_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function lvGet(path) {
  const res = await fetch(`${LOYVERSE_BASE}${path}`, { headers: lvHeaders() });
  if (!res.ok) throw new Error(`GET ${path} HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function lvPost(path, body) {
  const res = await fetch(`${LOYVERSE_BASE}${path}`, {
    method: 'POST',
    headers: lvHeaders(),
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${path} HTTP ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

// Fetch ALL items, paginating via the `cursor` query param until exhausted.
async function fetchAllLoyverseItems() {
  const all = [];
  let cursor = null;
  let guard = 0;
  do {
    const qs = cursor
      ? `?limit=250&cursor=${encodeURIComponent(cursor)}`
      : `?limit=250`;
    const page = await lvGet(`/items${qs}`);
    if (Array.isArray(page.items)) all.push(...page.items);
    cursor = page.cursor || null;
    if (++guard > 100) throw new Error('Pagination guard tripped (>100 pages)');
  } while (cursor);
  return all;
}

// ---------------------------------------------------------------------------
// Body builder — THE RISKIEST UNKNOWN. Kept as one clearly-commented function
// so it is trivial to adjust if the 2-item validation run reveals a different
// required shape.
//
// Verified empirically against GET /items (item & variant shape):
//   item    => { id, item_name, category_id, variants:[...] }
//   variant => { variant_id, default_price, stores:[{ store_id, price }] }
//
// CREATE: omit `id` and `variant_id` -> Loyverse mints new ids.
// UPDATE: include `id` (item) and `variant_id` (existing variant) -> in-place
//         update. We send the single existing variant so nothing is dropped.
//
// `price` is the price in the single store (also used as default_price).
// ---------------------------------------------------------------------------
function buildItemBody({ itemName, categoryId, price, storeId, itemId, variantId }) {
  const variant = {
    // Loyverse rejects default_price unless pricing type is FIXED (default is
    // VARIABLE for API-created variants). We want a fixed per-item price.
    default_pricing_type: 'FIXED',
    default_price: price,
    stores: [{ store_id: storeId, pricing_type: 'FIXED', price }],
  };
  if (variantId) variant.variant_id = variantId; // UPDATE: target existing variant

  const body = {
    item_name: itemName,
    variants: [variant],
  };
  if (categoryId) body.category_id = categoryId;
  if (itemId) body.id = itemId; // UPDATE: target existing item

  return body;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function fail(msg) {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function priceOf(variant) {
  // Prefer the store price; fall back to default_price.
  const store = variant?.stores?.[0];
  return Number(store?.price ?? variant?.default_price ?? 0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('='.repeat(72));
  console.log(`Loyverse Catalog Sync — mode: ${APPLY ? 'APPLY (LIVE WRITES)' : 'DRY RUN (read-only)'}${LIMIT ? `  (limit ${LIMIT})` : ''}`);
  console.log('='.repeat(72));

  // --- 1. Load data sources (all reads) ---
  console.log('\n[1/4] Loading data sources...');
  const [menuRaw, categoriesResp, storesResp, loyverseItems] = await Promise.all([
    fetchMenu(),
    lvGet('/categories'),
    lvGet('/stores'),
    fetchAllLoyverseItems(),
  ]);

  let menu = menuRaw;
  if (LIMIT) menu = menu.slice(0, LIMIT);
  console.log(`  website items: ${menuRaw.length}${LIMIT ? ` (processing first ${menu.length})` : ''}`);
  console.log(`  loyverse items: ${loyverseItems.length}`);

  const stores = storesResp.stores || [];
  if (stores.length !== 1) {
    console.log(`  [warn] expected exactly ONE store, found ${stores.length}; using the first.`);
  }
  const storeId = stores[0]?.id;
  if (!storeId) fail('No Loyverse store found.');
  console.log(`  store: ${stores[0].name} (${storeId})`);

  // --- 2. Category map + plan missing categories ---
  console.log('\n[2/4] Reconciling categories...');
  const catByName = new Map(); // name -> id
  for (const c of categoriesResp.categories || []) catByName.set(c.name, c.id);

  // Determine which target categories the (limited) menu actually needs.
  const neededCats = new Set();
  for (const w of menu) neededCats.add(normalizeCategory(w.category, w.name));

  const categoriesToCreate = [];
  for (const name of neededCats) {
    if (!catByName.has(name)) categoriesToCreate.push(name);
  }
  console.log(`  needed categories: ${[...neededCats].join(', ')}`);
  console.log(`  missing (to create): ${categoriesToCreate.length ? categoriesToCreate.join(', ') : '(none)'}`);

  // --- 3. Build match map + plan item creates/updates ---
  console.log('\n[3/4] Matching items by normalized name...');

  // Existing Loyverse items keyed by normalized name. On duplicate normalized
  // names within Loyverse, keep the FIRST and record the ambiguity.
  const lvByName = new Map();
  const loyverseAmbiguities = [];
  for (const it of loyverseItems) {
    const k = normalizeName(it.item_name);
    if (lvByName.has(k)) {
      loyverseAmbiguities.push({ key: k, kept: lvByName.get(k).item_name, dropped: it.item_name });
      continue;
    }
    lvByName.set(k, it);
  }

  const itemsToCreate = [];
  const itemsToUpdate = [];
  const multiVariantSkipped = []; // matched items with >1 variant — skip to avoid data loss
  const badPrice = []; // items with non-finite or non-positive prices
  const websiteCollisions = []; // duplicate normalized names within the website menu
  let unchanged = 0;
  const seenWebsiteKeys = new Set();

  for (const w of menu) {
    const key = normalizeName(w.name);
    const targetCatName = normalizeCategory(w.category, w.name);
    const price = Number(w.price);

    // FIX 3: Guard against non-finite / non-positive prices before doing anything.
    if (!Number.isFinite(price) || price <= 0) {
      badPrice.push({ name: w.name, raw: w.price });
      continue;
    }

    // Detect duplicate website rows (same normalized name). Act on the first;
    // flag the rest so we never double-create.
    if (seenWebsiteKeys.has(key)) {
      websiteCollisions.push({ name: w.name, key });
      continue;
    }
    seenWebsiteKeys.add(key);

    const match = lvByName.get(key);
    if (!match) {
      itemsToCreate.push({ name: w.name, key, targetCatName, price });
      continue;
    }

    // FIX 1: If the matched Loyverse item has more than one variant, skip the
    // update entirely — POST /items treats the variants array as authoritative
    // and would DELETE any variant absent from the request body.  Multi-variant
    // items must be updated manually in Loyverse.
    if ((match.variants?.length ?? 0) > 1) {
      multiVariantSkipped.push({ name: w.name, key, loyverseName: match.item_name, variantCount: match.variants.length });
      continue;
    }

    // Match exists (single variant). Sheet is the source of truth for price;
    // also ensure the category is set correctly.
    //
    // NOTE on the spec's parenthetical "only update if price differs":
    // taken literally that would skip items whose price already matches but
    // whose category_id is null/wrong. Since the spec ALSO requires "ensure
    // category_id is set", we update when EITHER the price differs OR the
    // category needs fixing — this satisfies both and minimizes writes
    // (genuinely-unchanged items are skipped).
    const variant = match.variants?.[0];
    const curPrice = priceOf(variant);
    const curCatName = match.category_id
      ? [...catByName.entries()].find(([, id]) => id === match.category_id)?.[0] ?? null
      : null;

    const priceDiffers = curPrice !== price;
    const catNeedsFix = curCatName !== targetCatName;

    if (!priceDiffers && !catNeedsFix) {
      unchanged++;
      continue;
    }

    itemsToUpdate.push({
      name: w.name,           // website name (for logging only)
      loyverseName: match.item_name, // FIX 2: preserve the existing Loyverse name on update
      key,
      loyverseId: match.id,
      variantId: variant?.variant_id,
      curPrice,
      newPrice: price,
      curCatName,
      targetCatName,
      priceDiffers,
      catNeedsFix,
    });
  }

  // --- Print the plan ---
  console.log('\n' + '-'.repeat(72));
  console.log('PLAN');
  console.log('-'.repeat(72));

  console.log(`\nCategories to create (${categoriesToCreate.length}):`);
  categoriesToCreate.forEach((c) => console.log(`  + ${c}`));

  console.log(`\nItems to CREATE (${itemsToCreate.length}):`);
  itemsToCreate.slice(0, 10).forEach((i) =>
    console.log(`  + "${i.name}"  [${i.targetCatName}]  price ${i.price}`)
  );
  if (itemsToCreate.length > 10) console.log(`  ... and ${itemsToCreate.length - 10} more`);

  console.log(`\nItems to UPDATE (${itemsToUpdate.length}):`);
  itemsToUpdate.forEach((u) => {
    const bits = [];
    if (u.priceDiffers) bits.push(`price ${u.curPrice} -> ${u.newPrice}`);
    if (u.catNeedsFix) bits.push(`cat ${u.curCatName ?? 'none'} -> ${u.targetCatName}`);
    console.log(`  ~ "${u.name}"  (${bits.join(', ')})`);
  });

  console.log(`\nUnchanged: ${unchanged}`);

  console.log(`\nItems SKIPPED — multi-variant (update manually in Loyverse) (${multiVariantSkipped.length}):`);
  multiVariantSkipped.forEach((s) =>
    console.log(`  [skip] "${s.loyverseName}" (website: "${s.name}")  variants: ${s.variantCount}`)
  );

  console.log(`\nItems SKIPPED — bad/missing price (${badPrice.length}):`);
  badPrice.forEach((b) =>
    console.log(`  [skip] "${b.name}"  raw price: ${JSON.stringify(b.raw)}`)
  );

  if (websiteCollisions.length) {
    console.log(`\n[!] Website-internal name collisions (duplicate rows, acted on first only) (${websiteCollisions.length}):`);
    websiteCollisions.forEach((c) => console.log(`    - "${c.name}" (normalized: ${c.key})`));
  }
  if (loyverseAmbiguities.length) {
    console.log(`\n[!] Loyverse-internal duplicate names (matched FIRST, others ignored) (${loyverseAmbiguities.length}):`);
    loyverseAmbiguities.forEach((a) => console.log(`    - kept "${a.kept}", ignored "${a.dropped}"`));
  }

  // --- 4. Execute (apply) or stop (dry-run) ---
  if (!APPLY) {
    console.log('\n' + '='.repeat(72));
    console.log(
      `DRY RUN — would create ${categoriesToCreate.length} categories, ` +
        `${itemsToCreate.length} items, update ${itemsToUpdate.length} items ` +
        `(${unchanged} unchanged, multiVariantSkipped: ${multiVariantSkipped.length}, ` +
        `badPrice: ${badPrice.length}). NO WRITES PERFORMED.`
    );
    console.log('='.repeat(72));

    // Write an inspection-only dry map (NOT the real map). Creates have no ids yet.
    await writeDryMap(itemsToCreate, itemsToUpdate, multiVariantSkipped, lvByName);
    console.log(`\nWrote inspection map: ${DRY_MAP_FILE.pathname}`);
    console.log('Re-run with --apply to execute. Suggested first: --apply --limit 2');
    return;
  }

  // ===== APPLY PATH (live writes) =====
  console.log('\n[4/4] APPLYING changes (live writes)...');
  let createdCats = 0;
  let createdItems = 0;
  let updatedItems = 0;
  let failed = 0;

  // 4a. Create missing categories first; extend catByName with new ids.
  for (const name of categoriesToCreate) {
    try {
      const created = await lvPost('/categories', { name });
      catByName.set(name, created.id);
      createdCats++;
      console.log(`  [cat] created "${name}" -> ${created.id}`);
    } catch (e) {
      failed++;
      console.log(`  [cat] FAILED to create "${name}": ${e.message}`);
    }
    await sleep(WRITE_DELAY_MS);
  }

  // 4b. Create items.
  for (const i of itemsToCreate) {
    const categoryId = catByName.get(i.targetCatName) || null;
    const body = buildItemBody({
      itemName: i.name,
      categoryId,
      price: i.price,
      storeId,
    });
    try {
      await lvPost('/items', body);
      createdItems++;
      console.log(`  [create] "${i.name}" OK`);
    } catch (e) {
      failed++;
      console.log(`  [create] "${i.name}" FAILED: ${e.message}`);
    }
    await sleep(WRITE_DELAY_MS);
  }

  // 4c. Update items.
  for (const u of itemsToUpdate) {
    const categoryId = catByName.get(u.targetCatName) || null;
    const body = buildItemBody({
      itemName: u.loyverseName, // FIX 2: preserve the existing Loyverse item name, don't rename
      categoryId,
      price: u.newPrice,
      storeId,
      itemId: u.loyverseId,
      variantId: u.variantId,
    });
    try {
      await lvPost('/items', body);
      updatedItems++;
      console.log(`  [update] "${u.name}" OK`);
    } catch (e) {
      failed++;
      console.log(`  [update] "${u.name}" FAILED: ${e.message}`);
    }
    await sleep(WRITE_DELAY_MS);
  }

  // 4d. Re-fetch everything and write the real item map.
  console.log('\n  Re-fetching catalog to build item map...');
  const finalItems = await fetchAllLoyverseItems();
  await writeRealMap(finalItems);
  console.log(`  Wrote item map: ${MAP_FILE.pathname}`);

  console.log('\n' + '='.repeat(72));
  console.log(
    `APPLIED — created ${createdCats} categories, ${createdItems} items, ` +
      `updated ${updatedItems} items, failed ${failed}, ` +
      `multiVariantSkipped: ${multiVariantSkipped.length}, badPrice: ${badPrice.length}.`
  );
  if (multiVariantSkipped.length) {
    console.log(`\nMulti-variant items skipped (update manually in Loyverse):`);
    multiVariantSkipped.forEach((s) => console.log(`  - "${s.loyverseName}" (${s.variantCount} variants)`));
  }
  if (badPrice.length) {
    console.log(`\nBad-price items skipped:`);
    badPrice.forEach((b) => console.log(`  - "${b.name}"  raw: ${JSON.stringify(b.raw)}`));
  }
  console.log('='.repeat(72));
}

// ---------------------------------------------------------------------------
// Map writers
// ---------------------------------------------------------------------------
function buildMapFromItems(items) {
  const map = {};
  for (const it of items) {
    const v = it.variants?.[0];
    if (!v) continue;
    const key = normalizeName(it.item_name);
    if (map[key]) continue; // keep first on duplicates
    map[key] = {
      variant_id: v.variant_id,
      item_name: it.item_name,
      loyverse_id: it.id,
    };
  }
  return map;
}

async function writeRealMap(finalItems) {
  const { writeFile } = await import('node:fs/promises');
  const map = buildMapFromItems(finalItems);
  await writeFile(MAP_FILE, JSON.stringify(map, null, 2) + '\n');
}

async function writeDryMap(itemsToCreate, itemsToUpdate, multiVariantSkipped, lvByName) {
  const { writeFile } = await import('node:fs/promises');
  const map = {};
  // Existing/updated items carry real ids.
  for (const u of itemsToUpdate) {
    map[u.key] = { variant_id: u.variantId, item_name: u.loyverseName, loyverse_id: u.loyverseId, _status: 'would_update' };
  }
  // Planned creates have no ids yet.
  for (const i of itemsToCreate) {
    map[i.key] = { variant_id: null, item_name: i.name, loyverse_id: null, _status: 'would_create' };
  }
  // Multi-variant skipped: real ids known but we won't touch them.
  for (const s of multiVariantSkipped) {
    const lv = lvByName.get(s.key);
    const v = lv?.variants?.[0];
    map[s.key] = {
      variant_id: v?.variant_id ?? null,
      item_name: s.loyverseName,
      loyverse_id: lv?.id ?? null,
      _status: 'skipped_multi_variant',
    };
  }
  await writeFile(DRY_MAP_FILE, JSON.stringify(map, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
main().catch((e) => {
  console.error(`\nFATAL: ${e?.stack || e?.message || e}\n`);
  process.exit(1);
});
