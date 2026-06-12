import { describe, it, expect } from 'vitest';
import { slotLabel } from '../src/services/orderService';

describe('slotLabel', () => {
  it('formats 24h slot strings as 12-hour labels', () => {
    expect(slotLabel('14:30')).toBe('2:30 PM');
    expect(slotLabel('12:00')).toBe('12:00 PM');
    expect(slotLabel('20:00')).toBe('8:00 PM');
    expect(slotLabel('09:05')).toBe('9:05 AM');
  });
});
