/**
 * Seed the `tables` table in Supabase with 51 Cacti tables:
 *   30 dining (D1–D30, capacity 4)
 *   15 bar    (B1–B15, capacity 2)
 *   6 daybeds (Daybed-1–Daybed-6, capacity 2)
 *
 * Run: node scripts/seed-tables.js
 *
 * Requires env vars (from .env or shell):
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Output: scripts/table-ids.json  (label → UUID mapping)
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load .env manually (no dotenv dependency)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, 'utf-8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mmjjphgzzhdifvkrokxz.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

const TABLES = [
  ...Array.from({ length: 30 }, (_, i) => ({
    label: `D${i + 1}`,
    zone: 'dining',
    capacity: 4,
    is_active: true,
  })),
  ...Array.from({ length: 15 }, (_, i) => ({
    label: `B${i + 1}`,
    zone: 'bar',
    capacity: 2,
    is_active: true,
  })),
  ...Array.from({ length: 6 }, (_, i) => ({
    label: `Daybed-${i + 1}`,
    zone: 'daybed',
    capacity: 2,
    is_active: true,
  })),
];

async function main() {
  console.log(`Seeding ${TABLES.length} tables into Supabase...`);

  // Check if tables already exist
  const { data: existing, error: checkError } = await supabase
    .from('tables')
    .select('label')
    .limit(100);

  if (checkError) {
    console.error('Error checking existing tables:', checkError.message);
    process.exit(1);
  }

  if (existing && existing.length > 0) {
    console.log(`Found ${existing.length} existing tables. Clearing them first...`);
    const { error: deleteError } = await supabase
      .from('tables')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');
    if (deleteError) {
      console.error('Error clearing tables:', deleteError.message);
      process.exit(1);
    }
  }

  const { data, error } = await supabase
    .from('tables')
    .insert(TABLES)
    .select('id, label, zone, capacity');

  if (error) {
    console.error('Insert error:', error.message);
    process.exit(1);
  }

  console.log(`✓ Inserted ${data.length} tables`);

  // Save label → id mapping
  const mapping = {};
  for (const row of data) {
    mapping[row.label] = row.id;
  }

  const outputPath = path.join(__dirname, 'table-ids.json');
  fs.writeFileSync(outputPath, JSON.stringify(mapping, null, 2));
  console.log(`✓ Saved mapping to ${outputPath}`);

  // Print summary
  const byZone = {};
  for (const row of data) {
    byZone[row.zone] = (byZone[row.zone] || 0) + 1;
  }
  console.log('Summary:', byZone);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});