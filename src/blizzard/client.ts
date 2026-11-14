import type { FetchedCharacter } from '../core/profiles.js';

export interface BlizzardClient {
  authorizeUrl(state: string): string;
  fetchForeverCharacters(
    code: string,
  ): Promise<{ battleNetId: number; characters: FetchedCharacter[] }>;
}

interface ProfileResponse {
  id: number;
  wow_accounts?: {
    characters?: {
      id: number;
      name: string;
      surname?: string;
      level: number;
      playable_class: { name: string };
      playable_race?: { name: string };
      faction?: { name: string };
    }[];
  }[];
}

const TIMEOUT_MS = 10_000;

/** Battle.net login and the member's WoW Forever characters. Errors carry the HTTP status only. */
export function createBlizzardClient(cfg: {
  clientId: string;
  clientSecret: string;
  region: string;
  redirectUri: string;
  fetch?: typeof fetch;
}): BlizzardClient {
  const fetchFn = cfg.fetch ?? fetch;
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');

  return {
    authorizeUrl(state) {
      const query = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: 'code',
        scope: 'wow.profile',
        state,
      });
      return `https://oauth.battle.net/authorize?${query}`;
    },

    async fetchForeverCharacters(code) {
      const tokenRes = await fetchFn('https://oauth.battle.net/token', {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}` },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: cfg.redirectUri,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!tokenRes.ok) throw new Error(`Battle.net token request: HTTP ${tokenRes.status}`);
      // The access token is used for this one request and then dropped, never stored or logged.
      const { access_token } = (await tokenRes.json()) as { access_token: string };

      const r = cfg.region;
      const profileRes = await fetchFn(
        `https://${r}.api.blizzard.com/profile/user/wow?namespace=profile-forever-${r}&locale=en_US`,
        {
          headers: { Authorization: `Bearer ${access_token}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      // 404: the account has no Forever characters. The account id is unknown then; callers
      // refuse an empty list before using it.
      if (profileRes.status === 404) return { battleNetId: 0, characters: [] };
      if (!profileRes.ok) throw new Error(`Blizzard profile request: HTTP ${profileRes.status}`);
      const body = (await profileRes.json()) as ProfileResponse;

      const characters = (body.wow_accounts ?? [])
        .flatMap((account) => account.characters ?? [])
        .map((c): FetchedCharacter => ({
          blizzardId: c.id,
          name: c.name,
          surname: c.surname || undefined,
          className: c.playable_class.name,
          race: c.playable_race?.name,
          faction: c.faction?.name,
          level: c.level,
        }));
      return { battleNetId: body.id, characters };
    },
  };
}
