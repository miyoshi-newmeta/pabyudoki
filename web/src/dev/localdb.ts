/**
 * ローカル用の DB。本番は Cloudflare D1 だが、ここでは Node の SQLite（node:sqlite）を同じ形（prepare / bind / first / all / run / batch）で包む。
 * データは web/.local/doki.sqlite に残る（消せば最初から）。使えるポイントは、元手 LOCAL_START_PT に今日までの収支を足したもの。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DokiDb } from '../../../poker/src/doki.ts';

export const LOCAL_USER = 'local';
export const LOCAL_START_PT = 100_000;

let raw: DatabaseSync | null = null;
function open(): DatabaseSync {
  if (raw) return raw;
  mkdirSync('.local', { recursive: true });
  raw = new DatabaseSync(join('.local', 'doki.sqlite'));
  raw.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)');
  for (const f of readdirSync('migrations').filter((x) => x.endsWith('.sql')).sort()) {
    if (raw.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(f)) continue;
    raw.exec(readFileSync(join('migrations', f), 'utf8'));
    raw.prepare('INSERT INTO _migrations (name) VALUES (?)').run(f);
  }
  return raw;
}

export function localDb(): DokiDb {
  const db = open();
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async <T>(col?: string) => {
      const r = db.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined;
      return (r ? (col ? r[col] : r) : null) as T;
    },
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
    run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return {
    prepare: (sql: string) => stmt(sql) as unknown as D1PreparedStatement,
    batch: async (list: D1PreparedStatement[]) => {
      db.exec('BEGIN');
      try { for (const s of list) await (s as unknown as { run: () => Promise<unknown> }).run(); db.exec('COMMIT'); }
      catch (e) { db.exec('ROLLBACK'); throw e; }
      return [];
    },
  };
}

/** 使えるポイント（本番は寮Pts などを足すが、ローカルは元手＋ぱびゅドキ！の収支だけ） */
export async function localAvailable(): Promise<number> {
  const db = open();
  const r = db.prepare('SELECT COALESCE(SUM(pt_net), 0) AS v FROM doki_daily WHERE discord_id = ?').get(LOCAL_USER) as { v: number };
  return LOCAL_START_PT + Number(r.v);
}
