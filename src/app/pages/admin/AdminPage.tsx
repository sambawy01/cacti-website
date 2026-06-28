import React, { useState, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/app/components/ui/tabs';
import { Button } from '@/app/components/ui/button';
import { getStoredPassword, clearStoredPassword, verifyPassword, getStoredRole, clearStoredRole, Role } from '@/services/adminService';
import { useAdminLang } from './useAdminLang';
import { AdminLogin } from './AdminLogin';
import { MenuTab } from './MenuTab';
import { PantryTab } from './PantryTab';
import { RamadanTab } from './RamadanTab';
import { InventoryTab } from './InventoryTab';
import { RequisitionsTab } from './RequisitionsTab';
import { LogOut, Loader2, Globe, Warehouse, Languages, UtensilsCrossed, Package, Moon, ClipboardList, BoxesIcon, ShoppingBag } from 'lucide-react';
import { OrdersTab } from './OrdersTab';
import { ReservationsTab } from './ReservationsTab';
import { EventsTab } from './EventsTab';

const ROLE_LABELS: Record<Role, Record<'en' | 'ar', string>> = {
  admin: { en: 'Admin', ar: 'إدارة' },
  chef: { en: 'Chef', ar: 'شيف' },
  accounting: { en: 'Accounting', ar: 'محاسبة' },
};

export function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const [section, setSectionState] = useState<'website' | 'inventory' | 'orders'>(
    () => (sessionStorage.getItem('bc-admin-section') as 'website' | 'inventory' | 'orders') || 'website'
  );
  function setSection(s: 'website' | 'inventory' | 'orders') {
    setSectionState(s);
    sessionStorage.setItem('bc-admin-section', s);
  }
  const l = useAdminLang();
  const { tr, lang, setLang, dir } = l;

  useEffect(() => {
    const pw = getStoredPassword();
    if (!pw) {
      setChecking(false);
      return;
    }
    verifyPassword(pw).then(result => {
      if (result.valid && result.role) {
        setAuthed(true);
        setRole(result.role);
        // Only set default section if none saved
        if (!sessionStorage.getItem('bc-admin-section')) {
          if (result.role === 'accounting') setSection('inventory');
          else setSection('website');
        }
      } else {
        clearStoredPassword();
        clearStoredRole();
      }
      setChecking(false);
    });
  }, []);

  function handleLogin(r: Role) {
    setAuthed(true);
    setRole(r);
    if (r === 'accounting') setSection('inventory');
    else setSection('website');
  }

  function handleLogout() {
    clearStoredPassword();
    clearStoredRole();
    sessionStorage.removeItem('bc-admin-section');
    sessionStorage.removeItem('bc-admin-tab-website');
    sessionStorage.removeItem('bc-admin-tab-inventory');
    setAuthed(false);
    setRole(null);
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f0]">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!authed) {
    return (
      <div dir={dir}>
        <div className="absolute top-4 right-4">
          <Button variant="ghost" size="sm" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
            <Languages className="size-4 mr-1" /> {lang === 'en' ? 'عربي' : 'English'}
          </Button>
        </div>
        <AdminLogin onLogin={handleLogin} l={l} />
      </div>
    );
  }

  // Role-based visibility
  const canSeeWebsite = role === 'admin' || role === 'chef' || role === 'accounting';
  const canSeeInventory = role === 'admin' || role === 'accounting' || role === 'chef';
  const canSeeOrders = role === 'admin' || role === 'chef';

  // Determine available sections for this role
  const sections: { key: 'website' | 'inventory' | 'orders'; label: string; icon: React.ReactNode }[] = [];
  if (canSeeWebsite) {
    sections.push({ key: 'website', label: tr('section_website'), icon: <Globe className="size-4" /> });
  }
  if (canSeeInventory) {
    sections.push({ key: 'inventory', label: tr('section_inventory'), icon: <Warehouse className="size-4" /> });
  }
  if (canSeeOrders) {
    sections.push({ key: 'orders', label: 'Orders', icon: <ShoppingBag className="size-4" /> });
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0]" dir={dir}>
      <header className="bg-white border-b sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-[#0a0a0a]">{tr('bistro_cloud')}</h1>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
              {role ? ROLE_LABELS[role][lang] : tr('admin')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
              <Languages className="size-4 sm:mr-1" /> <span className="hidden sm:inline">{lang === 'en' ? 'عربي' : 'English'}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="size-4 sm:mr-1" /> <span className="hidden sm:inline">{tr('logout')}</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Top-level section switcher — only show if user has more than 1 section */}
      {sections.length > 1 && (
        <div className="bg-white border-b">
          <div className="max-w-6xl mx-auto px-4 flex gap-1 py-1">
            {sections.map(s => (
              <button
                key={s.key + s.label}
                onClick={() => setSection(s.key)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  section === s.key
                    ? 'bg-[#0a0a0a] text-white'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {s.icon} {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Website section — admin & chef */}
        {section === 'website' && canSeeWebsite && (
          <Tabs
            defaultValue={sessionStorage.getItem('bc-admin-tab-website') || 'menu'}
            onValueChange={v => sessionStorage.setItem('bc-admin-tab-website', v)}
          >
            <TabsList className="mb-6">
              <TabsTrigger value="menu">
                <UtensilsCrossed className="size-4 mr-1.5" /> {tr('menu')}
              </TabsTrigger>
              <TabsTrigger value="ramadan">
                <Moon className="size-4 mr-1.5" /> {tr('ramadan')}
              </TabsTrigger>
              <TabsTrigger value="pantry">
                <Package className="size-4 mr-1.5" /> {tr('pantry')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="menu"><MenuTab l={l} /></TabsContent>
            <TabsContent value="ramadan"><RamadanTab l={l} /></TabsContent>
            <TabsContent value="pantry"><PantryTab l={l} /></TabsContent>
          </Tabs>
        )}

        {/* Inventory section — all roles, permissions handled by child components */}
        {section === 'inventory' && canSeeInventory && (
          <Tabs
            defaultValue={sessionStorage.getItem('bc-admin-tab-inventory') || 'stock'}
            onValueChange={v => sessionStorage.setItem('bc-admin-tab-inventory', v)}
          >
            <TabsList className="mb-6">
              <TabsTrigger value="stock">
                <BoxesIcon className="size-4 mr-1.5" /> {tr('inv_stock_items')}
              </TabsTrigger>
              <TabsTrigger value="requisitions">
                <ClipboardList className="size-4 mr-1.5" /> {tr('requisitions')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="stock"><InventoryTab l={l} role={role!} /></TabsContent>
            <TabsContent value="requisitions"><RequisitionsTab l={l} role={role!} /></TabsContent>
          </Tabs>
        )}

        {/* Operations section — admin & chef only */}
        {section === 'orders' && canSeeOrders && (
          <Tabs
            defaultValue={sessionStorage.getItem('bc-admin-tab-orders') || 'orders'}
            onValueChange={v => sessionStorage.setItem('bc-admin-tab-orders', v)}
          >
            <TabsList className="mb-6">
              <TabsTrigger value="orders">
                <ShoppingBag className="size-4 mr-1.5" /> Orders
              </TabsTrigger>
              <TabsTrigger value="reservations">
                <UtensilsCrossed className="size-4 mr-1.5" /> Reservations
              </TabsTrigger>
              <TabsTrigger value="events">
                <Moon className="size-4 mr-1.5" /> Events
              </TabsTrigger>
            </TabsList>

            <TabsContent value="orders"><OrdersTab l={l} /></TabsContent>
            <TabsContent value="reservations"><ReservationsTab /></TabsContent>
            <TabsContent value="events"><EventsTab /></TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
