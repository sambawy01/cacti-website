/**
 * Generate QR codes for all Cacti tables.
 * Reads scripts/table-ids.json (label → UUID).
 * Outputs PNG files to public/qr-codes/<label>.png
 * Also generates a combined A4 PDF (6 codes per page) for easy printing.
 *
 * Run: node scripts/generate-qr.cjs
 */

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const BASE_URL = 'https://cacti.restaurant/order?table=';
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'qr-codes');

async function main() {
  const mappingPath = path.join(__dirname, 'table-ids.json');
  if (!fs.existsSync(mappingPath)) {
    console.error('ERROR: scripts/table-ids.json not found. Run seed-tables.cjs first.');
    process.exit(1);
  }

  const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf-8'));
  const labels = Object.keys(mapping).sort((a, b) => {
    // Sort: D1-D30, B1-B15, Daybed-1-Daybed-6
    const zoneA = a[0], zoneB = b[0];
    const zoneOrder = { D: 0, B: 1, D2: 2 };
    if (zoneA !== zoneB) return zoneOrder[zoneA] - zoneOrder[zoneB];
    return a.localeCompare(b, undefined, { numeric: true });
  });

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Generating ${labels.length} QR codes...`);

  // Generate individual PNG files
  const qrData = [];
  for (const label of labels) {
    const uuid = mapping[label];
    const url = `${BASE_URL}${uuid}`;
    const filename = `${label}.png`;
    const filepath = path.join(OUTPUT_DIR, filename);

    await QRCode.toFile(filepath, url, {
      width: 400,
      margin: 2,
      color: { dark: '#0a0a0a', light: '#ffffff' },
    });

    qrData.push({ label, url, filename });
    console.log(`  ✓ ${label} → ${url}`);
  }

  // Generate combined HTML for easy printing (simpler than PDF, no extra deps)
  const html = generatePrintableHTML(qrData);
  const htmlPath = path.join(OUTPUT_DIR, 'all-tables.html');
  fs.writeFileSync(htmlPath, html);
  console.log(`\n✓ Generated ${qrData.length} QR PNGs in public/qr-codes/`);
  console.log(`✓ Printable HTML at public/qr-codes/all-tables.html`);
  console.log(`\nOpen the HTML in a browser and print to PDF (A4, portrait, no margins).`);
}

function generatePrintableHTML(items) {
  const cards = items.map(({ label, url }) => `
    <div class="qr-card">
      <div class="qr-label">${label}</div>
      <img src="${label}.png" alt="${label}" />
      <div class="qr-url">cacti.restaurant</div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Cacti QR Codes — All Tables</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  body {
    font-family: 'Montserrat', Arial, sans-serif;
    margin: 0; padding: 0;
  }
  h1 { text-align: center; font-size: 18px; margin: 0 0 10px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10mm;
    padding: 0;
  }
  .qr-card {
    text-align: center;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 8px;
    page-break-inside: avoid;
  }
  .qr-label {
    font-weight: bold;
    font-size: 14px;
    color: #0a4d4d;
    margin-bottom: 4px;
  }
  .qr-card img {
    width: 80px;
    height: 80px;
  }
  .qr-url {
    font-size: 9px;
    color: #999;
    margin-top: 2px;
  }
  @media print {
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <div class="no-print" style="text-align:center; padding:10px; background:#0a4d4d; color:white;">
    Click print (Ctrl+P) → Save as PDF → A4 portrait, no margins
  </div>
  <h1>Cacti — Table QR Codes (${items.length} tables)</h1>
  <div class="grid">
    ${cards}
  </div>
</body>
</html>`;
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});