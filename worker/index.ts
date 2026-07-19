import { EMPTY, mergeProgress, parseProgress } from '../shared/merge';
import { verifyAccessEmail } from './access';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN: string; // e.g. "myteam.cloudflareaccess.com"
  ACCESS_AUD: string; // the Access application's AUD tag
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function handleProgress(request: Request, env: Env): Promise<Response> {
  const email = await verifyAccessEmail(request, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
  if (!email) return json({ error: 'unauthorized' }, 401);

  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT data FROM progress WHERE user_id = ?').bind(email).first<{ data: string }>();
    return json(row ? (parseProgress(JSON.parse(row.data)) ?? EMPTY) : EMPTY);
  }

  if (request.method === 'PUT') {
    let incoming;
    try {
      incoming = parseProgress(await request.json());
    } catch {
      incoming = null;
    }
    if (!incoming) return json({ error: 'bad request' }, 400);

    const row = await env.DB.prepare('SELECT data FROM progress WHERE user_id = ?').bind(email).first<{ data: string }>();
    const existing = row ? (parseProgress(JSON.parse(row.data)) ?? EMPTY) : EMPTY;
    const merged = mergeProgress(existing, incoming);

    await env.DB.prepare(
      `INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
      .bind(email, JSON.stringify(merged), Date.now())
      .run();

    return json(merged);
  }

  return json({ error: 'method not allowed' }, 405);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/progress') return handleProgress(request, env);
    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    // everything else is the static SPA build
    return env.ASSETS.fetch(request);
  },
};
