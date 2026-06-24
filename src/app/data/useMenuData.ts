import { useState, useEffect } from 'react';
import { MenuItem, MENU_ITEMS } from './menuData';

export function useMenuData() {
    const [menuItems] = useState<MenuItem[]>(MENU_ITEMS);
    const [loading] = useState(false);
    const [error] = useState<string | null>(null);
    const [source] = useState<'local'>('local');

  useEffect(() => {
    // No external fetch — menu data is local in menuData.ts
  }, []);

  const categories = ['All', ...Array.from(new Set(menuItems.map(item => item.category)))];

  return { menuItems, categories, loading, error, source };
}