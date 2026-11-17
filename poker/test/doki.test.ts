/**
 * スロット「ぱびゅドキ！」。抽選は純粋関数で、D1 まわりは本物の SQLite（node:sqlite）に 0053・0055 を当てて確かめる。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  AT_GAMES, BET, CBELL_N, COIN_PT, DENOM, KOBOSHI_N, PAYOUT, ROLE_N, afterBonus, analyze, align, bigShare, ceilingOf, drawAt, drawHit, drawRole,
  dokiState, hitChance, isHeaven, miss, moveMachine, patternFor, MACHINES, SETTINGS, weekSettings, settingsOf, shuffleSettings, spin,
  transition, type DokiDb, type Mode,
} from '../src/doki.ts';

/** 決まった種から出る乱数（mulberry32） */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('機械割は初代 沖ドキ！ の値（設定1〜6 で 97.0〜107.9%）に 0.7 以内', () => {
  const want = [97.0, 99.7, 101.7, 103.9, 106.2, 107.9];
  for (let s = 1; s <= 6; s++) {
    const r = analyze(s);
    assert.ok(Math.abs(r.rate * 100 - want[s - 1]) < 0.7, `設定${s}: ${(r.rate * 100).toFixed(2)}%`);
  }
  assert.ok(Math.abs(analyze(1).rate * 100 - 97.0) < 0.05);
});

test('小役は合わせて 65536（純ハズレなし）。共通ベルは初代の値。50枚で約24G', () => {
  assert.equal(ROLE_N.replay + ROLE_N.bells + ROLE_N.cherry + ROLE_N.suika + ROLE_N.kakutei + ROLE_N.kcherry + ROLE_N.mcherry, DENOM);
  const cbell = [168.04, 158.30, 149.63, 141.85, 134.85, 128.50];
  for (let s = 1; s <= 6; s++) {
    const r = analyze(s);
    assert.ok(Math.abs(r.cbell - cbell[s - 1]) < 0.1, `設定${s} 共通ベル 1/${r.cbell.toFixed(2)}`);
    assert.ok(r.coin50 > 23 && r.coin50 < 25, `設定${s} 50枚で ${r.coin50.toFixed(1)}G`);
  }
  // 通常時の押し順ベルはいつも取りこぼす（左から押す）。ナビがあれば揃う
  const cb = CBELL_N[1];
  assert.equal(drawRole(1, ROLE_N.replay), 'koboshi');
  assert.equal(drawRole(1, ROLE_N.replay + KOBOSHI_N), 'bell_miss');
  assert.equal(drawRole(1, ROLE_N.replay + KOBOSHI_N, true), 'bell');
  assert.equal(drawRole(1, ROLE_N.replay + ROLE_N.bells - cb), 'cbell');
  assert.equal(drawRole(1, DENOM - 1), 'mcherry');
});

test('役ごとのボーナス当選率は初代の表どおり（モード・設定別）。確定系は 100%', () => {
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} / ${b}`);
  near(hitChance(1, 'suika', 'A'), 0.0366);
  near(hitChance(6, 'cherry', 'B'), 0.0168);
  near(hitChance(3, 'bell_miss', 'HK'), 0.0093);
  near(hitChance(4, 'replay', 'CH'), 0.0117);
  near(hitChance(5, 'cbell', 'TEN'), 0.1221);
  near(hitChance(6, 'suika', 'SDD'), 0.3263);
  for (const m of ['A', 'TEN'] as Mode[]) for (const r of ['kakutei', 'kcherry', 'mcherry'] as const) assert.equal(hitChance(2, r, m), 1);
  assert.equal(hitChance(2, 'none', 'TEN'), 0);
  // BIG の割合：チェリー・確定系は BIG、スイカは半々、天井は 60%、上位モードのリプレイ・ベルは 7:3
  assert.equal(bigShare(1, 'A', 'cherry'), 1);
  assert.equal(bigShare(1, 'A', 'mcherry'), 1);
  assert.equal(bigShare(1, 'A', 'suika'), 0.5);
  assert.equal(bigShare(1, 'A', 'ceil'), 0.6);
  near(bigShare(3, 'DD', 'replay'), 4.27 / 6.1);
});

test('回して確かめても機械割・合算は理論値に近い（設定1・6、各 300万ゲーム）', () => {
  for (const s of [1, 6]) {
    const rnd = seeded(s * 1000 + 7);
    let mode: Mode = 'A', ceil = ceilingOf(mode, rnd), games = 0, cin = 0, cout = 0, ng = 0, nb = 0, stock = 0;
    let pending: 'big' | 'reg' | null = null, notice = false;
    for (let n = 0; n < 3_000_000; n++) {
      cin += BET;
      if (pending && !notice) {
        const at = drawAt(s, pending, rnd); nb++;
        cin += BET * at.games.length; cout += at.pay;
        const r = afterBonus(mode, ceil, at.games, s, rnd); mode = r.mode; ceil = r.ceil;
        stock += at.stock + (r.zero ? 1 : 0);
        if (stock > 0) { stock--; pending = 'big'; } else pending = null;
        continue;
      }
      ng++;
      const role = drawRole(s, Math.floor(rnd() * DENOM));
      cout += PAYOUT[role];
      if (pending && notice) { notice = false; continue; }
      games++;
      const won = rnd() < hitChance(s, role, mode);
      if (won || games >= ceil) {
        const h = drawHit(mode, s, won ? role : 'ceil', rnd);
        pending = h.kind; notice = h.later; mode = h.next; ceil = ceilingOf(mode, rnd); games = 0;
      }
    }
    const want = analyze(s);
    assert.ok(Math.abs(cout / cin - want.rate) < 0.03, `設定${s}: 回して ${(cout / cin * 100).toFixed(2)}% / 理論 ${(want.rate * 100).toFixed(2)}%`);
    assert.ok(Math.abs(ng / nb - want.sum) / want.sum < 0.05, `設定${s}: 合算 1/${(ng / nb).toFixed(1)} / 理論 1/${want.sum.toFixed(1)}`);
  }
});

test('天井：通常A・B は 1000G、チャンス・引き戻しは 101〜200G、保障以上は 32G（1/8 で 0G）', () => {
  const rnd = seeded(3);
  let zero = 0;
  for (const m of ['TEN', 'DD', 'SDD', 'HO'] as Mode[]) for (let i = 0; i < 2000; i++) { const c = ceilingOf(m, rnd); assert.ok(c === 0 || c === 32); if (c === 0) zero++; }
  assert.ok(Math.abs(zero / 8000 - 1 / 8) < 0.02, `0G ${zero / 8000}`);
  assert.equal(ceilingOf('A', rnd), 1000);
  assert.equal(ceilingOf('B', rnd), 1000);
  for (const m of ['CH', 'HK'] as Mode[]) for (let i = 0; i < 500; i++) { const c = ceilingOf(m, rnd); assert.ok(c >= 101 && c <= 200); }
});

test('モード移行は初代の表：中段チェリーは天国以上、通常B は A に落ちない、天国は奇数設定のほうが残りやすい', () => {
  const MODES: Mode[] = ['A', 'B', 'CH', 'HK', 'HO', 'TEN', 'DD', 'SDD'];
  const share = (m: Mode, s: number, r: Parameters<typeof transition>[2], to: Mode) => {
    const w = transition(m, s, r); return (w.find(([x]) => x === to)?.[1] ?? 0) / w.reduce((a, [, n]) => a + n, 0);
  };
  for (const m of MODES) {
    for (let s = 1; s <= 6; s++) {
      for (const r of ['none', 'cherry', 'suika', 'kakutei', 'kcherry', 'mcherry'] as const) {
        const w = transition(m, s, r);
        const tot = w.reduce((a, [, n]) => a + n, 0);
        assert.ok(Math.abs(tot - 100) < 0.1, `${m} 設定${s} ${r} 合計 ${tot}`);
        for (const [, n] of w) assert.ok(n > 0);
      }
      for (const [x] of transition(m, s, 'mcherry')) assert.ok(isHeaven(x) && x !== 'HO', `${m} 中段チェリー → ${x}`);
      assert.ok(Math.abs(share('B', s, 'none', 'A') - 0) < 1e-9);
    }
  }
  assert.ok(Math.abs(share('TEN', 1, 'none', 'TEN') - 0.7422) < 1e-3);
  assert.ok(Math.abs(share('TEN', 2, 'none', 'TEN') - 0.6484) < 1e-3);
  assert.ok(Math.abs(share('TEN', 2, 'none', 'HK') - 0.1719) < 1e-3);
  assert.ok(Math.abs(share('A', 4, 'suika', 'B') - 0.5938) < 1e-3);
  assert.equal(share('A', 1, 'cherry', 'A'), share('A', 1, 'none', 'A')); // 通常A のチェリーはリプレイ・ベルと同じ
  assert.ok(Math.abs(share('HO', 1, 'cherry', 'HO') - 0.957) < 1e-3);
  assert.ok(Math.abs(share('SDD', 3, 'none', 'SDD') - 0.9063) < 1e-3);
  assert.ok(Math.abs(share('CH', 5, 'suika', 'TEN') - 0.3125) < 1e-3);
  // 偶数設定のほうが通常A から通常B に上がりやすい
  assert.ok(share('A', 2, 'none', 'B') > share('A', 1, 'none', 'B'));
});

test('当たりの告知：天井はその場、レア役は次のゲーム、リプレイ・ベルは半々。フリーズは BIG＋超ドキドキ', () => {
  const rnd = seeded(17);
  let later = 0, freeze = 0;
  for (let i = 0; i < 4000; i++) {
    assert.equal(drawHit('A', 1, 'ceil', rnd).later, false);
    assert.equal(drawHit('A', 1, 'suika', rnd).later, true);
    assert.equal(drawHit('A', 1, 'cherry', rnd).kind, 'big');
    if (drawHit('A', 1, 'replay', rnd).later) later++;
    const h = drawHit('A', 1, 'mcherry', rnd);
    if (h.premium === 'freeze') { freeze++; assert.equal(h.next, 'SDD'); assert.equal(h.kind, 'big'); }
  }
  assert.ok(Math.abs(later / 4000 - 0.5) < 0.04);
  assert.ok(Math.abs(freeze / 4000 - 0.5) < 0.04);
});

test('ボーナス後：天井 0G なら 1G連 を足して次のモードへ。ボーナス中の確定役でモード昇格', () => {
  const rnd = seeded(23);
  const plain = drawAt(1, 'reg', rnd).games.map((g) => ({ ...g, role: 'replay' as const, stock: false }));
  const z = afterBonus('TEN', 0, plain, 1, rnd);
  assert.equal(z.zero, true);
  assert.ok(z.ceil === 0 || z.ceil === 32 || z.ceil >= 101);
  assert.deepEqual(afterBonus('TEN', 32, plain, 1, rnd), { mode: 'TEN', ceil: 32, zero: false });
  // 中段チェリーは通常A でも天国以上へ
  const withM = plain.map((g, i) => (i === 3 ? { ...g, role: 'mcherry' as const } : g));
  const up = afterBonus('A', 1000, withM, 1, rnd);
  assert.ok(isHeaven(up.mode) || up.zero);
});

test('光り方は次のモードを知らせる（左のみはドキドキ以上、しだれ柳・ドキドキランプは超ドキドキだけ）', () => {
  const rnd = seeded(9);
  for (let i = 0; i < 2000; i++) {
    for (const m of ['A', 'B', 'CH', 'HK'] as Mode[]) assert.ok(!['right', 'panel', 'left', 'reverse', 'doki', 'shidare', 'b337'].includes(patternFor(m, rnd)));
    for (const m of ['TEN', 'HO'] as Mode[]) assert.ok(!['left', 'reverse', 'doki', 'shidare'].includes(patternFor(m, rnd)));
    assert.ok(!['doki', 'shidare'].includes(patternFor('DD', rnd)));
  }
});

test('ボーナスは BIG 70G・REG 30G。ナビどおりなら BIG 約210枚・REG 約90枚', () => {
  const rnd = seeded(11);
  let big = 0, reg = 0;
  for (let i = 0; i < 4000; i++) {
    const b = drawAt(4, 'big', rnd); assert.equal(b.games.length, AT_GAMES.big); big += b.pay - BET * AT_GAMES.big;
    const r = drawAt(4, 'reg', rnd); assert.equal(r.games.length, AT_GAMES.reg); reg += r.pay - BET * AT_GAMES.reg;
    for (const g of b.games) assert.equal(g.nav != null, g.role === 'bell');
  }
  assert.ok(Math.abs(big / 4000 - 210) < 8, `BIG ${big / 4000}`);
  assert.ok(Math.abs(reg / 4000 - 90) < 5, `REG ${reg / 4000}`);
});

test('設定は 6・5・4・4・3・3・3・2・2・1・1・1 を12台に1つずつ', () => {
  assert.equal(MACHINES.length, 12);
  const key = [...SETTINGS].sort().join();
  const rnd = seeded(5);
  for (let i = 0; i < 100; i++) assert.equal([...shuffleSettings(rnd)].sort().join(), key);
  assert.deepEqual(settingsOf('6,1,4,5,4,3,3,3,2,2,1,1'), [6, 1, 4, 5, 4, 3, 3, 3, 2, 2, 1, 1]);
  assert.equal(settingsOf('3,6,1,5,2,4'), null); // 6台のころの並び
  assert.equal(settingsOf('6,6,4,4,3,3,3,2,2,1,1,1'), null);
});

// ---- D1 ----

function makeDb(): DokiDb & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  for (const f of ['0053_doki.sql', '0055_doki_notice.sql']) raw.exec(readFileSync(new URL(`../../web/migrations/${f}`, import.meta.url).pathname, 'utf8'));
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async <T>(col?: string) => { const r = raw.prepare(sql).get(...(args as never[])) as Record<string, unknown> | undefined; return (r ? (col ? r[col] : r) : null) as T; },
    all: async <T>() => ({ results: raw.prepare(sql).all(...(args as never[])) as T[] }),
    run: async () => { const r = raw.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
  });
  return {
    raw,
    prepare: (sql: string) => stmt(sql) as unknown as D1PreparedStatement,
    batch: async (list: D1PreparedStatement[]) => { for (const s of list) await (s as unknown as { run: () => Promise<unknown> }).run(); return []; },
  };
}

const NOW = Date.parse('2026-11-17T03:00:00Z');
const rich = async () => 1_000_000;

test('回すと 60pt 減り、当たるとハイビスカスが光る。次のゲームで 7 を狙えば揃い、AT の純増が足される', async () => {
  const db = makeDb();
  const rnd = seeded(21);
  let hit: Awaited<ReturnType<typeof spin>> | null = null;
  for (let i = 0; i < 3000 && !hit; i++) {
    const r = await spin(db, 'u1', NOW + i * 2000, rich, rnd);
    assert.ok(r.ok);
    if (r.ok && r.lamp) hit = r;
  }
  assert.ok(hit && hit.ok && hit.pending && hit.pattern);
  // 光っているあいだは抽選しない（小役なし）。このゲームで揃えられる
  const next = await spin(db, 'u1', NOW + 9_000_000, rich, rnd);
  assert.ok(next.ok && next.role === 'none' && next.canAlign && next.pending === (hit as { pending: string }).pending);
  const before = Number((db.raw.prepare("SELECT SUM(pt_net) AS v FROM doki_daily WHERE discord_id = 'u1'").get() as { v: number }).v);
  const a = await align(db, 'u1', NOW + 9_001_000, rnd);
  assert.ok(a.ok);
  if (!a.ok) return;
  assert.equal(a.games.length, AT_GAMES[a.kind]);
  const after = Number((db.raw.prepare("SELECT SUM(pt_net) AS v FROM doki_daily WHERE discord_id = 'u1'").get() as { v: number }).v);
  assert.equal(after - before, a.net * COIN_PT);
  // 2回は揃わない（1G連のストックがあるときは次のボーナスが光っている）
  const again = await align(db, 'u1', NOW + 9_002_000, rnd);
  if (a.next) assert.ok(!again.ok || again.ok); else assert.equal(again.ok, false);
  // ナビを外したベルは 7枚ずつ戻す
  const bells = a.games.filter((g) => g.role === 'bell').length;
  if (!a.next && bells > 0) {
    const m = await miss(db, 'u1', 2);
    assert.ok(m.ok);
    if (m.ok) assert.equal(m.back, Math.min(2, bells) * 7);
  }
  const st = await dokiState(db, 'u1', NOW + 9_003_000);
  assert.equal(st.today.big + st.today.reg >= 1, true);
});

test('光っているあいだは台を移れない。移ってもモードは台ごとに残る', async () => {
  const db = makeDb();
  const rnd = seeded(33);
  assert.deepEqual(await moveMachine(db, 'u2', 4, NOW), { ok: true, machine: 4 });
  const r = await spin(db, 'u2', NOW, rich, rnd);
  assert.ok(r.ok && r.machine === 4);
  db.raw.prepare("UPDATE doki_mstate SET pending = 'big' WHERE discord_id = 'u2' AND machine = 4").run();
  assert.deepEqual(await moveMachine(db, 'u2', 2, NOW), { ok: false, reason: 'pending' });
  db.raw.prepare("UPDATE doki_mstate SET pending = NULL WHERE discord_id = 'u2'").run();
  const mode = (db.raw.prepare("SELECT mode FROM doki_mstate WHERE discord_id = 'u2' AND machine = 4").get() as { mode: string }).mode;
  assert.deepEqual(await moveMachine(db, 'u2', 2, NOW), { ok: true, machine: 2 });
  await spin(db, 'u2', NOW + 3000, rich, rnd);
  await moveMachine(db, 'u2', 4, NOW);
  assert.equal((db.raw.prepare("SELECT mode FROM doki_mstate WHERE discord_id = 'u2' AND machine = 4").get() as { mode: string }).mode, mode);
});

test('使えるポイントが足りなければ回せない', async () => {
  const db = makeDb();
  const r = await spin(db, 'u3', NOW, async () => 59, seeded(1));
  assert.deepEqual(r, { ok: false, reason: 'insufficient' });
});

test('週の設定は最初に決めたものがその週のあいだ続く', async () => {
  const db = makeDb();
  const first = await weekSettings(db, NOW, seeded(1));
  assert.equal([...first].sort().join(), [...SETTINGS].sort().join());
  assert.deepEqual(await weekSettings(db, NOW + 3600_000, seeded(2)), first);
});

test('次ゲーム告知：当たったゲームでは出さず、次のゲームで光らせて、その次で揃える。待つあいだは台を移れる', async () => {
  const db = makeDb();
  const rnd = seeded(41);
  await spin(db, 'u4', NOW, rich, rnd);
  db.raw.prepare("UPDATE doki_mstate SET pending = 'big', notice = 'post|right|', can_align = 0 WHERE discord_id = 'u4'").run();
  const st = await dokiState(db, 'u4', NOW + 1000);
  assert.equal(st.pending, null);
  assert.deepEqual(await moveMachine(db, 'u4', 5, NOW), { ok: true, machine: 5 });
  await moveMachine(db, 'u4', 1, NOW);
  const g1 = await spin(db, 'u4', NOW + 2000, rich, rnd);
  assert.ok(g1.ok && g1.lamp === 'post' && g1.pattern === 'right' && g1.pending === 'big' && !g1.canAlign && g1.role !== 'none');
  assert.deepEqual(await moveMachine(db, 'u4', 5, NOW), { ok: false, reason: 'pending' });
  const g2 = await spin(db, 'u4', NOW + 4000, rich, rnd);
  assert.ok(g2.ok && g2.role === 'none' && g2.canAlign && g2.lamp === null);
  const a = await align(db, 'u4', NOW + 5000, rnd);
  assert.ok(a.ok && a.kind === 'big');
});
