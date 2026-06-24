import { useState, useEffect } from 'react';
import { MenuItem } from './menuData';
import { PRODUCTS } from './productsData';

export function useProductsData() {
    const [products] = useState<MenuItem[]>(PRODUCTS);
    const [loading] = useState(false);
    const [error] = useState<string | null>(null);

  useEffect(() => {
    // No external fetch — products data is local in productsData.ts
  }, []);

  const categories = ['All', ...Array.from(new Set(products.map(item => item.category)))];

  return { products, categories, loading, error };
}