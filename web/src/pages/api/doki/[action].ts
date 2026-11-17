/**
 * ローカル版の API。本番の Worker（poker/src/index.ts）の /api/doki/* と同じ形で答える。
 * ログインは無く、いつも LOCAL_USER として遊ぶ。
 */
import type { APIRoute } from 'astro';
import { align, dokiState, miss, moveMachine, spin } from '../../../../../poker/src/doki.ts';
import { LOCAL_USER, localAvailable, localDb } from '../../../dev/localdb.ts';

export const prerender = false;

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

export const GET: APIRoute = async ({ params }) => {
  if (params.action !== 'state') return json({ error: 'not found' }, 404);
  const db = localDb();
  return json({ ...(await dokiState(db, LOCAL_USER, Date.now())), available: await localAvailable() });
};

export const POST: APIRoute = async ({ params, request }) => {
  const db = localDb();
  const body = await request.json().catch(() => ({})) as { n?: unknown; machine?: unknown };
  const now = Date.now();
  switch (params.action) {
    case 'spin': {
      const r = await spin(db, LOCAL_USER, now, localAvailable);
      return r.ok ? json({ ...r, available: await localAvailable() }) : json({ reason: r.reason }, 400);
    }
    case 'align': {
      const r = await align(db, LOCAL_USER, now);
      return r.ok ? json({ ...r, available: await localAvailable() }) : json({ reason: r.reason }, 400);
    }
    case 'miss': {
      const r = await miss(db, LOCAL_USER, Number(body.n));
      return r.ok ? json({ ...r, available: await localAvailable() }) : json({ reason: r.reason }, 400);
    }
    case 'machine': {
      const r = await moveMachine(db, LOCAL_USER, Number(body.machine), now);
      return r.ok ? json({ ...r, ...(await dokiState(db, LOCAL_USER, now)) }) : json({ reason: r.reason }, 400);
    }
  }
  return json({ error: 'not found' }, 404);
};
