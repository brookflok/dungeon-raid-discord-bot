import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlizzardClient } from '../../src/blizzard/client.js';
import type { Clock } from '../../src/core/ports.js';
import { ProfileService, type FetchedCharacter } from '../../src/core/profiles.js';
import { UserError, type Character } from '../../src/core/types.js';
import { MemoryStorage } from '../../src/storage/memory.js';
import { createWebServer } from '../../src/web/server.js';

class FakeClock implements Clock {
  constructor(private current = new Date('2026-11-14T12:00:00Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

const brok: FetchedCharacter = {
  blizzardId: 6731918,
  name: 'Brok',
  surname: 'Flook',
  className: 'Priest',
  race: 'Human',
  faction: 'Alliance',
  level: 1,
};
const grimm: FetchedCharacter = {
  blizzardId: 6731919,
  name: 'Grimm',
  className: 'Warrior',
  level: 12,
};

let storage: MemoryStorage;
let clock: FakeClock;
let profiles: ProfileService;
let fetched: { battleNetId: number; characters: FetchedCharacter[] };
let blizzard: BlizzardClient & { fetchForeverCharacters: ReturnType<typeof vi.fn> };
let onLinked: ReturnType<typeof vi.fn<(userId: string, characters: Character[]) => Promise<void>>>;
let server: Server;
let base: string;

beforeEach(async () => {
  storage = new MemoryStorage();
  clock = new FakeClock();
  profiles = new ProfileService({ storage, clock });
  fetched = { battleNetId: 456728207, characters: [brok, grimm] };
  blizzard = {
    authorizeUrl: (state) => `https://oauth.example/authorize?state=${encodeURIComponent(state)}`,
    fetchForeverCharacters: vi.fn(() => Promise.resolve(fetched)),
  };
  onLinked = vi.fn(() => Promise.resolve());
  server = createWebServer({ profiles, blizzard, onLinked });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

const get = (path: string) => fetch(`${base}${path}`, { redirect: 'manual' });
const callback = (state: string, code = 'the-code') =>
  get(`/callback?${new URLSearchParams({ code, state })}`);

function expectSafeHeaders(res: Response): void {
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
}

describe('GET /link/:token', () => {
  it('redirects to Battle.net without claiming the token', async () => {
    const { token } = await profiles.startLink('u1');
    const res = await get(`/link/${token}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(blizzard.authorizeUrl(token));
    expectSafeHeaders(res);

    expect((await callback(token)).status).toBe(200);
  });
});

describe('GET /callback', () => {
  it('stores the characters, calls onLinked once and confirms', async () => {
    const { token } = await profiles.startLink('u1');
    const res = await callback(token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expectSafeHeaders(res);
    expect(await res.text()).toContain(
      'Linked 2 characters. You can close this tab and return to Discord.',
    );

    expect(blizzard.fetchForeverCharacters).toHaveBeenCalledWith('the-code');
    const { member, characters } = await profiles.list('u1');
    expect(member?.battleNetId).toBe(456728207);
    expect(characters.map((c) => c.name).sort()).toEqual(['Brok', 'Grimm']);
    expect(onLinked).toHaveBeenCalledTimes(1);
    expect(onLinked.mock.calls[0][0]).toBe('u1');
    expect(onLinked.mock.calls[0][1].map((c) => c.name)).toEqual(['Brok', 'Grimm']);
  });

  it('refuses the same state again without calling Battle.net', async () => {
    const { token } = await profiles.startLink('u1');
    await callback(token);
    const before = await profiles.list('u1');

    const res = await callback(token, 'other-code');
    expect(res.status).toBe(400);
    expectSafeHeaders(res);
    expect(await res.text()).toMatch(/already used|expired/);
    expect(blizzard.fetchForeverCharacters).toHaveBeenCalledTimes(1);
    expect(onLinked).toHaveBeenCalledTimes(1);
    expect(await profiles.list('u1')).toEqual(before);
  });

  it('refuses an expired token', async () => {
    const { token } = await profiles.startLink('u1');
    clock.advance(10 * 60 * 1000 + 1);
    const res = await callback(token);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/expired/);
    expect(blizzard.fetchForeverCharacters).not.toHaveBeenCalled();
  });

  it('refuses a Battle.net account linked to another member', async () => {
    await profiles.completeLink('u2', 456728207, [brok]);
    const { token } = await profiles.startLink('u1');
    const res = await callback(token);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('already linked to another member');
    expect((await profiles.list('u1')).characters).toEqual([]);
    expect(onLinked).not.toHaveBeenCalled();
  });

  it('refuses an account with no Forever characters', async () => {
    fetched = { battleNetId: 456728207, characters: [] };
    const { token } = await profiles.startLink('u1');
    const res = await callback(token);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain(
      'No WoW Forever characters were found on that Battle.net account.',
    );
    expect(await profiles.list('u1')).toEqual({ member: null, characters: [] });
  });

  it('refuses a callback without a code', async () => {
    const { token } = await profiles.startLink('u1');
    const res = await get(
      `/callback?${new URLSearchParams({ state: token, error: 'access_denied' })}`,
    );
    expect(res.status).toBe(400);
    expect(blizzard.fetchForeverCharacters).not.toHaveBeenCalled();
  });

  it('escapes request input', async () => {
    const res = await callback('<script>alert(1)</script>');
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('<script>');
  });

  it('escapes the message it shows', async () => {
    blizzard.fetchForeverCharacters.mockRejectedValue(new UserError('<b>Tom & "Jerry"</b>'));
    const { token } = await profiles.startLink('u1');
    const body = await (await callback(token)).text();
    expect(body).toContain('&#60;b&#62;Tom &#38; &#34;Jerry&#34;&#60;/b&#62;');
    expect(body).not.toContain('<b>');
  });

  it('shows a generic page and never logs the code when Battle.net fails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    blizzard.fetchForeverCharacters.mockRejectedValue(
      new Error('Battle.net token request: HTTP 500'),
    );
    const { token } = await profiles.startLink('u1');
    const res = await callback(token, 'secret-code');
    expect(res.status).toBe(500);
    expectSafeHeaders(res);
    const body = await res.text();
    expect(body).toContain('Something went wrong. Please run /profile link again.');
    expect(body).not.toContain('secret-code');
    expect(logged).toHaveBeenCalled();
    expect(JSON.stringify(logged.mock.calls.map((args) => args.map(String)))).not.toContain(
      'secret-code',
    );
  });
});

describe('everything else', () => {
  it('answers 404 for other paths', async () => {
    const res = await get('/anything-else');
    expect(res.status).toBe(404);
    expectSafeHeaders(res);
  });

  it('answers only GET', async () => {
    const { token } = await profiles.startLink('u1');
    const res = await fetch(`${base}/callback?state=${token}&code=x`, { method: 'POST' });
    expect(res.status).toBe(405);
    expectSafeHeaders(res);
    expect(blizzard.fetchForeverCharacters).not.toHaveBeenCalled();
  });

  it('answers 400 for a request URL it cannot parse', async () => {
    const { port } = server.address() as AddressInfo;
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () =>
        socket.end('GET http://a:b/link/x HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n'),
      );
      let data = '';
      socket.on('data', (chunk) => (data += String(chunk)));
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
    expect(raw.startsWith('HTTP/1.1 400')).toBe(true);
    expect(raw.toLowerCase()).toContain('cache-control: no-store');
  });
});
