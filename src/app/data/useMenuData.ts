import { useState, useEffect } from 'react';
import { MenuItem, MENU_ITEMS } from './menuData';

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQNRZf6d9Iknuq05HwUHR2fv6lWYNb2znKebVH7M7fp79tilG0_6mOH_0mfWR5ZzKV5PQNcdNzYxDdR/pub?gid=0&single=true&output=csv';

function parseCSV(csv: string): string[][] {
    const rows: string[][] = [];
    let current = '';
    let inQuotes = false;
    let row: string[] = [];
    for (let i = 0; i < csv.length; i++) {
          const char = csv[i];
          const next = csv[i + 1];
          if (inQuotes) {
                  if (char === '"' && next === '"') { current += '"'; i++; }
                  else if (char === '"') { inQuotes = false; }
                  else { current += char; }
          } else {
                  if (char === '"') { inQuotes = true; }
                  else if (char === ',') { row.push(current.trim()); current = ''; }
                  else if (char === '\n' || (char === '\r' && next === '\n')) {
                            row.push(current.trim());
                            if (row.some(cell => cell !== '')) rows.push(row);
                            row = []; current = '';
                            if (char === '\r') i++;
                  } else { current += char; }
          }
    }
    if (current || row.length > 0) {
          row.push(current.trim());
          if (row.some(cell => cell !== '')) rows.push(row);
    }
    return rows;
}

function csvToMenuItems(csv: string): MenuItem[] {
    const rows = parseCSV(csv);
    if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.toLowerCase().trim());
    const col = (name: string) => headers.indexOf(name);

  return rows.slice(1).map((row): MenuItem | null => {
        try {
          const hiddenVal = (row[col('hidden')] || '').toLowerCase().trim();
                if (hiddenVal === 'hidden' || hiddenVal === 'true' || hiddenVal === 'yes') return null;

          const status = (row[col('status')] || 'available').toLowerCase().trim();
                if (status === 'hidden') return null;

          const dietaryRaw = row[col('dietary')] || '';
                const dietary = dietaryRaw
                  ? dietaryRaw.split(',').map(d => d.trim()).filter(Boolean)
                          : undefined;

          const price = Number(row[col('price')]);
                if (!row[col('name')] || isNaN(price)) return null;

          const sectionVal = (row[col('section')] || '').trim();
          const validSections = ['Restaurant', 'Beach Bar', 'Bar', 'Kids'];
          const section = (validSections.includes(sectionVal)
                  ? sectionVal
                  : undefined) as MenuItem['section'];

          return {
                    id: row[col('id')] || String(Math.random()),
                    name: row[col('name')] || '',
                    description: row[col('description')] || '',
                    price,
                    category: row[col('category')] || 'Mains',
                    image: row[col('image')] || '',
                    dietary,
                    status: (['available', 'limited', 'sold_out'].includes(status)
                                       ? status
                                       : 'available') as MenuItem['status'],
                    section,
          };
        } catch {
                return null;
        }
  }).filter((item): item is MenuItem => item !== null);
}

export function useMenuData() {
    // Use MENU_ITEMS from menuData.ts as the primary source
    // Try Google Sheet as override, fall back to local data
    const [menuItems, setMenuItems] = useState<MenuItem[]>(MENU_ITEMS);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [source, setSource] = useState<'sheet' | 'fallback'>('fallback');

  useEffect(() => {
        if (!SHEET_CSV_URL) {
                return;
        }

                let cancelled = false;

                async function fetchMenu() {
                        try {
                                  const response = await fetch(SHEET_CSV_URL);
                                  if (!response.ok) throw new Error(`HTTP ${response.status}`);
                                  const csv = await response.text();
                                  const items = csvToMenuItems(csv);

                          if (!cancelled && items.length > 0) {
                                    setMenuItems(items);
                                    setSource('sheet');
                          }
                        } catch (err) {
                                  if (!cancelled) {
                                              setError(`Sheet fetch failed, using local data`);
                                  }
                        }
                }

                fetchMenu();
        return () => { cancelled = true; };
  }, []);

  const categories = ['All', ...Array.from(new Set(menuItems.map(item => item.category)))];

  return { menuItems, categories, loading, error, source };
}