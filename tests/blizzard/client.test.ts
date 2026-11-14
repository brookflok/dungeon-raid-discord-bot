import { describe, expect, it } from 'vitest';
import { createBlizzardClient } from '../../src/blizzard/client.js';

const REDIRECT = 'https://bot.example/callback';
const SECRET = 'very-secret-value';

const profile = {
  id: 456728207,
  wow_accounts: [
    {
      characters: [
        {
          id: 6731918,
          name: 'Brok',
          surname: 'Flook',
          level: 1,
          playable_class: { name: 'Priest' },
          playable_race: { name: 'Human' },
          faction: { name: 'Alliance' },
        },
        {
          id: 6731919,
          name: 'Grimm',
          level: 12,
          playable_class: { name: 'Warrior' },
          playable_race: { name: 'Orc' },
          faction: { name: 'Horde' },
        },
      ],
    },
  ],
};

interface Call {
  url: string;
  init: RequestInit;
}

/** A fake fetch that answers the token request and then the profile request, recording both. */
function fakeFetch(
  profileResponse: () => Response,
  tokenResponse = () => Response.json({ access_token: 'access-123' }),
) {
  const calls: Call[] = [];
  const fetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    return Promise.resolve(
      url === 'https://oauth.battle.net/token' ? tokenResponse() : profileResponse(),
    );
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const client = (fetch: typeof globalThis.fetch) =>
  createBlizzardClient({
    clientId: 'client-1',
    clientSecret: SECRET,
    region: 'eu',
    redirectUri: REDIRECT,
    fetch,
  });

describe('authorizeUrl', () => {
  it('asks for wow.profile with the state and the redirect uri', () => {
    const url = client(fakeFetch(() => Response.json(profile)).fetch).authorizeUrl('abc');
    expect(url.startsWith('https://oauth.battle.net/authorize?')).toBe(true);
    expect(url).toContain('scope=wow.profile');
    expect(url).toContain('state=abc');
    expect(url).toContain('response_type=code');
    expect(url).toContain('client_id=client-1');
    expect(url).toContain(`redirect_uri=${encodeURIComponent(REDIRECT)}`);
  });
});

describe('fetchForeverCharacters', () => {
  it('exchanges the code with Basic auth and a form body', async () => {
    const { calls, fetch } = fakeFetch(() => Response.json(profile));
    await client(fetch).fetchForeverCharacters('code-xyz');

    const token = calls[0];
    expect(token.url).toBe('https://oauth.battle.net/token');
    expect(token.init.method).toBe('POST');
    expect(new Headers(token.init.headers).get('authorization')).toBe(
      `Basic ${Buffer.from(`client-1:${SECRET}`).toString('base64')}`,
    );
    const form = new URLSearchParams(String(token.init.body));
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('code-xyz');
    expect(form.get('redirect_uri')).toBe(REDIRECT);
    expect(token.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reads the Forever profile with the access token', async () => {
    const { calls, fetch } = fakeFetch(() => Response.json(profile));
    await client(fetch).fetchForeverCharacters('code-xyz');

    const read = calls[1];
    expect(read.url).toBe(
      'https://eu.api.blizzard.com/profile/user/wow?namespace=profile-forever-eu&locale=en_US',
    );
    expect(new Headers(read.init.headers).get('authorization')).toBe('Bearer access-123');
    expect(read.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps the recorded response', async () => {
    const { fetch } = fakeFetch(() => Response.json(profile));
    expect(await client(fetch).fetchForeverCharacters('code-xyz')).toEqual({
      battleNetId: 456728207,
      characters: [
        {
          blizzardId: 6731918,
          name: 'Brok',
          surname: 'Flook',
          className: 'Priest',
          race: 'Human',
          faction: 'Alliance',
          level: 1,
        },
        {
          blizzardId: 6731919,
          name: 'Grimm',
          className: 'Warrior',
          race: 'Orc',
          faction: 'Horde',
          level: 12,
        },
      ],
    });
  });

  it('combines characters across wow accounts', async () => {
    const second = {
      characters: [
        {
          id: 7000001,
          name: 'Lira',
          level: 30,
          playable_class: { name: 'Mage' },
          playable_race: { name: 'Gnome' },
          faction: { name: 'Alliance' },
        },
      ],
    };
    const { fetch } = fakeFetch(() =>
      Response.json({ ...profile, wow_accounts: [...profile.wow_accounts, second] }),
    );
    const { characters } = await client(fetch).fetchForeverCharacters('code-xyz');
    expect(characters.map((c) => c.blizzardId)).toEqual([6731918, 6731919, 7000001]);
  });

  it('treats a 404 profile as no characters', async () => {
    const { fetch } = fakeFetch(() => new Response('{"code":404}', { status: 404 }));
    const { characters } = await client(fetch).fetchForeverCharacters('code-xyz');
    expect(characters).toEqual([]);
  });

  it('throws with the status, never the secret or the code, when the token request fails', async () => {
    const { calls, fetch } = fakeFetch(
      () => Response.json(profile),
      () => new Response('{"error":"unauthorized"}', { status: 401 }),
    );
    const error = await client(fetch)
      .fetchForeverCharacters('code-xyz')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const message = String((error as Error).message);
    expect(message).toContain('401');
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain('code-xyz');
    expect(calls).toHaveLength(1);
  });

  it('throws with the status, never the access token, when the profile request fails', async () => {
    const { fetch } = fakeFetch(() => new Response('oops', { status: 503 }));
    const error = await client(fetch)
      .fetchForeverCharacters('code-xyz')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const message = String((error as Error).message);
    expect(message).toContain('503');
    expect(message).not.toContain('access-123');
  });
});
