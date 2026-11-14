import http from 'node:http';
import type { BlizzardClient } from '../blizzard/client.js';
import type { ProfileService } from '../core/profiles.js';
import { UserError, type Character } from '../core/types.js';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
const LINK = /^\/link\/([^/]+)$/;

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>Guild bot</title></head>` +
      `<body><p>${escapeHtml(text)}</p></body></html>`,
  );
}

/**
 * Battle.net linking: `/link/:token` starts the login with the token as OAuth state, `/callback`
 * finishes it. The OAuth code and the access token are never logged or shown.
 */
export function createWebServer(deps: {
  profiles: ProfileService;
  blizzard: BlizzardClient;
  onLinked: (userId: string, characters: Character[]) => Promise<void>;
}): http.Server {
  async function callback(query: URLSearchParams, res: http.ServerResponse): Promise<void> {
    try {
      // Claim first, so a replayed callback is refused before anything is sent to Blizzard.
      const { userId } = await deps.profiles.claimLink(query.get('state') ?? '');
      const code = query.get('code');
      if (!code) {
        throw new UserError(
          'The Battle.net login was not completed. Please run /profile link again.',
        );
      }
      const { battleNetId, characters } = await deps.blizzard.fetchForeverCharacters(code);
      if (characters.length === 0) {
        throw new UserError('No WoW Forever characters were found on that Battle.net account.');
      }
      const linked = await deps.profiles.completeLink(userId, battleNetId, characters);
      await deps.onLinked(userId, linked);
      const noun = linked.length === 1 ? 'character' : 'characters';
      page(
        res,
        200,
        `Linked ${linked.length} ${noun}. You can close this tab and return to Discord.`,
      );
    } catch (err) {
      if (err instanceof UserError) {
        page(res, 400, err.message);
      } else {
        console.error('link callback failed', err);
        page(res, 500, 'Something went wrong. Please run /profile link again.');
      }
    }
  }

  return http.createServer((req, res) => {
    if (req.method !== 'GET') return page(res, 405, 'Method not allowed.');
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return page(res, 400, 'Bad request.');
    }
    const link = LINK.exec(url.pathname);
    if (link) {
      res.writeHead(302, { ...HEADERS, Location: deps.blizzard.authorizeUrl(link[1]) }).end();
    } else if (url.pathname === '/callback') {
      void callback(url.searchParams, res);
    } else {
      page(res, 404, 'Not found.');
    }
  });
}
