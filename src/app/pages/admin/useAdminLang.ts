import { useState, useCallback } from 'react';

type Lang = 'en' | 'ar';

const t: Record<string, Record<Lang, string>> = {
  // Login
  'bistro_cloud': { en: 'Cacti', ar: 'كاكتي' },
  'admin_panel': { en: 'Admin Panel', ar: 'لوحة التحكم' },
  'admin': { en: 'Admin', ar: 'إدارة' },
  'enter_password': { en: 'Enter admin password', ar: 'أدخل كلمة المرور' },
  'sign_in': { en: 'Sign In', ar: 'تسجيل الدخول' },
  'verifying': { en: 'Verifying...', ar: 'جاري التحقق...' },
  'invalid_password': { en: 'Invalid password. Please try again.', ar: 'كلمة المرور غير صحيحة. حاول مرة أخرى.' },
  'connection_error': { en: 'Connection error. Please try again.', ar: 'خطأ في الاتصال. حاول مرة أخرى.' },
  'logout': { en: 'Logout', ar: 'تسجيل الخروج' },

  // Tabs
  'menu': { en: 'Menu', ar: 'القائمة' },
  'pantry': { en: 'Pantry', ar: 'المخزن' },
  'ramadan': { en: 'Ramadan', ar: 'رمضان' },
  'ramadan_items': { en: 'Ramadan Iftar Combos', ar: 'وجبات إفطار رمضان' },

  // Menu/Products table
  'menu_items': { en: 'Menu Items', ar: 'أصناف القائمة' },
  'image': { en: 'Image', ar: 'صورة' },
  'name': { en: 'Name', ar: 'الاسم' },
  'category': { en: 'Category', ar: 'الفئة' },
  'price': { en: 'Price', ar: 'السعر' },
  'status': { en: 'Status', ar: 'الحالة' },
  'visible': { en: 'Visible', ar: 'مرئي' },
  'actions': { en: 'Actions', ar: 'إجراءات' },
  'add_item': { en: 'Add Item', ar: 'إضافة صنف' },
  'add_product': { en: 'Add Product', ar: 'إضافة منتج' },
  'pantry_products': { en: 'Pantry Products', ar: 'منتجات المخزن' },
  'search_items': { en: 'Search items...', ar: 'بحث عن أصناف...' },
  'search_products': { en: 'Search products...', ar: 'بحث عن منتجات...' },
  'no_items': { en: 'No menu items found', ar: 'لا توجد أصناف' },
  'no_products': { en: 'No products found', ar: 'لا توجد منتجات' },
  'item_added': { en: 'Item added', ar: 'تمت الإضافة' },
  'item_updated': { en: 'Item updated', ar: 'تم التحديث' },
  'item_deleted': { en: 'Item deleted', ar: 'تم الحذف' },
  'product_added': { en: 'Product added', ar: 'تمت إضافة المنتج' },
  'product_updated': { en: 'Product updated', ar: 'تم تحديث المنتج' },
  'product_deleted': { en: 'Product deleted', ar: 'تم حذف المنتج' },
  'failed_load_menu': { en: 'Failed to load menu items', ar: 'فشل تحميل القائمة' },
  'failed_load_products': { en: 'Failed to load products', ar: 'فشل تحميل المنتجات' },
  'failed_delete': { en: 'Failed to delete', ar: 'فشل الحذف' },
  'failed_toggle': { en: 'Failed to toggle visibility', ar: 'فشل تغيير الرؤية' },
  'confirm_delete': { en: 'Delete', ar: 'حذف' },
  'egp': { en: 'EGP', ar: 'ج.م' },

  // Status values
  'available': { en: 'Available', ar: 'متاح' },
  'limited': { en: 'Limited', ar: 'محدود' },
  'sold_out': { en: 'Sold Out', ar: 'نفد' },
  'hidden': { en: 'Hidden', ar: 'مخفي' },

  // Orders tab
  'type': { en: 'Type', ar: 'النوع' },
  'customer': { en: 'Customer', ar: 'العميل' },
  'contact': { en: 'Contact', ar: 'التواصل' },
  'details': { en: 'Details', ar: 'التفاصيل' },
  'no_orders': { en: 'No orders found', ar: 'لا توجد طلبات' },
  'order_archived': { en: 'Order archived', ar: 'تم أرشفة الطلب' },
  'failed_load_orders': { en: 'Failed to load orders', ar: 'فشل تحميل الطلبات' },
  'failed_archive': { en: 'Failed to archive', ar: 'فشل الأرشفة' },
  'confirm_archive': { en: 'Archive this order?', ar: 'أرشفة هذا الطلب؟' },

  // Item form dialog
  'edit_item': { en: 'Edit Item', ar: 'تعديل الصنف' },
  'add_new_item': { en: 'Add New Item', ar: 'إضافة صنف جديد' },
  'description': { en: 'Description', ar: 'الوصف' },
  'item_name': { en: 'Item name', ar: 'اسم الصنف' },
  'item_description': { en: 'Item description', ar: 'وصف الصنف' },
  'price_egp': { en: 'Price (EGP)', ar: 'السعر (ج.م)' },
  'dietary_tags': { en: 'Dietary Tags', ar: 'علامات غذائية' },
  'hidden_from_site': { en: 'Hidden from public site', ar: 'مخفي من الموقع' },
  'drop_image': { en: 'Drop image or click to upload', ar: 'اسحب صورة أو انقر للرفع' },
  'uploading': { en: 'Uploading...', ar: 'جاري الرفع...' },
  'cancel': { en: 'Cancel', ar: 'إلغاء' },
  'update': { en: 'Update', ar: 'تحديث' },
  'saving': { en: 'Saving...', ar: 'جاري الحفظ...' },

  // Sections
  'section_website': { en: 'Website', ar: 'الموقع' },
  'section_inventory': { en: 'Inventory', ar: 'المخزون' },
  'section_kitchen': { en: 'Kitchen', ar: 'المطبخ' },

  // Inventory & Requisitions
  'inventory': { en: 'Inventory', ar: 'المخزون' },
  'requisitions': { en: 'Requisitions', ar: 'الطلبيات' },
  'inv_stock_items': { en: 'Stock Items', ar: 'أصناف المخزون' },
  'inv_add_item': { en: 'Add Stock Item', ar: 'إضافة صنف' },
  'inv_edit_item': { en: 'Edit Stock Item', ar: 'تعديل صنف المخزون' },
  'inv_item_name_ph': { en: 'Item name', ar: 'اسم الصنف' },
  'inv_unit': { en: 'Unit', ar: 'الوحدة' },
  'inv_qty_on_hand': { en: 'Qty On Hand', ar: 'الكمية المتاحة' },
  'inv_min_level': { en: 'Min Level', ar: 'الحد الأدنى' },
  'inv_cost_per_unit': { en: 'Cost/Unit', ar: 'التكلفة/وحدة' },
  'inv_supplier': { en: 'Supplier', ar: 'المورد' },
  'inv_supplier_ph': { en: 'Supplier name', ar: 'اسم المورد' },
  'inv_notes': { en: 'Notes', ar: 'ملاحظات' },
  'inv_notes_ph': { en: 'Optional notes', ar: 'ملاحظات اختيارية' },
  'inv_search': { en: 'Search inventory...', ar: 'بحث في المخزون...' },
  'inv_no_items': { en: 'No stock items found', ar: 'لا توجد أصناف' },
  'inv_ok': { en: 'OK', ar: 'متوفر' },
  'inv_low': { en: 'Low', ar: 'منخفض' },
  'inv_out': { en: 'Out', ar: 'نفد' },
  'inv_item_added': { en: 'Stock item added', ar: 'تمت إضافة الصنف' },
  'inv_item_updated': { en: 'Stock item updated', ar: 'تم تحديث الصنف' },
  'inv_item_deleted': { en: 'Stock item deleted', ar: 'تم حذف الصنف' },
  'inv_failed_load': { en: 'Failed to load inventory', ar: 'فشل تحميل المخزون' },
  'inv_restock': { en: 'Restock', ar: 'إعادة تعبئة' },
  'inv_restocked': { en: 'Item restocked', ar: 'تمت إعادة التعبئة' },
  'inv_current_stock': { en: 'Current stock', ar: 'المخزون الحالي' },
  'inv_quantity': { en: 'Quantity', ar: 'الكمية' },
  'inv_performed_by': { en: 'Performed By', ar: 'بواسطة' },
  'inv_item_low_single': { en: 'item is low or out of stock', ar: 'صنف منخفض أو نفد' },
  'inv_items_low': { en: 'items are low or out of stock', ar: 'أصناف منخفضة أو نفدت' },
  'inv_cat_raw_ingredient': { en: 'Raw Ingredient', ar: 'مادة خام' },
  'inv_cat_packaging': { en: 'Packaging', ar: 'تغليف' },
  'inv_cat_supplies': { en: 'Supplies', ar: 'مستلزمات' },
  'inv_cat_finished_good': { en: 'Finished Good', ar: 'منتج جاهز' },

  // Recipes
  'inv_manage_recipes': { en: 'Manage Recipes', ar: 'إدارة الوصفات' },
  'inv_menu_item': { en: 'Menu Item', ar: 'صنف القائمة' },
  'inv_ingredient': { en: 'Ingredient', ar: 'المكون' },
  'inv_qty_needed': { en: 'Qty Needed', ar: 'الكمية المطلوبة' },
  'inv_all_menu_items': { en: 'All menu items', ar: 'كل أصناف القائمة' },
  'inv_add_recipe_line': { en: 'Add Line', ar: 'إضافة سطر' },
  'inv_select_ingredient': { en: 'Select ingredient...', ar: 'اختر مكون...' },
  'inv_no_recipes': { en: 'No recipes found', ar: 'لا توجد وصفات' },
  'inv_recipe_added': { en: 'Recipe line added', ar: 'تمت إضافة سطر الوصفة' },
  'inv_recipe_deleted': { en: 'Recipe line deleted', ar: 'تم حذف سطر الوصفة' },
  'inv_failed_load_recipes': { en: 'Failed to load recipes', ar: 'فشل تحميل الوصفات' },
  'inv_failed_save_recipe': { en: 'Failed to save recipe', ar: 'فشل حفظ الوصفة' },

  // Requisitions
  'inv_recipe_deduction': { en: 'Recipe Deduction', ar: 'خصم بالوصفة' },
  'inv_manual_deduction': { en: 'Manual Deduction', ar: 'خصم يدوي' },
  'inv_select_menu_item': { en: 'Select menu item...', ar: 'اختر صنف القائمة...' },
  'inv_select_item': { en: 'Select item...', ar: 'اختر صنف...' },
  'inv_portions': { en: 'Portions', ar: 'الحصص' },
  'inv_reason': { en: 'Reason', ar: 'السبب' },
  'inv_deduct_stock': { en: 'Deduct from Stock', ar: 'خصم من المخزون' },
  'inv_add_stock': { en: 'Add to Stock', ar: 'إضافة للمخزون' },
  'inv_deducted_recipe': { en: 'Deducted by recipe', ar: 'تم الخصم بالوصفة' },
  'inv_deducted_manual': { en: 'Deducted manually', ar: 'تم الخصم يدوياً' },
  'inv_failed_deduct': { en: 'Failed to deduct', ar: 'فشل الخصم' },
  'inv_failed_restock': { en: 'Failed to restock', ar: 'فشل إعادة التعبئة' },
  'inv_stock_item': { en: 'Stock Item', ar: 'صنف المخزون' },
  'inv_requisition_log': { en: 'Requisition Log', ar: 'سجل الطلبيات' },
  'inv_no_requisitions': { en: 'No requisitions logged yet', ar: 'لا توجد طلبيات مسجلة' },
  'inv_date': { en: 'Date', ar: 'التاريخ' },
  'inv_direction': { en: 'Direction', ar: 'الاتجاه' },
  'inv_submit_requisition': { en: 'Submit Requisition', ar: 'إرسال طلب' },
  'inv_req_submitted': { en: 'Requisition submitted', ar: 'تم إرسال الطلب' },
  'inv_failed_submit': { en: 'Failed to submit', ar: 'فشل الإرسال' },
  'inv_pending_requests': { en: 'Pending Requests', ar: 'طلبات معلقة' },
  'inv_approve': { en: 'Approve', ar: 'موافقة' },
  'inv_reject': { en: 'Reject', ar: 'رفض' },
  'inv_confirm_reject': { en: 'Reject this requisition for', ar: 'رفض هذا الطلب لـ' },
  'inv_req_approved': { en: 'Requisition approved — stock deducted', ar: 'تمت الموافقة — تم الخصم من المخزون' },
  'inv_req_rejected': { en: 'Requisition rejected', ar: 'تم رفض الطلب' },
  'inv_failed_approve': { en: 'Failed to approve', ar: 'فشلت الموافقة' },
  'inv_failed_reject': { en: 'Failed to reject', ar: 'فشل الرفض' },
  'inv_status_pending': { en: 'Pending', ar: 'معلق' },
  'inv_status_approved': { en: 'Approved', ar: 'تمت الموافقة' },
  'inv_status_rejected': { en: 'Rejected', ar: 'مرفوض' },
  'inv_status_out_of_stock': { en: 'Out of Stock', ar: 'غير متوفر' },
  'inv_req_out_of_stock': { en: 'Marked as out of stock', ar: 'تم التحديد كغير متوفر' },
  'inv_items_label': { en: 'items', ar: 'أصناف' },
  'inv_submit_all': { en: 'Submit All', ar: 'إرسال الكل' },
  'inv_deduct_all': { en: 'Deduct All', ar: 'خصم الكل' },
  'inv_add_to_cart': { en: 'Add to Cart', ar: 'أضف للسلة' },
};

const STORAGE_KEY = 'bc-admin-lang';

export function useAdminLang() {
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem(STORAGE_KEY) as Lang) || 'en'
  );

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const tr = useCallback((key: string): string => {
    return t[key]?.[lang] || key;
  }, [lang]);

  const dir = lang === 'ar' ? 'rtl' as const : 'ltr' as const;

  return { lang, setLang, tr, dir };
}

export type AdminLang = ReturnType<typeof useAdminLang>;
