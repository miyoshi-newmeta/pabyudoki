/**
 * スロット「ぱびゅドキ！」の画面側（リールの並びと止め方）。抽選は Worker（poker/src/doki.ts）でする。
 * 定数は poker/src/doki.ts の写しで、test/doki.test.ts で一致を確かめる。
 */

export type Sym = '7' | 'B' | 'L' | 'R' | 'C' | 'S';
export type Role = 'replay' | 'bell' | 'bell_miss' | 'koboshi' | 'cbell' | 'cherry' | 'suika' | 'kakutei' | 'kcherry' | 'mcherry' | 'none';
export type Target = Role | 'big' | 'reg';

export const COIN_PT = 20;
export const BET = 3;
export const DAILY_GAME_LIMIT = 8000;
export const GRAPH_EVERY = 10;
export const PAYOUT: Record<Role, number> = {
  replay: 3, bell: 7, bell_miss: 0, koboshi: 1, cbell: 7, cherry: 1, suika: 4, kakutei: 0, kcherry: 1, mcherry: 1, none: 0,
};
export const AT_GAMES = { big: 70, reg: 30 } as const;
export const MACHINES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
/** 週ごとに配る設定（並びは週ごとにランダム） */
export const SETTINGS = [6, 5, 4, 4, 3, 3, 3, 2, 2, 1, 1, 1] as const;
export const ORDERS: number[][] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
/** 小役の当選数（/65536。合わせて 65536）。bells は押し順ベル＋共通ベル */
export const ROLE_N = { replay: 12978, bells: 49990, cherry: 2040, suika: 512, kakutei: 8, kcherry: 6, mcherry: 2 } as const;
export const CBELL_N: Record<number, number> = { 1: 390, 2: 414, 3: 438, 4: 462, 5: 486, 6: 510 };
/** 通常時の押し順ベルの取りこぼしのうち 1枚出るもの（/65536） */
export const KOBOSHI_N = 14860;
/** 役ごとのボーナス当選率（%・設定1〜6）。N = 通常A・B、UP = 保障・天国・ドキドキ・超ドキドキ。other はリプレイ・ベル */
export const HIT = {
  N: { suika: [3.66, 3.97, 4.27, 4.58, 4.88, 5.19], cherry: [0.92, 1.07, 1.22, 1.37, 1.53, 1.68], other: [0.34, 0.35, 0.37, 0.39, 0.41, 0.43] },
  HK: { suika: [9.16, 9.92, 10.68, 11.44, 12.21, 12.97], cherry: [2.29, 2.67, 3.05, 3.43, 3.81, 4.2], other: [0.84, 0.89, 0.93, 0.98, 1.02, 1.07] },
  CH: { suika: [10.99, 11.9, 12.82, 13.73, 14.65, 15.56], cherry: [2.75, 3.2, 3.66, 4.12, 4.58, 5.04], other: [1.01, 1.06, 1.12, 1.17, 1.23, 1.28] },
  UP: { suika: [25, 26.53, 28.05, 29.58, 31.1, 32.63], cherry: [6.25, 6.63, 7.01, 7.39, 7.78, 8.16], other: [12.21, 12.21, 12.21, 12.21, 12.21, 12.21] },
} as const;
/** 理論値（poker/src/doki.ts の analyze）。機械割・合算・BIG・REG */
export const SPEC: Record<number, { rate: number; sum: number; big: number; reg: number }> = {
  1: { rate: 97.0, sum: 89.1, big: 126.1, reg: 304.2 },
  2: { rate: 99.0, sum: 84.6, big: 120.4, reg: 285.0 },
  3: { rate: 101.0, sum: 80.4, big: 115.0, reg: 267.1 },
  4: { rate: 103.3, sum: 75.9, big: 109.0, reg: 249.9 },
  5: { rate: 105.7, sum: 71.8, big: 102.6, reg: 239.1 },
  6: { rate: 107.5, sum: 68.6, big: 98.7, reg: 225.7 },
};
/** ウェイト・回転の速さ（ぱびゅらーと同じ）。引き込みは最大4コマ */
export const TIMING = { waitMs: 2050, cellsPerSec: (80 * 21) / 60, accelMs: 300, maxSlide: 4 } as const;

/**
 * リールの並び（画面の上から下へ）。ベルとリプレイをおよそ3コマおきに置き、どこで押しても揃えられるようにしてある。
 * 7 は各リール1つ。BAR はどれもすぐ上がスイカ（BAR を狙えばスイカも見える）
 */
export const REELS: Sym[][] = [
  ['7', 'L', 'R', 'C', 'L', 'R', 'L', 'R', 'S', 'B', 'L', 'R', 'C', 'L', 'R', 'L', 'R', 'S', 'B', 'L', 'R'],
  ['7', 'R', 'L', 'C', 'R', 'L', 'R', 'L', 'S', 'B', 'R', 'L', 'C', 'R', 'L', 'R', 'L', 'S', 'B', 'R', 'L'],
  ['7', 'S', 'B', 'L', 'R', 'C', 'L', 'R', 'S', 'L', 'R', 'L', 'R', 'S', 'B', 'L', 'R', 'C', 'L', 'R', 'L'],
];
const N = 21;
const mod = (n: number) => ((n % N) + N) % N;

/** 5ライン（各リールの段。0 = 上段）。最初が中段 */
export const LINES: number[][] = [[1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0]];

export function symAt(r: number, top: number, row: number): Sym {
  return REELS[r][mod(top + row)];
}

type Hit = { pat: 'L' | 'R' | 'S' | '7' | '77B'; line: number };
/** 3つとも止まっているときに揃っている絵柄 */
export function lineHits(tops: number[]): Hit[] {
  const out: Hit[] = [];
  LINES.forEach((line, i) => {
    const s = line.map((row, r) => symAt(r, tops[r], row));
    if (s[0] === s[1] && s[1] === s[2] && (s[0] === 'L' || s[0] === 'R' || s[0] === 'S' || s[0] === '7')) out.push({ pat: s[0], line: i });
    else if (s[0] === '7' && s[1] === '7' && s[2] === 'B') out.push({ pat: '77B', line: i });
  });
  return out;
}
/** 左リールのチェリーの段（無ければ -1） */
function cherryRow(top: number): number {
  for (let row = 0; row < 3; row++) if (symAt(0, top, row) === 'C') return row;
  return -1;
}

/** 止まった形がその役（またはボーナス）に見えるか */
export function shows(tops: number[], t: Target): boolean {
  const hits = lineHits(tops);
  const c = cherryRow(tops[0]);
  const only = (p: Hit['pat'][]) => hits.length > 0 && hits.every((h) => p.includes(h.pat));
  switch (t) {
    case 'none': case 'bell_miss': case 'koboshi': return hits.length === 0 && c < 0;
    case 'replay': return c < 0 && only(['R']);
    case 'bell': return c < 0 && only(['L']) && hits.every((h) => h.line !== 0);
    case 'cbell': return c < 0 && only(['L']) && hits.some((h) => h.line === 0);
    case 'suika': return c < 0 && only(['S']);
    case 'cherry': return hits.length === 0 && (c === 0 || c === 2) && symAt(1, tops[1], 1) !== '7';
    case 'mcherry': return hits.length === 0 && c === 1;
    case 'kcherry': return hits.length === 0 && (c === 0 || c === 2) && symAt(1, tops[1], 1) === '7';
    case 'kakutei':
      // 確定役：スイカのテンパイはずれ（左・中にスイカが並び、右は外れる）
      return hits.length === 0 && c < 0 && LINES.some((line) => symAt(0, tops[0], line[0]) === 'S' && symAt(1, tops[1], line[1]) === 'S' && symAt(2, tops[2], line[2]) !== 'S');
    case 'big': return c < 0 && only(['7']);
    case 'reg': return c < 0 && only(['77B']);
  }
}

/** まだ回っているリールをどこに止めてもよいとして、その形にできるか */
function possible(tops: (number | null)[], t: Target): boolean {
  const rest = [0, 1, 2].filter((r) => tops[r] == null);
  const f = tops.slice() as number[];
  const go = (k: number): boolean => {
    if (k === rest.length) return shows(f, t);
    for (let p = 0; p < N; p++) { f[rest[k]] = p; if (go(k + 1)) return true; }
    return false;
  };
  return go(0);
}

/**
 * ストップを押した。press は押した瞬間の上段のコマ（リールは上から下へ流れ、番号が減る向きに進む）。
 * target の形にできるところへ最大4コマ滑らせて止める。4コマで無理なら（取りこぼし）、何も揃わない形に止める
 */
export function chooseStop(r: number, press: number, tops: (number | null)[], target: Target): { top: number; slide: number; ok: boolean } {
  const at = (d: number) => { const n = tops.slice(); n[r] = mod(press - d); return n; };
  for (let d = 0; d <= TIMING.maxSlide; d++) if (possible(at(d), target)) return { top: mod(press - d), slide: d, ok: true };
  // ボーナス（目押しが要る）でなければ、もっと滑らせてでもその形にする（小役は取りこぼさない）
  if (target !== 'big' && target !== 'reg') for (let d = TIMING.maxSlide + 1; d < N; d++) if (possible(at(d), target)) return { top: mod(press - d), slide: d, ok: true };
  // 揃えられない（ボーナスの目押しの失敗）。何も揃わない形にする
  for (let d = 0; d < N; d++) if (possible(at(d), 'none')) return { top: mod(press - d), slide: d, ok: false };
  return { top: mod(press), slide: 0, ok: false };
}

/** 目押しのうまい人の押し方（「自動で止める」用）：target を揃えられる位置で押す */
export function aimPress(r: number, tops: (number | null)[], target: Target, rnd: () => number = Math.random): number {
  const start = Math.floor(rnd() * N);
  for (let k = 0; k < N; k++) {
    const p = mod(start + k);
    if (chooseStop(r, p, tops, target).ok) return p;
  }
  return start;
}

export function jstDay(nowMs: number): string {
  return new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 10);
}
export function jstWeekStart(nowMs: number): string {
  const d = new Date(nowMs + 9 * 3600_000);
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10);
}
export const oneIn = (n: number) => `1/${(65536 / n).toFixed(1)}`;
