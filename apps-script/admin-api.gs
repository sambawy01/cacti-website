/**
 * Bistro Cloud CRM + Admin API — Google Apps Script
 *
 * EXISTING: Handles form submissions from bistro-cloud.com
 *           Processes catering inquiries, orders, and contact forms
 *           Sends confirmation emails to customers
 *
 * NEW:      Admin panel CRUD via JSONP for menu/products/orders management
 *           Password-protected admin actions
 *
 * Deploy as: Web App → Execute as: Me → Access: Anyone
 */

// ============ CONFIGURATION ============
const OLD_SPREADSHEET_ID = '1bEt7BVbWfQzlt8t1qh92FxX0e7M-R-_EPvMdU8wJv5M'; // Legacy — kept for reference
const PEOPLE_SHEET = 'People';
const OPPORTUNITIES_SHEET = 'Opportunities';
const NOTIFICATION_EMAIL = 'bistrocloud3@gmail.com';

// ── New CRM Sheet ──
// Create a new Google Sheet, paste its ID here, then run setupCRM() once from the script editor.
var CRM_SHEET_ID = '1xCKNznRPmxr4II3XW7--Oqeu6aGHgKqhc08eJxabpzw';
// Role-based passwords
function getRole(pw) {
  if (pw === 'Bistro001') return 'admin';
  if (pw === 'Bistro2026!') return 'chef';
  if (pw === 'BC2026!') return 'accounting';
  return null;
}
// ========================================

function doPost(e) {
  try {
    let payload;

    // Handle form-encoded data (from hidden form submission)
    if (e.parameter && e.parameter.payload) {
      payload = JSON.parse(e.parameter.payload);
    }
    // Handle text/plain body (legacy fetch approach)
    else if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }
    else {
      return ContentService.createTextOutput(JSON.stringify({
        success: false,
        error: 'No data received'
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const formType = payload.formType;
    const data = payload.data;
    const timestamp = payload.timestamp || new Date().toISOString();

    if (formType === 'catering_inquiry') {
      addCateringInquiry(data, timestamp);
      sendCateringConfirmationEmail(data);
      sendInternalNotification(data, formType);
    } else if (formType === 'contact') {
      addContactSubmission(data, timestamp);
      sendInternalNotification(data, formType);
    } else if (formType === 'order') {
      addOrderSubmission(data, timestamp);
      sendInternalNotification(data, formType);
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    Logger.log('Error in doPost: ' + error.toString());
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  var params = e.parameter || {};
  var callback = params.callback || '';
  var action = params.action || '';
  var password = params.password || '';
  var sheetName = params.sheet || 'Menu';

  // ── Legacy CRM: no action param, just a payload → process form submission ──
  if (!action && params.payload) {
    return doPost(e);
  }

  // ── Health check (no action, no payload) ──
  if (!action) {
    return ContentService.createTextOutput(JSON.stringify({
      status: 'ok',
      message: 'Bistro Cloud CRM + Admin API is running'
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // ── Public order actions (no password — customer-facing) ──
  if (action === 'getAvailability' || action === 'placeOrder' || action === 'getOrderStatus') {
    try {
      if (action === 'getAvailability') return jsonpResponse(callback, orderGetAvailability());
      if (action === 'placeOrder') return jsonpResponse(callback, orderPlace(params));
      return jsonpResponse(callback, orderGetStatus(params.token, params.password));
    } catch (err) {
      Logger.log('Public order action failed (' + action + '): ' + err);
      return jsonpResponse(callback, { success: false, error: 'Something went wrong. Please try again.' });
    }
  }

  // ── Admin actions: all require valid role password ──
  var role = getRole(password);
  if (!role) {
    return jsonpResponse(callback, { success: false, error: 'Unauthorized' });
  }

  try {
    switch (action) {
      // ── Read actions ──
      case 'verify':
        return jsonpResponse(callback, { success: true, role: role });
      case 'getMenu':
        return jsonpResponse(callback, adminGetMenu());
      case 'getPantry':
        return jsonpResponse(callback, adminGetPantry());
      case 'getOrders':
        return jsonpResponse(callback, adminGetOrders());
      // ── Write actions (all via GET to avoid 302 redirect issues with POST) ──
      case 'addItem':
        return jsonpResponse(callback, adminAddItem(params.item));
      case 'editItem':
        return jsonpResponse(callback, adminEditItem(parseInt(params.rowIndex), params.item));
      case 'deleteItem':
        return jsonpResponse(callback, adminDeleteItem(parseInt(params.rowIndex)));
      case 'toggleVisibility':
        return jsonpResponse(callback, adminToggleVisibility(parseInt(params.rowIndex), params.status));
      case 'addPantryItem':
        return jsonpResponse(callback, adminAddPantryItem(params.item));
      case 'editPantryItem':
        return jsonpResponse(callback, adminEditPantryItem(parseInt(params.rowIndex), params.item));
      case 'deletePantryItem':
        return jsonpResponse(callback, adminDeletePantryItem(parseInt(params.rowIndex)));
      case 'togglePantryVisibility':
        return jsonpResponse(callback, adminTogglePantryVisibility(parseInt(params.rowIndex), params.status));
      case 'archiveOrder':
        return jsonpResponse(callback, adminArchiveOrder(parseInt(params.rowIndex)));
      case 'setOrderStatus':
        return jsonpResponse(callback, orderSetStatus(parseInt(params.rowIndex), params.status, params.orderId));
      case 'setOrderStatusByToken':
        return jsonpResponse(callback, orderSetStatusByToken(params.token, params.status));
      // ── Inventory (Stock) CRUD ──
      case 'getStock':
        return jsonpResponse(callback, inventoryGetAll());
      case 'addStockItem':
        return jsonpResponse(callback, inventoryAdd(params.item));
      case 'editStockItem':
        return jsonpResponse(callback, inventoryEdit(parseInt(params.rowIndex), params.item));
      case 'deleteStockItem':
        return jsonpResponse(callback, inventoryDelete(parseInt(params.rowIndex)));
      // ── Recipe CRUD ──
      case 'getRecipes':
        return jsonpResponse(callback, recipeGetAll());
      case 'addRecipe':
        return jsonpResponse(callback, recipeAdd(params.item));
      case 'editRecipe':
        return jsonpResponse(callback, recipeEdit(parseInt(params.rowIndex), params.item));
      case 'deleteRecipe':
        return jsonpResponse(callback, recipeDelete(parseInt(params.rowIndex)));
      // ── Requisitions ──
      case 'getRequisitions':
        return jsonpResponse(callback, requisitionGetAll());
      case 'addRequisition':
        return jsonpResponse(callback, requisitionAdd(params.item));
      case 'editRequisition':
        return jsonpResponse(callback, requisitionEdit(parseInt(params.rowIndex), params.item));
      case 'deleteRequisition':
        return jsonpResponse(callback, requisitionDelete(parseInt(params.rowIndex)));
      case 'approveRequisition':
        return jsonpResponse(callback, requisitionApprove(parseInt(params.rowIndex)));
      case 'rejectRequisition':
        return jsonpResponse(callback, requisitionReject(parseInt(params.rowIndex)));
      case 'outOfStockRequisition':
        return jsonpResponse(callback, requisitionOutOfStock(parseInt(params.rowIndex)));
      // ── CRM Read endpoints ──
      case 'getCatering':
        return jsonpResponse(callback, { success: true, items: crmReadRows('Catering') });
      case 'getCRMOrders':
        return jsonpResponse(callback, { success: true, items: crmReadRows('Orders') });
      case 'getContacts':
        return jsonpResponse(callback, { success: true, items: crmReadRows('Contacts') });
      case 'getPipeline':
        return jsonpResponse(callback, { success: true, items: crmReadRows('Pipeline') });
      // ── CRM Edit/Delete ──
      case 'editCRMRow':
        return jsonpResponse(callback, crmEditRow(params.tab, parseInt(params.rowIndex), params.item));
      case 'deleteCRMRow':
        return jsonpResponse(callback, crmDeleteRow(params.tab, parseInt(params.rowIndex)));
      default:
        return jsonpResponse(callback, { success: false, error: 'Unknown action: ' + action });
    }
  } catch (err) {
    return jsonpResponse(callback, { success: false, error: err.message });
  }
}

// ============ JSONP HELPER ============

function jsonpResponse(callback, data) {
  var json = JSON.stringify(data);
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

// ============ ADMIN CRUD ============
// Menu sheet ID (separate from CRM sheet)
const MENU_SHEET_ID = '1kCS-s-Iq0d8xHd7xm0yC59l8ZDt8_gOnHgNEx0oWVcE';
const PANTRY_SHEET_ID = '1mgee-wfP0v8CRD-8c3B9JUQyFAWdkovLjxkxW_Nl0QQ';

function adminGetMenuSheet() {
  var ss = SpreadsheetApp.openById(MENU_SHEET_ID);
  var sheet = ss.getSheetByName('Menu');
  if (!sheet) sheet = ss.getSheets()[0]; // fallback to first sheet
  return sheet;
}

function adminGetHeaders(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
    return String(h).toLowerCase().trim();
  });
}

function adminGetMenu() {
  var sheet = adminGetMenuSheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) return { success: true, items: [] };

  var headers = adminGetHeaders(sheet);
  var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var items = [];

  for (var i = 0; i < dataRange.length; i++) {
    var row = dataRange[i];
    if (row.every(function(cell) { return String(cell).trim() === ''; })) continue;

    var item = { _rowIndex: i + 2 };
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      // Keep numbers as numbers for id and price
      if (headers[j] === 'id' || headers[j] === 'price') {
        item[headers[j]] = val === '' ? '' : (isNaN(Number(val)) ? val : Number(val));
      } else {
        item[headers[j]] = val !== undefined ? String(val) : '';
      }
    }
    items.push(item);
  }

  return { success: true, items: items };
}

function adminGetOrders() {
  var ss = SpreadsheetApp.openById(OLD_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(PEOPLE_SHEET);
  if (!sheet) return { success: true, orders: [] };

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) return { success: true, orders: [] };

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var orders = [];

  for (var i = 0; i < dataRange.length; i++) {
    var row = dataRange[i];
    if (row.every(function(cell) { return String(cell).trim() === ''; })) continue;

    var order = { _rowIndex: i + 2 };
    for (var j = 0; j < headers.length; j++) {
      order[String(headers[j])] = row[j] !== undefined ? String(row[j]) : '';
    }
    orders.push(order);
  }

  return { success: true, orders: orders };
}

function adminAddItem(itemStr) {
  var sheet = adminGetMenuSheet();
  var headers = adminGetHeaders(sheet);
  var item = JSON.parse(itemStr);

  if (!item.id) {
    item.id = Date.now();
  }

  var newRow = headers.map(function(h) {
    return item[h] !== undefined ? item[h] : '';
  });

  sheet.appendRow(newRow);
  return { success: true };
}

function adminEditItem(rowIndex, itemStr) {
  var sheet = adminGetMenuSheet();
  var headers = adminGetHeaders(sheet);
  var item = JSON.parse(itemStr);

  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) {
    throw new Error('Invalid row: ' + rowIndex);
  }

  for (var j = 0; j < headers.length; j++) {
    var h = headers[j];
    if (h === 'id') continue; // don't overwrite ID
    if (item.hasOwnProperty(h)) {
      sheet.getRange(rowIndex, j + 1).setValue(item[h]);
    }
  }

  return { success: true };
}

function adminDeleteItem(rowIndex) {
  var sheet = adminGetMenuSheet();

  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) {
    throw new Error('Invalid row: ' + rowIndex);
  }

  sheet.deleteRow(rowIndex);
  return { success: true };
}

function adminToggleVisibility(rowIndex, newStatus) {
  var sheet = adminGetMenuSheet();
  var headers = adminGetHeaders(sheet);
  var statusCol = headers.indexOf('status');

  if (statusCol < 0) throw new Error('Status column not found');
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) {
    throw new Error('Invalid row: ' + rowIndex);
  }

  sheet.getRange(rowIndex, statusCol + 1).setValue(newStatus);
  return { success: true };
}

function adminArchiveOrder(rowIndex) {
  var ss = SpreadsheetApp.openById(OLD_SPREADSHEET_ID);
  var sourceSheet = ss.getSheetByName(PEOPLE_SHEET);
  if (!sourceSheet) throw new Error('People sheet not found');

  var archiveSheet = ss.getSheetByName('Archive');
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet('Archive');
    var headers = sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn()).getValues();
    archiveSheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
  }

  if (rowIndex < 2 || rowIndex > sourceSheet.getLastRow()) {
    throw new Error('Invalid row: ' + rowIndex);
  }

  var rowData = sourceSheet.getRange(rowIndex, 1, 1, sourceSheet.getLastColumn()).getValues();
  archiveSheet.appendRow(rowData[0]);
  sourceSheet.deleteRow(rowIndex);

  return { success: true };
}

// ============ PANTRY CRUD ============

function adminGetPantrySheet() {
  var ss = SpreadsheetApp.openById(PANTRY_SHEET_ID);
  var sheet = ss.getSheetByName('Products') || ss.getSheets()[0];
  return sheet;
}

function adminGetPantry() {
  var sheet = adminGetPantrySheet();
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) return { success: true, items: [] };

  var headers = adminGetHeaders(sheet);
  var dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var items = [];

  for (var i = 0; i < dataRange.length; i++) {
    var row = dataRange[i];
    if (row.every(function(cell) { return String(cell).trim() === ''; })) continue;

    var item = { _rowIndex: i + 2 };
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      if (headers[j] === 'id' || headers[j] === 'price') {
        item[headers[j]] = val === '' ? '' : (isNaN(Number(val)) ? val : Number(val));
      } else {
        item[headers[j]] = val !== undefined ? String(val) : '';
      }
    }
    items.push(item);
  }

  return { success: true, items: items };
}

function adminAddPantryItem(itemStr) {
  var sheet = adminGetPantrySheet();
  var headers = adminGetHeaders(sheet);
  var item = JSON.parse(itemStr);
  if (!item.id) item.id = Date.now();
  var newRow = headers.map(function(h) { return item[h] !== undefined ? item[h] : ''; });
  sheet.appendRow(newRow);
  return { success: true };
}

function adminEditPantryItem(rowIndex, itemStr) {
  var sheet = adminGetPantrySheet();
  var headers = adminGetHeaders(sheet);
  var item = JSON.parse(itemStr);
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);
  for (var j = 0; j < headers.length; j++) {
    var h = headers[j];
    if (h === 'id') continue;
    if (item.hasOwnProperty(h)) sheet.getRange(rowIndex, j + 1).setValue(item[h]);
  }
  return { success: true };
}

function adminDeletePantryItem(rowIndex) {
  var sheet = adminGetPantrySheet();
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);
  sheet.deleteRow(rowIndex);
  return { success: true };
}

function adminTogglePantryVisibility(rowIndex, newStatus) {
  var sheet = adminGetPantrySheet();
  var headers = adminGetHeaders(sheet);
  var statusCol = headers.indexOf('status');
  if (statusCol < 0) throw new Error('Status column not found');
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);
  sheet.getRange(rowIndex, statusCol + 1).setValue(newStatus);
  return { success: true };
}

// ============ CRM DATA STORAGE (v2 — header-based, one tab per form type) ============

/**
 * CRM Schema — run setupCRM() once from the script editor to create all tabs.
 * Each tab has explicit headers. All writes use header-based column lookup
 * so data NEVER shifts even if columns are reordered.
 */
var CRM_TABS = {
  Catering: ['id', 'timestamp', 'name', 'company', 'email', 'phone', 'event_type', 'guest_count', 'event_date', 'location', 'menu_preferences', 'status', 'notes'],
  Orders:   ['id', 'timestamp', 'name', 'phone', 'email', 'delivery_area', 'address', 'order_total', 'order_summary', 'item_count', 'delivery_date', 'delivery_slot', 'tracking_token', 'status', 'notes'],
  Contacts: ['id', 'timestamp', 'name', 'email', 'phone', 'message', 'status'],
  Pipeline: ['id', 'timestamp', 'type', 'deal_name', 'contact_name', 'company', 'email', 'stage', 'value', 'event_date', 'guest_count', 'location', 'status', 'notes'],
  Settings: ['setting', 'value'],
};

/**
 * Run this ONCE from the Apps Script editor to create all CRM tabs with headers.
 * Menu: Run → setupCRM
 */
function setupCRM() {
  if (!CRM_SHEET_ID) throw new Error('Set CRM_SHEET_ID first — create a new Google Sheet and paste its ID.');
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);

  for (var tabName in CRM_TABS) {
    var headers = CRM_TABS[tabName];
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      Logger.log('Created tab: ' + tabName);
    }
    // Write headers to row 1
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    // Bold + freeze header row
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    // Auto-resize columns
    for (var i = 1; i <= headers.length; i++) {
      sheet.setColumnWidth(i, 140);
    }
  }

  // Delete the default "Sheet1" if it's empty and other tabs exist
  var defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1) {
    var lastRow = defaultSheet.getLastRow();
    if (lastRow <= 1) {
      try { ss.deleteSheet(defaultSheet); } catch (_) {}
    }
  }

  Logger.log('CRM setup complete! Tabs: ' + Object.keys(CRM_TABS).join(', '));
}

// ============ CAPACITY: SCHEMA MIGRATION + SETTINGS ============

var BISTRO_TZ = 'Africa/Cairo';

// A Date handed back by getValues() represents the wall-clock in the SHEET's
// timezone (which may differ from the script's). Format it back in that same
// timezone to recover the correct value. Cached so we don't re-open per row.
var _crmTimeZone = null;
function getCrmTimeZone() {
  if (!_crmTimeZone) {
    try { _crmTimeZone = SpreadsheetApp.openById(CRM_SHEET_ID).getSpreadsheetTimeZone(); }
    catch (e) { _crmTimeZone = BISTRO_TZ; }
  }
  return _crmTimeZone;
}

// Sheets may hand back Date objects for time/date-looking cells beyond the
// '@'-formatted range. Normalize defensively so capacity math never sees a Date.
function normalizeSlotString(val) {
  if (val instanceof Date) {
    return Utilities.formatDate(val, getCrmTimeZone(), 'HH:mm');
  }
  return String(val === undefined || val === null ? '' : val);
}

function normalizeDateString(val) {
  if (val instanceof Date) return Utilities.formatDate(val, getCrmTimeZone(), 'yyyy-MM-dd');
  return String(val === undefined || val === null ? '' : val);
}

/**
 * Run ONCE from the Apps Script editor after deploying this version.
 * Appends the new capacity columns to the existing Orders tab (header-based
 * appends mean column order never matters) and forces the text-like columns
 * to plain-text format so Sheets doesn't convert '14:30' to a time value.
 */
function migrateOrdersTab() {
  var sheet = crmGetSheet('Orders');
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var wanted = CRM_TABS.Orders;
  var added = [];
  for (var i = 0; i < wanted.length; i++) {
    if (headers.indexOf(wanted[i]) < 0) {
      lastCol += 1;
      sheet.getRange(1, lastCol).setValue(wanted[i]).setFontWeight('bold');
      headers.push(wanted[i]);
      added.push(wanted[i]);
    }
  }
  // Force plain-text format on columns Sheets would otherwise auto-convert.
  // NOTE: this only covers rows up to getMaxRows() AT MIGRATION TIME; rows
  // appended beyond that range revert to default format. The per-row text
  // hardening in orderPlace (setNumberFormat('@') + setValue on the appended
  // row) is the DURABLE guarantee — this loop just fixes the existing range.
  var textCols = ['delivery_date', 'delivery_slot', 'tracking_token'];
  for (var t = 0; t < textCols.length; t++) {
    var idx = headers.indexOf(textCols[t]);
    if (idx >= 0) {
      sheet.getRange(1, idx + 1, sheet.getMaxRows(), 1).setNumberFormat('@');
    }
  }
  Logger.log('Orders migration done. Added: ' + (added.join(', ') || 'none'));
}

/**
 * Run ONCE from the Apps Script editor. Seeds the Settings tab with the
 * default capacity rules. Edit the cells any time to change the rules —
 * no redeploy needed.
 */
function setupCapacitySettings() {
  var sheet = crmGetSheet('Settings');
  if (sheet.getLastRow() > 1) {
    Logger.log('Settings tab already has values — not overwriting.');
    return;
  }
  var rows = [
    ['maxOrdersPerHour', 4],
    ['maxItemsPerHour', 6],
    ['openHour', 14],
    ['closeHour', 20],
    ['leadTimeMins', 30],
    ['maxDailyPlacements', 60],
    ['blackoutDates', ''],
    ['paused', 'FALSE'],
  ];
  sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  Logger.log('Capacity settings seeded.');
}

function getCapacitySettings() {
  var sheet = crmGetSheet('Settings');
  var lastRow = sheet.getLastRow();
  var rows = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  return parseCapacitySettings(rows);
}

function cairoToday() {
  return Utilities.formatDate(new Date(), BISTRO_TZ, 'yyyy-MM-dd');
}

function cairoNowMinutes() {
  return slotToMinutes(Utilities.formatDate(new Date(), BISTRO_TZ, 'HH:mm'));
}

// ============ CAPACITY: ORDER ENGINE ============

var AVAILABILITY_CACHE_KEY = 'bc_avail_v1';

function orderGetAvailability() {
  var cache = CacheService.getScriptCache();
  try {
    var cached = cache.get(AVAILABILITY_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* cache failures must never break availability */ }
  var settings = getCapacitySettings();
  var orders = crmReadRows('Orders');
  var avail = computeAvailability(orders, settings, cairoToday(), cairoNowMinutes());
  var result = { success: true, availability: avail };
  try { cache.put(AVAILABILITY_CACHE_KEY, JSON.stringify(result), 30); } catch (e) {}
  return result;
}

function invalidateAvailabilityCache() {
  try { CacheService.getScriptCache().remove(AVAILABILITY_CACHE_KEY); } catch (e) {}
}

/**
 * Capacity-checked order placement. The lock serializes the
 * re-check + write so two simultaneous customers can't both take the
 * last slot in an hour.
 *
 * params (all strings from the GET query):
 *   name, phone, email, address, deliveryArea, orderTotal, orderSummary,
 *   itemCount, deliverySlot ('HH:mm'), expectedStatus ('open'|'busy')
 */
function orderPlace(params) {
  var paymentMethod = String(params.paymentMethod || '');
  var instapayDetails = String(params.instapayDetails || '');
  var PAYMENT_LABELS = {
    cod: 'Cash on delivery',
    card_on_delivery: 'Card on delivery (POS at door)',
    instapay: 'Instapay (bank transfer)'
  };
  var paymentLabel = PAYMENT_LABELS[paymentMethod] || '';

  // Input validation — before any locking or sheet I/O.
  var slotParam = String(params.deliverySlot || '');
  if (!/^\d{1,2}:\d{2}$/.test(slotParam)) {
    return { success: false, code: 'slot_unavailable' };
  }
  // Single valid recipient only — MailApp accepts comma lists, so reject anything non-simple.
  var email = String(params.email || '').trim();
  if (email && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) email = '';
  var itemCount = Math.min(60, Math.max(1, Math.floor(Number(params.itemCount)) || 1));

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    return { success: false, code: 'busy_retry' };
  }
  var outcome, avail, id, token, ts;
  try {
    var settings = getCapacitySettings();
    var orders = crmReadRows('Orders');
    var today = cairoToday();

    // Daily placement cap across all statuses — abuse backstop for the public endpoint.
    var placedToday = 0;
    for (var i = 0; i < orders.length; i++) {
      if (String(orders[i].delivery_date) === today) placedToday++;
    }
    if (placedToday >= settings.maxDailyPlacements) {
      return { success: false, code: 'daily_limit' };
    }

    avail = computeAvailability(orders, settings, today, cairoNowMinutes());
    outcome = decideOrderOutcome(avail, slotParam, params.expectedStatus || 'open');
    if (outcome === 'slot_full' || outcome === 'slot_unavailable') {
      return { success: false, code: outcome, availability: avail };
    }

    id = Date.now();
    token = Utilities.getUuid();
    ts = new Date().toISOString();

    crmAppendRow('Orders', {
      id: id,
      timestamp: ts,
      name: params.name || '',
      phone: params.phone || '',
      email: email,
      delivery_area: params.deliveryArea || '',
      address: params.address || '',
      order_total: params.orderTotal || '',
      order_summary: params.orderSummary || '',
      item_count: itemCount,
      delivery_date: avail.date,
      delivery_slot: slotParam,
      tracking_token: token,
      status: outcome,
      notes: (paymentLabel ? paymentLabel + (params.note ? ' — ' : '') : '') + (params.note || ''),
    });

    // Force the slot/date/token cells of the row we just appended to plain text.
    // Sheets otherwise coerces '14:00' into a time value (corrupting it across
    // timezones and breaking capacity bucketing). Text storage is TZ-independent.
    try {
      var ordersSheet = crmGetSheet('Orders');
      var oRow = ordersSheet.getLastRow();
      var oHeaders = ordersSheet.getRange(1, 1, 1, ordersSheet.getLastColumn()).getValues()[0].map(function (h) {
        return String(h).trim().toLowerCase().replace(/ /g, '_');
      });
      var textCells = { delivery_slot: slotParam, delivery_date: avail.date, tracking_token: token };
      for (var tcKey in textCells) {
        var tci = oHeaders.indexOf(tcKey);
        if (tci >= 0) {
          var tcell = ordersSheet.getRange(oRow, tci + 1);
          tcell.setNumberFormat('@');      // format FIRST, then value, so it stores as text
          tcell.setValue(textCells[tcKey]);
        }
      }
    } catch (eFmt) {
      Logger.log('Order text-cell hardening failed (non-fatal): ' + eFmt);
    }

    // Pipeline is CRM bookkeeping — never fail the order on it.
    try {
      crmAppendRow('Pipeline', {
        id: id,
        timestamp: ts,
        type: 'order',
        deal_name: 'Order — ' + (params.name || 'Unknown'),
        contact_name: params.name || '',
        company: '',
        email: email,
        stage: outcome === 'confirmed' ? 'Won' : 'Inquiry',
        value: params.orderTotal || '',
        event_date: avail.date,
        guest_count: '1',
        location: params.deliveryArea || params.address || '',
        status: outcome === 'confirmed' ? 'Completed' : 'Open',
        notes: params.orderSummary || '',
      });
    } catch (e) {
      Logger.log('Pipeline append failed: ' + e);
    }

    // Commit buffered writes BEFORE releasing the lock, or the next
    // locked reader can still see pre-append data (double booking).
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  // Slow side effects (calendar, email) run OUTSIDE the lock.
  invalidateAvailabilityCache();
  var orderInfo = {
    name: params.name || '',
    phone: params.phone || '',
    email: email,
    address: params.address || '',
    orderTotal: params.orderTotal || '',
    orderSummary: params.orderSummary || '',
    itemCount: itemCount,
    deliveryDate: avail.date,
    deliverySlot: slotParam,
    trackingToken: token,
    paymentMethod: paymentMethod,
    paymentLabel: paymentLabel,
    instapayDetails: instapayDetails,
  };
  if (outcome === 'confirmed') {
    createKitchenEvent(orderInfo);
    sendOrderConfirmationEmail(orderInfo);
  }
  if (String(params.channel || '') !== 'web') {
    sendInternalNotification({
      name: params.name,
      phone: params.phone,
      deliverySlot: slotLabel12h(slotParam),
      status: outcome,
      orderTotal: params.orderTotal,
      orderSummary: params.orderSummary,
    }, 'order');
  }

  return {
    success: true,
    status: outcome,
    trackingToken: token,
    deliverySlot: slotParam,
    deliveryDate: avail.date,
    id: id,
  };
}

// `password` is optional. When a valid role password is supplied, the response
// also includes private fields (phone/address/note/paymentMethod) that the
// Telegram approve path needs to build a Loyverse receipt. Public callers (the
// customer tracking page) pass no password and get only the safe fields.
function orderGetStatus(token, password) {
  if (!token) return { success: false, error: 'Missing token' };
  var includePrivate = password ? !!getRole(password) : false;
  var orders = crmReadRows('Orders');
  for (var i = orders.length - 1; i >= 0; i--) {
    if (String(orders[i].tracking_token) === String(token)) {
      var o = orders[i];
      var order = {
        name: String(o.name || ''),
        status: String(o.status || ''),
        deliveryDate: String(o.delivery_date || ''),
        deliverySlot: String(o.delivery_slot || ''),
        orderSummary: String(o.order_summary || ''),
        orderTotal: o.order_total || '',
      };
      if (includePrivate) {
        order.phone = String(o.phone || '');
        order.address = String(o.address || '');
        order.note = String(o.notes || '');
        order.paymentMethod = paymentMethodFromNotes(String(o.notes || ''));
      }
      return { success: true, order: order };
    }
  }
  return { success: false, error: 'Order not found' };
}

// Reverse-map the payment-label prefix stored in the notes column back to the
// payment-method code (orderPlace writes 'Cash on delivery' / 'Card on delivery
// (POS at door)' / 'Instapay (bank transfer)' as the notes prefix).
function paymentMethodFromNotes(notes) {
  var n = String(notes || '');
  if (n.indexOf('Cash on delivery') === 0) return 'cod';
  if (n.indexOf('Card on delivery') === 0) return 'card_on_delivery';
  if (n.indexOf('Instapay') === 0) return 'instapay';
  return '';
}

// ============ CAPACITY: KITCHEN CALENDAR ============

var KITCHEN_CALENDAR_NAME = 'Bistro Kitchen';

function getKitchenCalendar() {
  var cals = CalendarApp.getCalendarsByName(KITCHEN_CALENDAR_NAME);
  if (cals.length > 0) return cals[0];
  return CalendarApp.createCalendar(KITCHEN_CALENDAR_NAME);
}

/** orderInfo: { name, phone, address, orderTotal, orderSummary, itemCount, deliveryDate, deliverySlot } */
function createKitchenEvent(orderInfo) {
  try {
    var start = Utilities.parseDate(
      orderInfo.deliveryDate + ' ' + orderInfo.deliverySlot, BISTRO_TZ, 'yyyy-MM-dd HH:mm');
    var end = new Date(start.getTime() + 30 * 60000);
    var title = orderInfo.name + ' — ' + orderInfo.itemCount + ' item(s) — ' + orderInfo.orderTotal + ' EGP';
    var desc = 'Phone: ' + orderInfo.phone +
      '\nAddress: ' + orderInfo.address +
      '\n\n' + orderInfo.orderSummary;
    getKitchenCalendar().createEvent(title, start, end, { description: desc });
  } catch (error) {
    // Never block an order on a calendar failure.
    Logger.log('Kitchen calendar event failed: ' + error.toString());
  }
}

// ============ CAPACITY: CUSTOMER EMAILS ============

function escapeHtml(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function bistroEmailWrap(innerHtml) {
  return '<div style="font-family: Helvetica Neue, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #F9F5F0;">' +
    '<div style="background: #2C3E50; padding: 30px; text-align: center;">' +
      '<h1 style="color: white; margin: 0; font-size: 24px;">Bistro Cloud</h1>' +
      '<p style="color: #bdc3c7; margin: 5px 0 0; font-size: 14px;">Fresh. Natural. Delivered Daily.</p>' +
    '</div>' +
    '<div style="padding: 30px; background: white;">' + innerHtml + '</div>' +
    '<div style="padding: 20px 30px; text-align: center; border-top: 1px solid #eee;">' +
      '<p style="color: #999; font-size: 12px; margin: 0;">Bistro Cloud El Gouna - 100% Natural Ingredients - Free Delivery<br>' +
        '<a href="https://bistro-cloud.com" style="color: #D94E28; text-decoration: none;">bistro-cloud.com</a></p>' +
    '</div>' +
  '</div>';
}

/** orderInfo: { name, email, orderSummary, orderTotal, deliverySlot, trackingToken } */
function sendOrderConfirmationEmail(orderInfo) {
  try {
    if (!orderInfo.email) return;
    var slotLabel = slotLabel12h(orderInfo.deliverySlot);
    var inner = '<h2 style="color: #2C3E50; margin-top: 0;">Order confirmed, ' + escapeHtml(orderInfo.name) + '!</h2>' +
      '<p style="color: #555; line-height: 1.6;">Your delivery is scheduled for <strong>today at ' + slotLabel + '</strong>.</p>' +
      '<div style="background: #F9F5F0; border-radius: 12px; padding: 20px; margin: 20px 0;">' +
        '<p style="color: #333; margin: 0; white-space: pre-line;">' + escapeHtml(orderInfo.orderSummary) + '</p>' +
        '<p style="color: #2C3E50; font-weight: bold; margin: 10px 0 0;">Total: ' + escapeHtml(orderInfo.orderTotal) + ' EGP</p>' +
      '</div>';
    if (orderInfo.paymentLabel) {
      inner += '<p style="color: #555; line-height: 1.6; margin: 12px 0;">Payment: <strong>' + escapeHtml(orderInfo.paymentLabel) + '</strong></p>';
    }
    if (orderInfo.paymentMethod === 'instapay' && orderInfo.instapayDetails) {
      inner += '<div style="background:#F9F5F0;border-radius:12px;padding:16px;margin:12px 0;">' +
        '<strong>To pay via Instapay, transfer the total to:</strong><br>' +
        '<span style="white-space:pre-line;">' + escapeHtml(orderInfo.instapayDetails) + '</span><br>' +
        '<span style="color:#888;">Please transfer the total before your delivery window.</span>' +
        '</div>';
    }
    if (orderInfo.paymentMethod === 'instapay' && !orderInfo.instapayDetails) {
      Logger.log('WARNING: Instapay order confirmation email sent without bank details (instapayDetails is empty)');
    }
    inner += '<div style="text-align: center; margin: 25px 0;">' +
      '<a href="' + orderTrackingUrl(orderInfo.trackingToken) + '" style="display: inline-block; background: #D94E28; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold;">Track your order</a>' +
    '</div>';
    MailApp.sendEmail({
      to: orderInfo.email,
      subject: 'Bistro Cloud — order confirmed for ' + slotLabel,
      htmlBody: bistroEmailWrap(inner),
      name: 'Bistro Cloud El Gouna',
      replyTo: NOTIFICATION_EMAIL,
    });
  } catch (error) {
    Logger.log('Confirmation email failed: ' + error.toString());
  }
}

/** orderInfo: { name, email, deliverySlot }, openSlotLabels: array of 'h:mm AM/PM' */
function sendOrderDeclineEmail(orderInfo, openSlotLabels) {
  try {
    if (!orderInfo.email) return;
    var alternatives = (openSlotLabels && openSlotLabels.length)
      ? '<p style="color: #555; line-height: 1.6;">These times are still available today: <strong>' + openSlotLabels.join(', ') + '</strong>. Place a new order on <a href="https://bistro-cloud.com/menu" style="color: #D94E28;">bistro-cloud.com</a> or WhatsApp us.</p>'
      : '<p style="color: #555; line-height: 1.6;">Unfortunately no more delivery times are available today. We would love to serve you tomorrow!</p>';
    var slotPhrase = /^\d{1,2}:\d{2}$/.test(String(orderInfo.deliverySlot))
      ? ' at <strong>' + slotLabel12h(orderInfo.deliverySlot) + '</strong>'
      : '';
    var inner = '<h2 style="color: #2C3E50; margin-top: 0;">About your order, ' + escapeHtml(orderInfo.name) + '</h2>' +
      '<p style="color: #555; line-height: 1.6;">We\'re sorry — the kitchen is fully booked' + slotPhrase + ' and we couldn\'t fit your order in.</p>' +
      alternatives +
      '<div style="text-align: center; margin: 25px 0;">' +
        '<a href="https://wa.me/201221288804" style="display: inline-block; background: #D94E28; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold;">Chat on WhatsApp</a>' +
      '</div>';
    MailApp.sendEmail({
      to: orderInfo.email,
      subject: 'Bistro Cloud — we couldn\'t fit your order in today',
      htmlBody: bistroEmailWrap(inner),
      name: 'Bistro Cloud El Gouna',
      replyTo: NOTIFICATION_EMAIL,
    });
  } catch (error) {
    Logger.log('Decline email failed: ' + error.toString());
  }
}

// ============ CAPACITY: STATUS UPDATE EMAILS ============

var STATUS_EMAIL_COPY = {
  preparing: {
    subject: 'Your Bistro Cloud order is being prepared',
    heading: 'The kitchen is on it!',
    body: 'Your order is being freshly prepared right now.',
  },
  out_for_delivery: {
    subject: 'Your Bistro Cloud order is out for delivery',
    heading: 'On the way!',
    body: 'Your order has left the kitchen and is on its way to you.',
  },
  delivered: {
    subject: 'Your Bistro Cloud order has been delivered',
    heading: 'Enjoy your meal!',
    body: 'Your order has been delivered. Thank you for ordering with Bistro Cloud!',
  },
};

/** orderInfo: { name, email, deliverySlot, trackingToken }, status: key of STATUS_EMAIL_COPY */
function sendStatusUpdateEmail(orderInfo, status) {
  try {
    if (!orderInfo.email) return;
    var copy = STATUS_EMAIL_COPY[status];
    if (!copy) return;
    var inner = '<h2 style="color: #2C3E50; margin-top: 0;">' + copy.heading + '</h2>' +
      '<p style="color: #555; line-height: 1.6;">' + copy.body + '</p>' +
      '<p style="color: #555; line-height: 1.6;">Scheduled time: <strong>' + slotLabel12h(orderInfo.deliverySlot) + '</strong></p>' +
      '<div style="text-align: center; margin: 25px 0;">' +
        '<a href="' + orderTrackingUrl(orderInfo.trackingToken) + '" style="display: inline-block; background: #D94E28; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold;">Track your order</a>' +
      '</div>';
    MailApp.sendEmail({
      to: orderInfo.email,
      subject: copy.subject,
      htmlBody: bistroEmailWrap(inner),
      name: 'Bistro Cloud El Gouna',
      replyTo: NOTIFICATION_EMAIL,
    });
  } catch (error) {
    Logger.log('Status email failed: ' + error.toString());
  }
}

function orderTrackingUrl(token) {
  return 'https://bistro-cloud.com/track?token=' + token;
}

// ============ CAPACITY: ADMIN STATUS MANAGEMENT ============

/**
 * Admin-only. Sets the status of an Orders row and triggers side effects:
 *  pending_approval → confirmed : kitchen calendar event + confirmation email
 *  → declined                  : decline email with open alternatives
 * Phase 2 adds status-update emails for preparing/out_for_delivery/delivered.
 */
function orderSetStatus(rowIndex, newStatus, orderId) {
  if (ORDER_STATUSES.indexOf(newStatus) < 0) throw new Error('Invalid status: ' + newStatus);
  var sheet = crmGetSheet('Orders');
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var statusCol = headers.indexOf('status');
  if (statusCol < 0) throw new Error('Status column not found');
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);

  var rowVals = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var row = {};
  for (var j = 0; j < headers.length; j++) row[headers[j]] = rowVals[j];
  var prevStatus = String(row.status);

  if (orderId !== undefined && orderId !== null && String(orderId) !== '' && String(row.id) !== String(orderId)) {
    throw new Error('Order mismatch — the list is stale. Refresh and try again.');
  }

  sheet.getRange(rowIndex, statusCol + 1).setValue(newStatus);

  var orderInfo = {
    name: String(row.name || ''),
    phone: String(row.phone || ''),
    email: String(row.email || ''),
    address: String(row.address || ''),
    orderTotal: row.order_total || '',
    orderSummary: String(row.order_summary || ''),
    itemCount: Number(row.item_count) > 0 ? Number(row.item_count) : 1,
    deliveryDate: normalizeDateString(row.delivery_date),
    deliverySlot: normalizeSlotString(row.delivery_slot),
    trackingToken: String(row.tracking_token || ''),
  };

  if (newStatus === 'confirmed' && prevStatus === 'pending_approval') {
    createKitchenEvent(orderInfo);
    sendOrderConfirmationEmail(orderInfo);
    updatePipelineForOrder(row.id, 'Won', 'Completed');
  } else if (newStatus === 'declined') {
    if (prevStatus !== 'declined') {
      var avail = orderGetAvailability().availability;
      var openLabels = [];
      for (var s = 0; s < avail.slots.length; s++) {
        if (avail.slots[s].status === 'open') openLabels.push(slotLabel12h(avail.slots[s].time));
      }
      sendOrderDeclineEmail(orderInfo, openLabels);
    }
    updatePipelineForOrder(row.id, 'Lost', 'Closed');
  } else if (newStatus === 'cancelled') {
    updatePipelineForOrder(row.id, 'Lost', 'Closed');
  } else if (newStatus === 'preparing' || newStatus === 'out_for_delivery' || newStatus === 'delivered') {
    sendStatusUpdateEmail(orderInfo, newStatus);
  }

  invalidateAvailabilityCache();
  // previousStatus lets callers (the Telegram webhook) detect the genuine
  // pending_approval -> confirmed transition and avoid re-running one-time side
  // effects (e.g. the Loyverse receipt push) on a re-tap or webhook redelivery.
  return { success: true, status: newStatus, previousStatus: prevStatus };
}

/**
 * Token-keyed wrapper around orderSetStatus, for callers (the Telegram
 * webhook) that know the order's tracking_token but not its sheet row index
 * (row indices shift when rows are deleted). Looks up the row by
 * tracking_token, then applies the existing orderSetStatus logic + side
 * effects (confirm/decline/status emails, kitchen calendar, Pipeline sync,
 * cache invalidation, the order-id stale guard).
 */
function orderSetStatusByToken(token, newStatus) {
  if (!token) throw new Error('Missing token');
  var sheet = crmGetSheet('Orders');
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) throw new Error('No orders');
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var tokCol = headers.indexOf('tracking_token');
  var idCol = headers.indexOf('id');
  if (tokCol < 0) throw new Error('tracking_token column not found');
  var tokens = sheet.getRange(2, tokCol + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < tokens.length; i++) {
    if (String(tokens[i][0]) === String(token)) {
      var rowIndex = i + 2;
      var orderId = idCol >= 0 ? sheet.getRange(rowIndex, idCol + 1).getValue() : undefined;
      return orderSetStatus(rowIndex, newStatus, orderId);
    }
  }
  return { success: false, error: 'Order not found' };
}

// Keep the Pipeline tab roughly in sync with order status changes.
function updatePipelineForOrder(orderId, stage, status) {
  try {
    var sheet = crmGetSheet('Pipeline');
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol === 0) return;
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
      return String(h).trim().toLowerCase().replace(/ /g, '_');
    });
    var idCol = headers.indexOf('id');
    var stageCol = headers.indexOf('stage');
    var statusCol = headers.indexOf('status');
    if (idCol < 0) return;
    var ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(orderId)) {
        if (stageCol >= 0) sheet.getRange(i + 2, stageCol + 1).setValue(stage);
        if (statusCol >= 0) sheet.getRange(i + 2, statusCol + 1).setValue(status);
        return;
      }
    }
  } catch (e) {
    Logger.log('Pipeline sync failed: ' + e);
  }
}

// ── CRM helper: get a tab from the CRM sheet (auto-creates if missing) ──
function crmGetSheet(tabName) {
  if (!CRM_SHEET_ID) throw new Error('CRM_SHEET_ID not set');
  var ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    // Auto-create the tab with headers
    var headers = CRM_TABS[tabName];
    if (!headers) throw new Error('Unknown CRM tab: ' + tabName);
    sheet = ss.insertSheet(tabName);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    for (var i = 1; i <= headers.length; i++) {
      sheet.setColumnWidth(i, 140);
    }
    // Delete default Sheet1 if empty
    var defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet && ss.getSheets().length > 1) {
      try { if (defaultSheet.getLastRow() <= 1) ss.deleteSheet(defaultSheet); } catch (_) {}
    }
    Logger.log('Auto-created CRM tab: ' + tabName);
  }
  return sheet;
}

// ── CRM helper: header-based append row ──
function crmAppendRow(tabName, data) {
  var sheet = crmGetSheet(tabName);
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) throw new Error('Tab "' + tabName + '" has no headers — run setupCRM()');
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var newRow = headers.map(function(h) {
    return data[h] !== undefined ? data[h] : '';
  });
  sheet.appendRow(newRow);
}

// ── CRM helper: read all rows from a tab ──
function crmReadRows(tabName) {
  var sheet = crmGetSheet(tabName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) return [];
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var items = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (row.every(function(c) { return String(c).trim() === ''; })) continue;
    var item = { _rowIndex: i + 2 };
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      var h = headers[j];
      if (h === 'id' || h === 'order_total' || h === 'guest_count' || h === 'value') {
        item[h] = val === '' ? '' : (isNaN(Number(val)) ? String(val) : Number(val));
      } else if (h === 'delivery_slot') {
        item[h] = normalizeSlotString(val);
      } else if (h === 'delivery_date') {
        item[h] = normalizeDateString(val);
      } else {
        item[h] = val !== undefined ? String(val) : '';
      }
    }
    items.push(item);
  }
  return items;
}

// ── CRM Edit / Delete ──

function crmEditRow(tabName, rowIndex, itemStr) {
  var allowed = ['Catering', 'Orders', 'Contacts', 'Pipeline'];
  if (allowed.indexOf(tabName) < 0) throw new Error('Invalid CRM tab: ' + tabName);
  var sheet = crmGetSheet(tabName);
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var item = JSON.parse(itemStr);
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);
  for (var j = 0; j < headers.length; j++) {
    var h = headers[j];
    if (h === 'id' || h === 'timestamp') continue; // never overwrite id or timestamp
    if (item.hasOwnProperty(h)) sheet.getRange(rowIndex, j + 1).setValue(item[h]);
  }
  return { success: true };
}

function crmDeleteRow(tabName, rowIndex) {
  var allowed = ['Catering', 'Orders', 'Contacts', 'Pipeline'];
  if (allowed.indexOf(tabName) < 0) throw new Error('Invalid CRM tab: ' + tabName);
  var sheet = crmGetSheet(tabName);
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);
  sheet.deleteRow(rowIndex);
  return { success: true };
}

// ── Write functions ──

function addCateringInquiry(data, timestamp) {
  var id = Date.now();
  var ts = timestamp || new Date().toISOString();

  // Write to Catering tab
  crmAppendRow('Catering', {
    id: id,
    timestamp: ts,
    name: data.name || '',
    company: data.company || '',
    email: data.email || '',
    phone: data.phone || '',
    event_type: data.eventType || '',
    guest_count: data.guestCount || '',
    event_date: data.eventDate || '',
    location: data.location || '',
    menu_preferences: data.menuPreferences || '',
    status: 'New',
    notes: '',
  });

  // Write to Pipeline tab
  var dealName = (data.eventType || 'Catering') + ' — ' + (data.name || 'Unknown');
  crmAppendRow('Pipeline', {
    id: id,
    timestamp: ts,
    type: 'catering',
    deal_name: dealName,
    contact_name: data.name || '',
    company: data.company || '',
    email: data.email || '',
    stage: 'Inquiry',
    value: '',
    event_date: data.eventDate || '',
    guest_count: data.guestCount || '',
    location: data.location || '',
    status: 'Open',
    notes: '',
  });
}

function addContactSubmission(data, timestamp) {
  crmAppendRow('Contacts', {
    id: Date.now(),
    timestamp: timestamp || new Date().toISOString(),
    name: data.name || '',
    email: data.email || '',
    phone: data.phone || '',
    message: data.message || '',
    status: 'New',
  });
}

function addOrderSubmission(data, timestamp) {
  var id = Date.now();
  var ts = timestamp || new Date().toISOString();

  // Write to Orders tab
  crmAppendRow('Orders', {
    id: id,
    timestamp: ts,
    name: data.name || '',
    phone: data.phone || '',
    delivery_area: data.deliveryArea || '',
    address: data.address || '',
    order_total: data.orderTotal || '',
    order_summary: data.orderSummary || '',
    status: 'New',
    notes: '',
  });

  // Write to Pipeline tab
  crmAppendRow('Pipeline', {
    id: id,
    timestamp: ts,
    type: 'order',
    deal_name: 'Order — ' + (data.name || 'Unknown'),
    contact_name: data.name || '',
    company: '',
    email: '',
    stage: 'Won',
    value: data.orderTotal || '',
    event_date: ts.split('T')[0],
    guest_count: '1',
    location: data.deliveryArea || data.address || '',
    status: 'Completed',
    notes: data.orderSummary || '',
  });
}

// ============ EMAIL NOTIFICATIONS ============

function sendCateringConfirmationEmail(data) {
  try {
    if (!data.email) return;

    const subject = 'Bistro Cloud - We received your catering request!';

    const htmlBody = '<div style="font-family: Helvetica Neue, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #F9F5F0; padding: 0;">' +
      '<div style="background: #2C3E50; padding: 30px; text-align: center;">' +
        '<h1 style="color: white; margin: 0; font-size: 24px;">Bistro Cloud</h1>' +
        '<p style="color: #bdc3c7; margin: 5px 0 0; font-size: 14px;">Fresh. Natural. Delivered Daily.</p>' +
      '</div>' +
      '<div style="padding: 30px; background: white;">' +
        '<h2 style="color: #2C3E50; margin-top: 0;">Thank you, ' + (data.name || 'there') + '!</h2>' +
        '<p style="color: #555; line-height: 1.6;">We have received your catering inquiry and our team is already working on crafting the perfect menu for your event. We will get back to you within <strong>24 hours</strong> with a detailed proposal.</p>' +
        '<div style="background: #F9F5F0; border-radius: 12px; padding: 20px; margin: 20px 0;">' +
          '<h3 style="color: #2C3E50; margin-top: 0; font-size: 16px;">Your Request Details:</h3>' +
          '<table style="width: 100%; border-collapse: collapse; font-size: 14px;">' +
            '<tr><td style="padding: 8px 0; color: #888; width: 140px;">Event Type</td><td style="padding: 8px 0; color: #333; font-weight: 500;">' + (data.eventType || '-') + '</td></tr>' +
            '<tr><td style="padding: 8px 0; color: #888;">Guests</td><td style="padding: 8px 0; color: #333; font-weight: 500;">' + (data.guestCount || '-') + '</td></tr>' +
            '<tr><td style="padding: 8px 0; color: #888;">Event Date</td><td style="padding: 8px 0; color: #333; font-weight: 500;">' + (data.eventDate || '-') + '</td></tr>' +
            '<tr><td style="padding: 8px 0; color: #888;">Location</td><td style="padding: 8px 0; color: #333; font-weight: 500;">' + (data.location || '-') + '</td></tr>' +
            (data.company ? '<tr><td style="padding: 8px 0; color: #888;">Company</td><td style="padding: 8px 0; color: #333; font-weight: 500;">' + data.company + '</td></tr>' : '') +
            (data.menuPreferences ? '<tr><td style="padding: 8px 0; color: #888;">Preferences</td><td style="padding: 8px 0; color: #333; font-weight: 500;">' + data.menuPreferences + '</td></tr>' : '') +
          '</table>' +
        '</div>' +
        '<p style="color: #555; line-height: 1.6;">In the meantime, feel free to reach out to us directly:</p>' +
        '<div style="text-align: center; margin: 25px 0;">' +
          '<a href="https://wa.me/201221288839" style="display: inline-block; background: #D94E28; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 15px;">Chat on WhatsApp</a>' +
        '</div>' +
      '</div>' +
      '<div style="padding: 20px 30px; text-align: center; border-top: 1px solid #eee;">' +
        '<p style="color: #999; font-size: 12px; margin: 0;">Bistro Cloud El Gouna - 100% Natural Ingredients - Free Delivery<br>' +
          '<a href="https://bistro-cloud.com" style="color: #D94E28; text-decoration: none;">bistro-cloud.com</a> - ' +
          '<a href="tel:+201221288839" style="color: #D94E28; text-decoration: none;">+20 122 128 8839</a>' +
        '</p>' +
      '</div>' +
    '</div>';

    MailApp.sendEmail({
      to: data.email,
      subject: subject,
      htmlBody: htmlBody,
      name: 'Bistro Cloud El Gouna',
      replyTo: 'bistrocloud3@gmail.com'
    });

    Logger.log('Confirmation email sent to: ' + data.email);
  } catch (error) {
    Logger.log('Error sending confirmation email: ' + error.toString());
  }
}

function sendInternalNotification(data, formType) {
  try {
    const typeLabel = {
      'catering_inquiry': 'New Catering Inquiry',
      'contact': 'New Contact Form Submission',
      'order': 'New Online Order'
    }[formType] || 'New Form Submission';

    const subject = typeLabel + ' - ' + (data.name || 'Unknown');

    var details = '';
    for (var key in data) {
      if (data[key]) {
        details += '<tr><td style="padding: 5px 10px; color: #888; font-size: 13px;">' + escapeHtml(key) + '</td><td style="padding: 5px 10px; color: #333; font-size: 13px;">' + escapeHtml(data[key]) + '</td></tr>';
      }
    }

    const htmlBody = '<div style="font-family: Arial, sans-serif; max-width: 500px;">' +
      '<h2 style="color: #D94E28; margin-bottom: 5px;">' + typeLabel + '</h2>' +
      '<p style="color: #888; margin-top: 0;">From bistro-cloud.com at ' + new Date().toLocaleString('en-EG', { timeZone: 'Africa/Cairo' }) + '</p>' +
      '<table style="width: 100%; border-collapse: collapse; background: #f9f9f9; border-radius: 8px;">' + details + '</table>' +
      '<p style="margin-top: 15px;"><a href="https://docs.google.com/spreadsheets/d/' + (CRM_SHEET_ID || OLD_SPREADSHEET_ID) + '" style="color: #D94E28;">Open CRM Sheet</a></p>' +
    '</div>';

    MailApp.sendEmail({
      to: NOTIFICATION_EMAIL,
      subject: subject,
      htmlBody: htmlBody,
      name: 'Bistro Cloud Website'
    });
  } catch (error) {
    Logger.log('Error sending internal notification: ' + error.toString());
  }
}

// ============ INVENTORY SYSTEM ============
// Sheet ID — user creates a Google Sheet called "Bistro Inventory"
// with tabs: Stock, Recipes, Requisitions and pastes this ID below.
var INVENTORY_SHEET_ID = '1PCTv4q_Gex7a6H9TQAShEN9JnJmJpypuAWatPGemhVA';

function invGetSheet(tabName) {
  var ss = SpreadsheetApp.openById(INVENTORY_SHEET_ID);
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Tab "' + tabName + '" not found in Bistro Inventory sheet');
  return sheet;
}

function invReadRows(tabName) {
  var sheet = invGetSheet(tabName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol === 0) return { sheet: sheet, headers: [], rows: [] };
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var items = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (row.every(function(c) { return String(c).trim() === ''; })) continue;
    var item = { _rowIndex: i + 2 };
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      var h = headers[j];
      if (h === 'id' || h === 'qty_on_hand' || h === 'min_level' || h === 'cost_per_unit' || h === 'qty_needed' || h === 'quantity') {
        item[h] = val === '' ? 0 : (isNaN(Number(val)) ? val : Number(val));
      } else {
        item[h] = val !== undefined ? String(val) : '';
      }
    }
    items.push(item);
  }
  return { sheet: sheet, headers: headers, rows: items };
}

// ── Inventory CRUD ──

function inventoryGetAll() {
  var result = invReadRows('Stock');
  return { success: true, items: result.rows };
}

function inventoryAdd(itemStr) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = invGetSheet('Stock');
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) {
      return String(h).trim().toLowerCase().replace(/ /g, '_');
    });
    var item = JSON.parse(itemStr);
    if (!item.id) item.id = Date.now();
    item.last_restocked = new Date().toISOString().split('T')[0];
    var newRow = headers.map(function(h) { return item[h] !== undefined ? item[h] : ''; });
    sheet.appendRow(newRow);
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function inventoryEdit(rowIndex, itemStr) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = invGetSheet('Stock');
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) {
      return String(h).trim().toLowerCase().replace(/ /g, '_');
    });
    var item = JSON.parse(itemStr);
    if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);
    for (var j = 0; j < headers.length; j++) {
      var h = headers[j];
      if (h === 'id') continue;
      if (item.hasOwnProperty(h)) sheet.getRange(rowIndex, j + 1).setValue(item[h]);
    }
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

function inventoryDelete(rowIndex) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = invGetSheet('Stock');
    if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);
    sheet.deleteRow(rowIndex);
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

// ── Recipe CRUD ──

function recipeGetAll() {
  var result = invReadRows('Recipes');
  return { success: true, items: result.rows };
}

function recipeAdd(itemStr) {
  var sheet = invGetSheet('Recipes');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var item = JSON.parse(itemStr);
  if (!item.id) item.id = Date.now();
  var newRow = headers.map(function(h) { return item[h] !== undefined ? item[h] : ''; });
  sheet.appendRow(newRow);
  return { success: true };
}

function recipeEdit(rowIndex, itemStr) {
  var sheet = invGetSheet('Recipes');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var item = JSON.parse(itemStr);
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);
  for (var j = 0; j < headers.length; j++) {
    var h = headers[j];
    if (h === 'id') continue;
    if (item.hasOwnProperty(h)) sheet.getRange(rowIndex, j + 1).setValue(item[h]);
  }
  return { success: true };
}

function recipeDelete(rowIndex) {
  var sheet = invGetSheet('Recipes');
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);
  sheet.deleteRow(rowIndex);
  return { success: true };
}

// ── Requisitions CRUD ──

function requisitionGetAll() {
  var result = invReadRows('Requisitions');
  // Return newest first
  result.rows.reverse();
  return { success: true, items: result.rows };
}

function requisitionAdd(itemStr) {
  var sheet = invGetSheet('Requisitions');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var item = JSON.parse(itemStr);
  var newRow = headers.map(function(h) { return item[h] !== undefined ? item[h] : ''; });
  sheet.appendRow(newRow);
  return { success: true };
}

function requisitionEdit(rowIndex, itemStr) {
  var sheet = invGetSheet('Requisitions');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  var item = JSON.parse(itemStr);
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);
  for (var j = 0; j < headers.length; j++) {
    var h = headers[j];
    if (item.hasOwnProperty(h)) sheet.getRange(rowIndex, j + 1).setValue(item[h]);
  }
  return { success: true };
}

function requisitionDelete(rowIndex) {
  var sheet = invGetSheet('Requisitions');
  if (rowIndex < 2 || rowIndex > sheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);
  sheet.deleteRow(rowIndex);
  return { success: true };
}

/**
 * Approve a pending requisition: deduct from stock + set status to Approved.
 */
function requisitionApprove(rowIndex) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var reqSheet = invGetSheet('Requisitions');
    var reqHeaders = reqSheet.getRange(1, 1, 1, reqSheet.getLastColumn()).getValues()[0].map(function(h) {
      return String(h).trim().toLowerCase().replace(/ /g, '_');
    });
    if (rowIndex < 2 || rowIndex > reqSheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);

    var statusCol = -1, itemNameCol = -1, qtyCol = -1, dirCol = -1;
    for (var i = 0; i < reqHeaders.length; i++) {
      var h = reqHeaders[i];
      if (h === 'status') statusCol = i;
      else if (h === 'item_name' || h === 'item name') itemNameCol = i;
      else if (h === 'quantity' || h === 'qty') qtyCol = i;
      else if (h === 'direction' || h === 'dir') dirCol = i;
    }
    if (itemNameCol < 0 || qtyCol < 0) throw new Error('Required columns not found. Headers: ' + JSON.stringify(reqHeaders));
    // If no status column exists, create it
    if (statusCol < 0) {
      statusCol = reqSheet.getLastColumn();
      reqSheet.getRange(1, statusCol + 1).setValue('status');
    }

    // Check it's still pending or empty (not already approved)
    if (statusCol >= 0) {
      var currentStatus = String(reqSheet.getRange(rowIndex, statusCol + 1).getValue()).trim();
      if (currentStatus === 'Approved') throw new Error('Already approved');
    }

    var itemName = String(reqSheet.getRange(rowIndex, itemNameCol + 1).getValue());
    var quantity = Number(reqSheet.getRange(rowIndex, qtyCol + 1).getValue()) || 0;
    var direction = String(reqSheet.getRange(rowIndex, dirCol + 1).getValue()).trim();

    // Deduct from stock (only for OUT direction)
    if (direction === 'OUT' && quantity > 0) {
      var stockSheet = invGetSheet('Stock');
      var stockHeaders = stockSheet.getRange(1, 1, 1, stockSheet.getLastColumn()).getValues()[0].map(function(h) {
        return String(h).trim().toLowerCase().replace(/ /g, '_');
      });
      var stockNameCol = stockHeaders.indexOf('name');
      var stockQtyCol = stockHeaders.indexOf('qty_on_hand');
      if (stockNameCol < 0 || stockQtyCol < 0) throw new Error('Required columns not found in Stock tab');

      var found = false;
      var lastRow = stockSheet.getLastRow();
      for (var r = 2; r <= lastRow; r++) {
        var stockName = String(stockSheet.getRange(r, stockNameCol + 1).getValue());
        if (stockName.toLowerCase() === itemName.toLowerCase()) {
          var currentQty = Number(stockSheet.getRange(r, stockQtyCol + 1).getValue()) || 0;
          var newQty = Math.max(0, currentQty - quantity);
          stockSheet.getRange(r, stockQtyCol + 1).setValue(newQty);
          found = true;
          break;
        }
      }
      if (!found) {
        if (statusCol >= 0) reqSheet.getRange(rowIndex, statusCol + 1).setValue('Approved');
        return { success: true, warning: 'Stock item "' + itemName + '" not found — approved without deduction' };
      }
    }

    if (statusCol >= 0) reqSheet.getRange(rowIndex, statusCol + 1).setValue('Approved');
    return { success: true };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Reject a pending requisition: set status to Rejected, no stock change.
 */
function reqFindStatusCol(sheet, headers) {
  var col = headers.indexOf('status');
  if (col < 0) {
    col = sheet.getLastColumn();
    sheet.getRange(1, col + 1).setValue('status');
  }
  return col;
}

function requisitionReject(rowIndex) {
  var reqSheet = invGetSheet('Requisitions');
  var reqHeaders = reqSheet.getRange(1, 1, 1, reqSheet.getLastColumn()).getValues()[0].map(function(h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  if (rowIndex < 2 || rowIndex > reqSheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);

  var statusCol = reqFindStatusCol(reqSheet, reqHeaders);
  reqSheet.getRange(rowIndex, statusCol + 1).setValue('Rejected');
  return { success: true };
}

function requisitionOutOfStock(rowIndex) {
  var reqSheet = invGetSheet('Requisitions');
  var reqHeaders = reqSheet.getRange(1, 1, 1, reqSheet.getLastColumn()).getValues()[0].map(function(h) {
    return String(h).trim().toLowerCase().replace(/ /g, '_');
  });
  if (rowIndex < 2 || rowIndex > reqSheet.getLastRow()) throw new Error('Invalid row: ' + rowIndex);

  var statusCol = reqFindStatusCol(reqSheet, reqHeaders);
  reqSheet.getRange(rowIndex, statusCol + 1).setValue('Out of Stock');
  return { success: true };
}

// ============ TEST FUNCTIONS ============

/** Test the new CRM setup — run this after setupCRM() */
function testCRM() {
  // Test catering inquiry
  addCateringInquiry({
    name: 'Test Client',
    company: 'Test Co',
    email: 'test@test.com',
    phone: '+20123456789',
    eventType: 'Wedding',
    guestCount: '50',
    eventDate: '2026-05-01',
    location: 'El Gouna Marina',
    menuPreferences: 'Mediterranean seafood'
  }, new Date().toISOString());
  Logger.log('✓ Catering inquiry added');

  // Test order
  addOrderSubmission({
    name: 'Test Customer',
    phone: '+20111222333',
    deliveryArea: 'Downtown',
    address: '123 Test St',
    orderTotal: 450,
    orderSummary: '2x Grilled Chicken, 1x Caesar Salad'
  }, new Date().toISOString());
  Logger.log('✓ Order added');

  // Test contact form
  addContactSubmission({
    name: 'Test Person',
    email: 'person@test.com',
    phone: '+20999888777',
    message: 'I have a question about your catering menu'
  }, new Date().toISOString());
  Logger.log('✓ Contact form added');

  // Verify reads
  var catering = crmReadRows('Catering');
  var orders = crmReadRows('Orders');
  var contacts = crmReadRows('Contacts');
  var pipeline = crmReadRows('Pipeline');
  Logger.log('Catering rows: ' + catering.length);
  Logger.log('Orders rows: ' + orders.length);
  Logger.log('Contacts rows: ' + contacts.length);
  Logger.log('Pipeline rows: ' + pipeline.length);
  Logger.log('CRM test complete!');
}
