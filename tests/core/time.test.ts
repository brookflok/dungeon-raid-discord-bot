import { describe, expect, it } from 'vitest';
import { parseTime } from '../../src/core/time.js';

const now = new Date('2026-11-14T12:00:00Z');
const tz = 'Europe/Berlin';

describe('parseTime', () => {
  it('parses today HH:mm in the guild timezone', () => {
    expect(parseTime('today 20:30', now, tz)).toEqual(new Date('2026-11-14T19:30:00Z'));
  });

  it('parses tomorrow case-insensitively', () => {
    expect(parseTime('Tomorrow 19:00', now, tz)).toEqual(new Date('2026-11-15T18:00:00Z'));
  });

  it('parses an ISO date and time', () => {
    expect(parseTime('2026-11-20 19:00', now, tz)).toEqual(new Date('2026-11-20T18:00:00Z'));
  });

  it('ignores extra spaces and returns past times', () => {
    expect(parseTime('  today   9:05 ', now, tz)).toEqual(new Date('2026-11-14T08:05:00Z'));
  });

  it('rejects unknown shapes and invalid dates or times', () => {
    expect(parseTime('friday evening', now, tz)).toBeNull();
    expect(parseTime('2026-02-30 19:00', now, tz)).toBeNull();
    expect(parseTime('today 25:00', now, tz)).toBeNull();
  });
});
