import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '../src/log.js';

afterEach(() => vi.restoreAllMocks());

describe('log', () => {
  it('writes info as one JSON line with level, msg, time and context', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('Web server listening', { port: 3050 });
    expect(out).toHaveBeenCalledTimes(1);
    const entry = JSON.parse(out.mock.calls[0][0] as string);
    expect(entry).toEqual({
      level: 'info',
      msg: 'Web server listening',
      time: expect.any(String),
      port: 3050,
    });
    expect(new Date(entry.time).toISOString()).toBe(entry.time);
  });

  it('writes an error in the context as its name, message and stack, on one line', () => {
    const out = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new TypeError('boom');
    log.error('Scheduled job failed', { jobId: '7', err });
    const line = out.mock.calls[0][0] as string;
    expect(line).not.toContain('\n');
    expect(JSON.parse(line)).toMatchObject({
      level: 'error',
      msg: 'Scheduled job failed',
      jobId: '7',
      err: { name: 'TypeError', message: 'boom', stack: err.stack },
    });
  });

  it('writes a message without context', () => {
    const out = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.error('Shutting down');
    expect(Object.keys(JSON.parse(out.mock.calls[0][0] as string))).toEqual([
      'level',
      'msg',
      'time',
    ]);
  });
});
