import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// capacity.gs is plain script (Apps Script style, no exports) — load it
// into a Function scope and return its public names.
function loadCapacity() {
  const code = readFileSync(new URL('../apps-script/capacity.gs', import.meta.url), 'utf8');
  const factory = new Function(`${code}
    return { CAPACITY_DEFAULTS, parseCapacitySettings, slotToMinutes, minutesToSlot,
             slotLabel12h, countCapacityByHour, computeAvailability, decideOrderOutcome };
  `);
  return factory();
}

const cap = loadCapacity();

const SETTINGS = {
  maxOrdersPerHour: 4,
  maxItemsPerHour: 6,
  openHour: 14,
  closeHour: 20,
  leadTimeMins: 30,
  blackoutDates: '',
  paused: false,
};

const DATE = '2026-06-12';

function order(slot: string, items = 1, status = 'confirmed', date = DATE) {
  return { delivery_date: date, delivery_slot: slot, item_count: items, status };
}

describe('parseCapacitySettings', () => {
  it('returns defaults for empty rows', () => {
    expect(cap.parseCapacitySettings([])).toEqual(SETTINGS);
  });

  it('applies overrides and parses paused as boolean', () => {
    const s = cap.parseCapacitySettings([
      ['maxOrdersPerHour', '6'],
      ['paused', 'TRUE'],
      ['blackoutDates', '2026-06-15, 2026-06-16'],
      ['unknownKey', '99'],
    ]);
    expect(s.maxOrdersPerHour).toBe(6);
    expect(s.paused).toBe(true);
    expect(s.blackoutDates).toBe('2026-06-15, 2026-06-16');
    expect(s.maxItemsPerHour).toBe(6); // untouched default
    expect('unknownKey' in s).toBe(false);
  });

  it('keeps defaults when capacity caps are zero/negative (spreadsheet typo guard)', () => {
    const s = cap.parseCapacitySettings([['maxOrdersPerHour', '0'], ['maxItemsPerHour', '-2']]);
    expect(s.maxOrdersPerHour).toBe(4);
    expect(s.maxItemsPerHour).toBe(6);
  });
});

describe('slot helpers', () => {
  it('converts both directions', () => {
    expect(cap.slotToMinutes('14:30')).toBe(870);
    expect(cap.minutesToSlot(870)).toBe('14:30');
    expect(cap.minutesToSlot(600)).toBe('10:00');
  });

  it('formats 12-hour labels', () => {
    expect(cap.slotLabel12h('14:30')).toBe('2:30 PM');
    expect(cap.slotLabel12h('12:00')).toBe('12:00 PM');
    expect(cap.slotLabel12h('20:00')).toBe('8:00 PM');
    expect(cap.slotLabel12h('09:30')).toBe('9:30 AM');
  });
});

describe('countCapacityByHour', () => {
  it('buckets 30-min slots into their parent hour and sums items', () => {
    const byHour = cap.countCapacityByHour(
      [order('14:00', 2), order('14:30', 3), order('15:00', 1)],
      DATE,
    );
    expect(byHour[14]).toEqual({ orders: 2, items: 5 });
    expect(byHour[15]).toEqual({ orders: 1, items: 1 });
  });

  it('ignores non-consuming statuses, other dates, and slotless legacy rows', () => {
    const byHour = cap.countCapacityByHour(
      [
        order('14:00', 2, 'pending_approval'),
        order('14:00', 2, 'declined'),
        order('14:00', 2, 'cancelled'),
        order('14:00', 2, 'confirmed', '2026-06-11'),
        { delivery_date: DATE, delivery_slot: '', item_count: 2, status: 'New' },
      ],
      DATE,
    );
    expect(byHour[14]).toBeUndefined();
  });

  it('treats missing/zero item_count as 1 item', () => {
    const byHour = cap.countCapacityByHour(
      [{ delivery_date: DATE, delivery_slot: '14:00', item_count: '', status: 'confirmed' }],
      DATE,
    );
    expect(byHour[14]).toEqual({ orders: 1, items: 1 });
  });
});

describe('computeAvailability', () => {
  it('generates all 13 slots from 14:00 to 20:00 when the day is empty', () => {
    const a = cap.computeAvailability([], SETTINGS, DATE, 600); // 10:00 AM
    expect(a.paused).toBe(false);
    expect(a.slots.length).toBe(13);
    expect(a.slots[0]).toEqual({ time: '14:00', status: 'open' });
    expect(a.slots[12]).toEqual({ time: '20:00', status: 'open' });
    expect(a.asap).toBe('14:00');
  });

  it('hides slots inside the lead-time window', () => {
    // 14:10 now + 30min lead = 14:40 → first offered slot is 15:00
    const a = cap.computeAvailability([], SETTINGS, DATE, 850);
    expect(a.slots[0].time).toBe('15:00');
  });

  it('marks an hour busy at 4 orders (orders cap)', () => {
    const orders = [order('14:00'), order('14:00'), order('14:30'), order('14:30')];
    const a = cap.computeAvailability(orders, SETTINGS, DATE, 600);
    expect(a.slots.find(s => s.time === '14:00')!.status).toBe('busy');
    expect(a.slots.find(s => s.time === '14:30')!.status).toBe('busy');
    expect(a.slots.find(s => s.time === '15:00')!.status).toBe('open');
    expect(a.asap).toBe('15:00');
  });

  it('marks an hour busy at 6 items (items cap), even with fewer orders', () => {
    const orders = [order('16:00', 4), order('16:30', 2)];
    const a = cap.computeAvailability(orders, SETTINGS, DATE, 600);
    expect(a.slots.find(s => s.time === '16:00')!.status).toBe('busy');
    expect(a.slots.find(s => s.time === '16:30')!.status).toBe('busy');
    expect(a.slots.find(s => s.time === '17:00')!.status).toBe('open');
  });

  it('pending_approval orders do not consume capacity', () => {
    const orders = [
      order('14:00', 1, 'pending_approval'),
      order('14:00', 1, 'pending_approval'),
      order('14:00', 1, 'pending_approval'),
      order('14:00', 1, 'pending_approval'),
    ];
    const a = cap.computeAvailability(orders, SETTINGS, DATE, 600);
    expect(a.slots.find(s => s.time === '14:00')!.status).toBe('open');
  });

  it('returns paused for paused setting and for blackout dates', () => {
    expect(cap.computeAvailability([], { ...SETTINGS, paused: true }, DATE, 600))
      .toEqual({ paused: true, date: DATE, slots: [], asap: null });
    const blackout = { ...SETTINGS, blackoutDates: '2026-06-12' };
    expect(cap.computeAvailability([], blackout, DATE, 600).paused).toBe(true);
  });

  it('asap is null when every remaining slot is busy', () => {
    const orders: object[] = [];
    for (let h = 14; h <= 20; h++) {
      for (let i = 0; i < 4; i++) orders.push(order(`${h}:00`));
    }
    const a = cap.computeAvailability(orders, SETTINGS, DATE, 600);
    expect(a.asap).toBeNull();
    expect(a.slots.every(s => s.status === 'busy')).toBe(true);
  });
});

describe('decideOrderOutcome', () => {
  const avail = {
    paused: false,
    date: DATE,
    slots: [
      { time: '15:00', status: 'open' },
      { time: '15:30', status: 'busy' },
    ],
    asap: '15:00',
  };

  it('confirms an open slot', () => {
    expect(cap.decideOrderOutcome(avail, '15:00', 'open')).toBe('confirmed');
  });

  it('queues a knowingly-busy slot as pending_approval', () => {
    expect(cap.decideOrderOutcome(avail, '15:30', 'busy')).toBe('pending_approval');
  });

  it('returns slot_full when the customer expected open but the slot filled (race loser)', () => {
    expect(cap.decideOrderOutcome(avail, '15:30', 'open')).toBe('slot_full');
  });

  it('returns slot_unavailable for unknown slots and paused days', () => {
    expect(cap.decideOrderOutcome(avail, '21:00', 'open')).toBe('slot_unavailable');
    expect(cap.decideOrderOutcome({ paused: true, date: DATE, slots: [], asap: null }, '15:00', 'open'))
      .toBe('slot_unavailable');
  });
});
