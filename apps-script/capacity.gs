/**
 * Bistro Cloud — pure capacity/slot logic.
 *
 * No Apps Script APIs in this file: everything is plain JavaScript so the
 * logic can be unit-tested in Node (see tests/capacity.test.ts). Apps Script
 * merges all project files into one global scope, so admin-api.gs calls
 * these functions directly.
 *
 * Capacity model: each 30-minute delivery slot consumes capacity from its
 * parent HOUR bucket. An hour is "busy" when it has reached
 * maxOrdersPerHour orders OR maxItemsPerHour items — whichever first.
 */

var CAPACITY_DEFAULTS = {
  maxOrdersPerHour: 4,
  maxItemsPerHour: 6,
  openHour: 14,
  closeHour: 20,
  leadTimeMins: 30,
  blackoutDates: '',
  paused: false,
};

// Statuses that hold a slot. pending_approval, declined, cancelled and
// legacy 'New' rows (which have no delivery_slot) do not consume capacity.
var CAPACITY_STATUSES = ['confirmed', 'preparing', 'out_for_delivery', 'delivered'];

var ORDER_STATUSES = ['pending_approval', 'confirmed', 'preparing', 'out_for_delivery', 'delivered', 'declined', 'cancelled'];

/** rows: [[key, value], ...] from the Settings tab → settings object with defaults. */
function parseCapacitySettings(rows) {
  var s = {};
  for (var k in CAPACITY_DEFAULTS) s[k] = CAPACITY_DEFAULTS[k];
  for (var i = 0; i < rows.length; i++) {
    var key = String(rows[i][0] || '').trim();
    var val = rows[i][1];
    if (!(key in CAPACITY_DEFAULTS) || val === '' || val === undefined || val === null) continue;
    if (key === 'blackoutDates') {
      s[key] = String(val);
    } else if (key === 'paused') {
      s[key] = val === true || String(val).toLowerCase() === 'true';
    } else {
      var n = Number(val);
      if (!isNaN(n)) s[key] = n;
    }
  }
  return s;
}

function slotToMinutes(slot) {
  var parts = String(slot).split(':');
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function minutesToSlot(minutes) {
  var h = Math.floor(minutes / 60);
  var m = minutes % 60;
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

/** '14:30' → '2:30 PM' */
function slotLabel12h(slot) {
  var total = slotToMinutes(slot);
  var h = Math.floor(total / 60);
  var m = total % 60;
  var ampm = h >= 12 ? 'PM' : 'AM';
  var hr = h % 12;
  if (hr === 0) hr = 12;
  return hr + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
}

/**
 * Count capacity-consuming orders/items per hour for a given date.
 * orders: row objects from the Orders tab (delivery_date, delivery_slot,
 * item_count, status). Returns { [hour]: { orders, items } }.
 */
function countCapacityByHour(orders, dateStr) {
  var byHour = {};
  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    if (String(o.delivery_date) !== dateStr) continue;
    if (CAPACITY_STATUSES.indexOf(String(o.status)) < 0) continue;
    var slot = String(o.delivery_slot || '');
    if (!/^\d{1,2}:\d{2}$/.test(slot)) continue; // legacy rows / corrupted values
    var hour = Math.floor(slotToMinutes(slot) / 60);
    if (!byHour[hour]) byHour[hour] = { orders: 0, items: 0 };
    byHour[hour].orders += 1;
    byHour[hour].items += Number(o.item_count) > 0 ? Number(o.item_count) : 1;
  }
  return byHour;
}

/**
 * Compute slot availability for one day.
 * dateStr: 'yyyy-MM-dd' (Cairo); nowMinutes: minutes since midnight (Cairo).
 * Returns { paused, date, slots: [{ time, status: 'open'|'busy' }], asap }.
 * Slots inside the lead-time window are omitted entirely.
 */
function computeAvailability(orders, settings, dateStr, nowMinutes) {
  var blackout = String(settings.blackoutDates).split(',').map(function (d) { return d.trim(); });
  if (settings.paused || blackout.indexOf(dateStr) >= 0) {
    return { paused: true, date: dateStr, slots: [], asap: null };
  }
  var byHour = countCapacityByHour(orders, dateStr);
  var slots = [];
  var asap = null;
  var minMinutes = nowMinutes + settings.leadTimeMins;
  for (var m = settings.openHour * 60; m <= settings.closeHour * 60; m += 30) {
    if (m <= minMinutes) continue;
    var hour = Math.floor(m / 60);
    var counts = byHour[hour] || { orders: 0, items: 0 };
    var busy = counts.orders >= settings.maxOrdersPerHour || counts.items >= settings.maxItemsPerHour;
    if (!busy && asap === null) asap = minutesToSlot(m);
    slots.push({ time: minutesToSlot(m), status: busy ? 'busy' : 'open' });
  }
  return { paused: false, date: dateStr, slots: slots, asap: asap };
}

/**
 * Decide the outcome of placing an order into a slot.
 * expectedStatus is what the customer saw in the picker ('open'|'busy').
 * Returns 'confirmed' | 'pending_approval' | 'slot_full' | 'slot_unavailable'.
 */
function decideOrderOutcome(availability, deliverySlot, expectedStatus) {
  if (availability.paused) return 'slot_unavailable';
  var slot = null;
  for (var i = 0; i < availability.slots.length; i++) {
    if (availability.slots[i].time === deliverySlot) { slot = availability.slots[i]; break; }
  }
  if (!slot) return 'slot_unavailable';
  if (slot.status === 'open') return 'confirmed';
  if (expectedStatus === 'busy') return 'pending_approval';
  return 'slot_full';
}
