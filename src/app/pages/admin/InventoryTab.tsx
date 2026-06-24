import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/app/components/ui/table';
import { Button } from '@/app/components/ui/button';
import { Badge } from '@/app/components/ui/badge';
import { Input } from '@/app/components/ui/input';
import {
  StockItem, getInventory, addInventoryItem, editInventoryItem,
  deleteInventoryItem, restockItem,
} from '@/services/inventoryService';
import { InventoryFormDialog } from './InventoryFormDialog';
import { RestockDialog } from './RestockDialog';
import { Role } from '@/services/adminService';
import { AdminLang } from './useAdminLang';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Loader2, ArrowUp, ArrowDown, Search, PackagePlus, AlertTriangle } from 'lucide-react';

type SortKey = 'name' | 'category' | 'qty_on_hand' | 'status';
type SortDir = 'asc' | 'desc';

function getStockStatus(item: StockItem): 'ok' | 'low' | 'out' {
  if (Number(item.qty_on_hand) <= 0) return 'out';
  if (Number(item.qty_on_hand) <= Number(item.min_level)) return 'low';
  return 'ok';
}

const categoryColor: Record<string, string> = {
  'لحوم': 'bg-red-100 text-red-800',
  'اسماك': 'bg-sky-100 text-sky-800',
  'بقاله': 'bg-amber-100 text-amber-800',
  'عطاره وتوابل': 'bg-purple-100 text-purple-800',
  'مشروبات': 'bg-teal-100 text-teal-800',
  'جينرال': 'bg-gray-100 text-gray-700',
  // English fallbacks
  'Raw Ingredient': 'bg-blue-100 text-blue-800',
  'Packaging': 'bg-purple-100 text-purple-800',
  'Supplies': 'bg-amber-100 text-amber-800',
  'Finished Good': 'bg-green-100 text-green-800',
};

const categoryRowColor: Record<string, string> = {
  'لحوم': 'bg-red-50/40',
  'اسماك': 'bg-sky-50/40',
  'بقاله': 'bg-amber-50/40',
  'عطاره وتوابل': 'bg-purple-50/40',
  'مشروبات': 'bg-teal-50/40',
  'جينرال': 'bg-gray-50/40',
};

export function InventoryTab({ l, role }: { l: AdminLang; role: Role }) {
  const { tr } = l;
  const canEdit = role === 'admin' || role === 'accounting';
  const [items, setItems] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [restockOpen, setRestockOpen] = useState(false);
  const [editItem, setEditItem] = useState<StockItem | null>(null);
  const [restockTarget, setRestockTarget] = useState<StockItem | null>(null);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [search, setSearch] = useState('');

  const fetchItems = useCallback(async () => {
    try {
      const data = await getInventory();
      setItems(data);
    } catch (err) {
      toast.error(tr('inv_failed_load'));
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const lowStockCount = items.filter(i => getStockStatus(i) !== 'ok').length;

  function openAdd() { setEditItem(null); setDialogOpen(true); }
  function openEdit(item: StockItem) { setEditItem(item); setDialogOpen(true); }
  function openRestock(item: StockItem) { setRestockTarget(item); setRestockOpen(true); }

  async function handleSave(data: Record<string, string>) {
    if (editItem) {
      await editInventoryItem(editItem._rowIndex, data);
      toast.success(tr('inv_item_updated'));
    } else {
      await addInventoryItem(data);
      toast.success(tr('inv_item_added'));
    }
    await fetchItems();
  }

  async function handleRestock(rowIndex: number, quantity: number, performedBy: string) {
    const target = items.find(i => i._rowIndex === rowIndex);
    if (!target) return;
    await restockItem(rowIndex, quantity, performedBy, target);
    toast.success(tr('inv_restocked'));
    await fetchItems();
  }

  async function handleDelete(item: StockItem) {
    if (!confirm(`${tr('confirm_delete')} "${item.name}"?`)) return;
    try {
      await deleteInventoryItem(item._rowIndex);
      toast.success(tr('inv_item_deleted'));
      await fetchItems();
    } catch { toast.error(tr('failed_delete')); }
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  function getSortedItems(): StockItem[] {
    let filtered = items;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = items.filter(item =>
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.supplier.toLowerCase().includes(q)
      );
    }
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      let aVal: string | number, bVal: string | number;
      switch (sortKey) {
        case 'name': aVal = a.name.toLowerCase(); bVal = b.name.toLowerCase(); break;
        case 'category': aVal = a.category.toLowerCase(); bVal = b.category.toLowerCase(); break;
        case 'qty_on_hand': aVal = Number(a.qty_on_hand) || 0; bVal = Number(b.qty_on_hand) || 0; break;
        case 'status': {
          const order = { out: 0, low: 1, ok: 2 };
          aVal = order[getStockStatus(a)]; bVal = order[getStockStatus(b)]; break;
        }
        default: return 0;
      }
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return null;
    return sortDir === 'asc' ? <ArrowUp className="size-3 inline ml-1" /> : <ArrowDown className="size-3 inline ml-1" />;
  }

  function StatusBadge({ item }: { item: StockItem }) {
    const status = getStockStatus(item);
    if (status === 'out') return <Badge variant="destructive">{tr('inv_out')}</Badge>;
    if (status === 'low') return <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-200">{tr('inv_low')}</Badge>;
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-200">{tr('inv_ok')}</Badge>;
  }

  if (loading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div>
      {lowStockCount > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle className="size-5 shrink-0" />
          <span className="font-medium">
            {lowStockCount} {lowStockCount === 1 ? tr('inv_item_low_single') : tr('inv_items_low')}
          </span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
        <h2 className="text-lg font-semibold shrink-0">{tr('inv_stock_items')} ({items.length})</h2>
        <div className="flex items-center gap-2 flex-1 sm:max-w-xs">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input placeholder={tr('inv_search')} value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-10 sm:h-9 text-base sm:text-sm" />
          </div>
          {canEdit && <Button onClick={openAdd} size="sm" className="h-10 sm:h-9 shrink-0"><Plus className="size-4 mr-1" /> {tr('inv_add_item')}</Button>}
        </div>
      </div>

      {/* Mobile card view */}
      <div className="sm:hidden space-y-3">
        {/* Mobile sort buttons */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {(['name', 'category', 'qty_on_hand', 'status'] as SortKey[]).map(key => (
            <button
              key={key}
              onClick={() => handleSort(key)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                sortKey === key ? 'bg-[#0a0a0a] text-white border-[#0a0a0a]' : 'bg-white text-muted-foreground border-input'
              }`}
            >
              {key === 'name' ? tr('name') : key === 'category' ? tr('category') : key === 'qty_on_hand' ? tr('inv_qty_on_hand') : tr('status')}
              {sortKey === key && (sortDir === 'asc' ? ' ↑' : ' ↓')}
            </button>
          ))}
        </div>
        {getSortedItems().length === 0 && (
          <div className="text-center py-8 text-muted-foreground">{tr('inv_no_items')}</div>
        )}
        {getSortedItems().map((item) => (
          <div
            key={item._rowIndex}
            className={`rounded-lg border bg-white p-4 space-y-2 ${
              getStockStatus(item) === 'out' ? 'border-red-300 bg-red-50/30' :
              getStockStatus(item) === 'low' ? 'border-amber-300 bg-amber-50/30' : ''
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-base">{item.name}</span>
              <StatusBadge item={item} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${categoryColor[item.category] || 'bg-gray-100 text-gray-700'}`}>
                {tr('inv_cat_' + item.category.toLowerCase().replace(/ /g, '_')) || item.category}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>{tr('inv_qty_on_hand')}: <strong>{item.qty_on_hand}</strong> {item.unit}</span>
              <span className="text-muted-foreground">{tr('inv_min_level')}: {item.min_level}</span>
            </div>
            {canEdit && (
              <div className="flex items-center gap-2 pt-1 border-t">
                <Button variant="outline" size="sm" className="flex-1 h-10" onClick={() => openRestock(item)}>
                  <PackagePlus className="size-4 text-green-600 mr-1" /> {tr('inv_restock')}
                </Button>
                <Button variant="outline" size="sm" className="h-10" onClick={() => openEdit(item)}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="outline" size="sm" className="h-10" onClick={() => handleDelete(item)}>
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop table view */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort('name')}>{tr('name')}<SortIcon column="name" /></TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort('category')}>{tr('category')}<SortIcon column="category" /></TableHead>
              <TableHead>{tr('inv_unit')}</TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort('qty_on_hand')}>{tr('inv_qty_on_hand')}<SortIcon column="qty_on_hand" /></TableHead>
              <TableHead>{tr('inv_min_level')}</TableHead>
              <TableHead className="cursor-pointer select-none" onClick={() => handleSort('status')}>{tr('status')}<SortIcon column="status" /></TableHead>
              {canEdit && <TableHead className="text-right">{tr('actions')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {getSortedItems().map((item, idx) => (
              <TableRow key={item._rowIndex} className={getStockStatus(item) === 'out' ? 'bg-red-50' : getStockStatus(item) === 'low' ? 'bg-amber-50/50' : categoryRowColor[item.category] || ''}>
                <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                <TableCell className="font-medium">{item.name}</TableCell>
                <TableCell>
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${categoryColor[item.category] || 'bg-gray-100 text-gray-700'}`}>
                    {tr('inv_cat_' + item.category.toLowerCase().replace(/ /g, '_')) || item.category}
                  </span>
                </TableCell>
                <TableCell>{item.unit}</TableCell>
                <TableCell>{item.qty_on_hand}</TableCell>
                <TableCell>{item.min_level}</TableCell>
                <TableCell><StatusBadge item={item} /></TableCell>
                {canEdit && <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openRestock(item)} title={tr('inv_restock')}>
                      <PackagePlus className="size-4 text-green-600" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(item)}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(item)}><Trash2 className="size-4 text-destructive" /></Button>
                  </div>
                </TableCell>}
              </TableRow>
            ))}
            {getSortedItems().length === 0 && (
              <TableRow><TableCell colSpan={canEdit ? 8 : 7} className="text-center py-8 text-muted-foreground">{tr('inv_no_items')}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <InventoryFormDialog
        key={editItem?._rowIndex ?? 'new'}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        item={editItem}
        onSave={handleSave}
        l={l}
      />

      <RestockDialog
        key={`restock-${restockTarget?._rowIndex ?? 'none'}`}
        open={restockOpen}
        onOpenChange={setRestockOpen}
        item={restockTarget}
        onRestock={handleRestock}
        l={l}
      />
    </div>
  );
}
