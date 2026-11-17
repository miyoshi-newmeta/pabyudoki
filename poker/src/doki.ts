/**
 * スロット「ぱびゅドキ！」（初代 沖ドキ！ の役と恩恵をそのまま写した AT 機。演出は沖ドキ！GOLD から）。
 *
 * 抽選はここ（Worker）でする。画面はレバーを引くたびに /api/doki/spin を呼び、返ってきた役のとおりにリールを止める
 * （止め方は画面側の web/src/lib/doki.ts）。数値は初代の解析値（パチセブン・パチタウン・一撃で一致したもの）。
 *
 * - 1枚 = 20pt。3枚掛け（60pt）。リプレイは掛け直しなしでもう1回
 * - 小役は全部で 65536。純ハズレは無く、通常時の「ハズレ」は押し順ベル（中・右から押す4通り）の取りこぼし（0枚）。
 *   通常時は左から押す決まりなので、押し順ベルはいつも取りこぼす
 * - 引いた役ごとに、滞在しているモードと設定で決まる確率でボーナスを抽選する。確定役・確定チェリー・中段チェリーは BIG 確定。
 *   チェリーは BIG、スイカは BIG・REG 半々、天井（規定ゲーム数）は BIG 60%
 * - モードは 通常A・通常B・チャンス・引き戻し・保障・天国・ドキドキ・超ドキドキ。ボーナスに当たると「モード × 当たった役 × 設定」の表で次のモードを決める。
 *   天井は 通常A・B 1000G、チャンス・引き戻し 101〜200G、保障以上 32G（1/8 で 0G＝1G連）
 * - 告知（ハイビスカス）：天井はその場、レア役は次のゲーム、それ以外の役は半々でその場か次のゲーム。
 *   ロングフリーズは BIG＋超ドキドキ確定、リール遅れは当たり確定
 * - ボーナスは押し順ナビの AT で、BIG 70G（約210枚）・REG 30G（約90枚）。純増はナビどおりに打った前提で揃えたときにまとめて足す。
 *   ナビを外したベルは画面が /api/doki/miss で返す
 * - ボーナス中のチェリー 1.17%・スイカ 4.69%・確定系の役 100% で 1G連（BIG）。確定系の役はモードの昇格も抽選する
 * - 台は12台。週ごと（月曜 0:00 JST）に設定 6・5・4・4・3・3・3・2・2・1・1・1 をランダムに配り直す。どれがどの設定かは週が終わるまで出さない。
 *   モードと天井は人ごと・台ごとに持つ（台を移っても、戻ってくれば続き）。週が変わると設定変更として選び直す
 *
 * 残高は doki_daily.pt_net を足す（bet.ts の availableFor）。テストプレイ（2026-11-16〜17）の記録は doki_test_* に移してある。
 * 機械割・合算は analyze（マルコフ連鎖）で出し、test/doki.test.ts で初代の値に近いことを確かめる。
 */

export type Mode = 'A' | 'B' | 'CH' | 'HK' | 'TEN' | 'DD' | 'SDD' | 'HO';
/**
 * 役。bell = 押し順ベルが揃う（ボーナス中のナビどおり）、bell_miss = 押し順ベルの取りこぼし（通常時のハズレ目）、
 * koboshi = 押し順ベルの取りこぼしで 1枚だけ出る形、cbell = 共通ベル（中段・設定差あり）、kakutei = 確定役（リーチ目）、kcherry = 確定チェリー、mcherry = 中段チェリー、none = 7 を揃えるゲーム
 */
export type Role = 'replay' | 'bell' | 'bell_miss' | 'koboshi' | 'cbell' | 'cherry' | 'suika' | 'kakutei' | 'kcherry' | 'mcherry' | 'none';
export type Kind = 'big' | 'reg';
/** ハイビスカスの光り方（次のモードを知らせる） */
export type Pattern = 'normal' | 'fast' | 'slow' | 'sync' | 'b337' | 'right' | 'panel' | 'left' | 'reverse' | 'doki' | 'shidare';
/** プレミア演出（当たり確定）。freeze = ロングフリーズ（BIG＋超ドキドキ確定）、delay = リール遅れ。ほかは GOLD にならう */
export type Premium = 'freeze' | 'flash' | 'delay' | 'senchika' | 'silent';
/** 当たったきっかけ。ceil = 天井（規定ゲーム数） */
export type Trigger = Role | 'ceil';

export const COIN_PT = 20;
export const BET = 3;
export const DAILY_GAME_LIMIT = 8000;
export const GRAPH_EVERY = 10;
export const PRE_NOTICE_RATE = 0.3;
export const DENOM = 65536;
export const MACHINES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
/** 週ごとに配る設定（1台に1つずつ。並びは週ごとにランダム）。ぱびゅらーと同じ */
export const SETTINGS = [6, 5, 4, 4, 3, 3, 3, 2, 2, 1, 1, 1] as const;

/** 払い出し（3枚掛け。リプレイは掛けたぶんが戻る扱い）。確定役はハズレ目 */
export const PAYOUT: Record<Role, number> = {
  replay: 3, bell: 7, bell_miss: 0, koboshi: 1, cbell: 7, cherry: 1, suika: 4, kakutei: 0, kcherry: 1, mcherry: 1, none: 0,
};
/** ボーナスのゲーム数（AT）。BIG 約210枚・REG 約90枚 */
export const AT_GAMES: Record<Kind, number> = { big: 70, reg: 30 };

/** 小役の当選数（/65536。合わせてちょうど 65536）。bells は押し順ベル＋共通ベルで、共通ベルだけ設定差がある */
export const ROLE_N = { replay: 12978, bells: 49990, cherry: 2040, suika: 512, kakutei: 8, kcherry: 6, mcherry: 2 } as const;
export const CBELL_N: Record<number, number> = { 1: 390, 2: 414, 3: 438, 4: 462, 5: 486, 6: 510 };
/**
 * 通常時の押し順ベルの取りこぼしのうち、1枚出るもの（/65536）。初代の取りこぼしの払い出しは解析に無いので、
 * 機械割（97.0〜107.9%）とコイン持ち（約23G/50枚）に合うよう決めた
 */
export const KOBOSHI_N = 14860;
/** ボーナス中の 1G連 の当選率（確定系の役は 100%） */
export const STOCK_P = { cherry: 0.0117, suika: 0.0469 } as const;
/** 天国以上のモードに入ったとき、規定ゲーム数が 0G（1G連）になる割合 */
export const ZERO_G = 1 / 8;
/** 設定変更（週替わり）のときのモード */
export const RESET_MODES: [Mode, number][] = [['A', 57.03], ['B', 9.77], ['CH', 33.2]];
export const HEAVEN: readonly Mode[] = ['HO', 'TEN', 'DD', 'SDD'];
export const isHeaven = (m: Mode) => HEAVEN.includes(m);

/** レア役（チェリー・スイカ・確定系）。当たると次のゲームで告知 */
const RARE = new Set<Role>(['cherry', 'suika', 'kakutei', 'kcherry', 'mcherry']);
/** 確定系の役（どのモードでも BIG 確定） */
const SURE = new Set<Role>(['kakutei', 'kcherry', 'mcherry']);
const idx = (setting: number) => Math.min(6, Math.max(1, Math.round(setting) || 1)) - 1;

/** 重みつきで1つ選ぶ */
export function pick<T>(rnd: () => number, w: [T, number][]): T {
  const total = w.reduce((a, [, n]) => a + n, 0);
  let x = rnd() * total;
  for (const [v, n] of w) { x -= n; if (x < 0) return v; }
  return w[w.length - 1][0];
}

type Group = 'N' | 'HK' | 'CH' | 'UP';
const groupOf = (m: Mode): Group => (m === 'A' || m === 'B' ? 'N' : m === 'HK' || m === 'CH' ? m : 'UP');
/** 役ごとのボーナス当選率（%・設定1〜6）。other はリプレイ・ベル */
export const HIT: Record<Group, { suika: number[]; cherry: number[]; other: number[] }> = {
  N: { suika: [3.66, 3.97, 4.27, 4.58, 4.88, 5.19], cherry: [0.92, 1.07, 1.22, 1.37, 1.53, 1.68], other: [0.34, 0.35, 0.37, 0.39, 0.41, 0.43] },
  HK: { suika: [9.16, 9.92, 10.68, 11.44, 12.21, 12.97], cherry: [2.29, 2.67, 3.05, 3.43, 3.81, 4.2], other: [0.84, 0.89, 0.93, 0.98, 1.02, 1.07] },
  CH: { suika: [10.99, 11.9, 12.82, 13.73, 14.65, 15.56], cherry: [2.75, 3.2, 3.66, 4.12, 4.58, 5.04], other: [1.01, 1.06, 1.12, 1.17, 1.23, 1.28] },
  UP: { suika: [25, 26.53, 28.05, 29.58, 31.1, 32.63], cherry: [6.25, 6.63, 7.01, 7.39, 7.78, 8.16], other: [12.21, 12.21, 12.21, 12.21, 12.21, 12.21] },
};
/** リプレイ・ベルで当たったときの BIG と REG の割合（設定1〜6） */
const OTHER_BR: Record<Group, [number[], number[]]> = {
  N: [[0.09, 0.1, 0.1, 0.1, 0.11, 0.11], [0.07, 0.08, 0.09, 0.09, 0.1, 0.1]],
  HK: [[0.24, 0.24, 0.25, 0.26, 0.27, 0.27], [0.18, 0.2, 0.21, 0.23, 0.24, 0.26]],
  CH: [[0.28, 0.29, 0.3, 0.31, 0.32, 0.33], [0.22, 0.24, 0.26, 0.27, 0.29, 0.31]],
  UP: [[4.27, 4.27, 4.27, 4.27, 4.27, 4.27], [1.83, 1.83, 1.83, 1.83, 1.83, 1.83]],
};

/** その役のゲームでボーナスに当たる確率 */
export function hitChance(setting: number, role: Role, mode: Mode): number {
  if (SURE.has(role)) return 1;
  if (role === 'none') return 0;
  const h = HIT[groupOf(mode)];
  return (role === 'suika' ? h.suika : role === 'cherry' ? h.cherry : h.other)[idx(setting)] / 100;
}

/** 当たったときに BIG になる割合 */
export function bigShare(setting: number, mode: Mode, t: Trigger): number {
  if (t === 'ceil') return 0.6;
  if (SURE.has(t as Role) || t === 'cherry') return 1;
  if (t === 'suika') return 0.5;
  const [b, r] = OTHER_BR[groupOf(mode)];
  return b[idx(setting)] / (b[idx(setting)] + r[idx(setting)]);
}

/** ロングフリーズ（BIG＋超ドキドキ）とリール遅れの割合（当たったきっかけごと） */
export function freezeRate(t: Trigger): number {
  return t === 'mcherry' ? 0.5 : t === 'kakutei' || t === 'kcherry' ? 0.05 : t === 'suika' || t === 'cherry' ? 0.015625 : t === 'ceil' ? 0.0003 : 0.0006;
}
export function delayRate(t: Trigger): number {
  return t === 'mcherry' ? 0.5 : t === 'kakutei' || t === 'kcherry' ? 0.25 : t === 'suika' || t === 'cherry' ? 0.125 : t === 'ceil' ? 0 : 0.1016;
}

const row = (ms: Mode[], v: number[]): [Mode, number][] => ms.map((m, k): [Mode, number] => [m, v[k]]).filter(([, n]) => n > 0);
const ABTD: Mode[] = ['A', 'B', 'TEN', 'DD'];
const BTD: Mode[] = ['B', 'TEN', 'DD'];
const TDS: Mode[] = ['TEN', 'DD', 'SDD'];
// 設定1〜6 の行
const A_SUIKA = [[28.13, 50, 20.31, 1.56], [20.31, 57.81, 20.31, 1.56], [26.56, 50, 21.88, 1.56], [18.75, 59.38, 20.31, 1.56], [25, 50, 23.44, 1.56], [17.19, 60.94, 20.31, 1.56]];
const A_OTHER = [[64.06, 25, 10.16, 0.78], [51.56, 37.5, 10.16, 0.78], [63.28, 25, 10.94, 0.78], [50.78, 38.28, 10.16, 0.78], [62.5, 25, 11.72, 0.78], [50, 39.06, 10.16, 0.78]];
const B_SUIKA = [[23.44, 59.38, 17.19], [19.53, 64.84, 15.63], [21.88, 59.38, 18.75], [17.97, 66.41, 15.63], [20.31, 59.38, 20.31], [16.41, 67.97, 15.63]];
const B_OTHER = [[49.22, 42.19, 8.59], [39.06, 53.13, 7.81], [48.44, 42.19, 9.38], [38.28, 53.91, 7.81], [47.66, 42.19, 10.16], [37.5, 54.69, 7.81]];
const HK_SUIKA = [[25, 42.19, 31.25, 1.56], [25, 42.19, 31.25, 1.56], [25, 40.63, 32.81, 1.56], [23.44, 43.75, 31.25, 1.56], [25, 39.06, 34.38, 1.56], [21.88, 45.31, 31.25, 1.56]];
const HK_OTHER = [[50, 33.59, 15.63, 0.78], [33.59, 50, 15.63, 0.78], [50, 32.81, 16.41, 0.78], [32.81, 50.78, 15.63, 0.78], [50, 32.03, 17.19, 0.78], [32.03, 51.56, 15.63, 0.78]];

/**
 * ボーナスに当たったときの次のモード。rare は当たったゲームの役（天井なら 'none'）。
 * 通常A・B・チャンス・引き戻しでは、チェリーはリプレイ・ベルと同じ扱い
 */
export function transition(mode: Mode, setting: number, rare: Role): [Mode, number][] {
  const i = idx(setting);
  const t = rare === 'mcherry' ? 'm' : rare === 'kakutei' || rare === 'kcherry' ? 'k' : rare === 'suika' ? 's' : rare === 'cherry' ? 'c' : 'o';
  switch (mode) {
    case 'A':
      if (t === 'm') return row(TDS, [75, 24.22, 0.78]);
      if (t === 'k') return row(ABTD, [45.31, 25, 25, 4.69]);
      return row(ABTD, (t === 's' ? A_SUIKA : A_OTHER)[i]);
    case 'B':
      if (t === 'm') return row(TDS, [50, 49.22, 0.78]);
      if (t === 'k') return row(BTD, [25, 50, 25]);
      return row(BTD, (t === 's' ? B_SUIKA : B_OTHER)[i]);
    case 'HK':
      if (t === 'm') return row(TDS, [75, 24.22, 0.78]);
      if (t === 'k') return row(BTD, [50, 45.31, 4.69]);
      return row(ABTD, (t === 's' ? HK_SUIKA : HK_OTHER)[i]);
    case 'CH':
      if (t === 'm') return row(TDS, [50, 42.19, 7.81]);
      if (t === 'k') return row(['B', 'TEN', 'DD', 'SDD'], [25, 65.63, 7.03, 2.34]);
      if (t === 's') return row(['B', 'TEN', 'DD', 'SDD'], [65.63, 31.25, 2.34, 0.78]);
      return row(['B', 'TEN', 'DD', 'SDD'], [82.81, 15.63, 1.17, 0.39]);
    case 'HO':
      if (t === 'm') return row(TDS, [75, 24.22, 0.78]);
      if (t === 'k') return row(['HO', 'TEN', 'DD'], [75, 22.66, 2.34]);
      if (t === 's') return row(['HO', 'TEN', 'DD'], [91.41, 7.81, 0.78]);
      if (t === 'c') return row(['HO', 'TEN', 'DD'], [95.7, 3.91, 0.39]);
      return row(['A', 'B', 'HK', 'TEN', 'DD'], [65.23, 10.16, 20.31, 3.91, 0.39]);
    case 'TEN':
      if (t === 'm') return [['DD', 100]];
      if (t === 'k') return row(['TEN', 'DD'], [93.75, 6.25]);
      if (t === 's') return row(['TEN', 'DD'], [98.44, 1.56]);
      if (t === 'c') return row(['TEN', 'DD'], [99.22, 0.78]);
      // 天国に残りやすいのは奇数設定、落ちたとき引き戻しに行きやすいのは偶数設定
      return row(['A', 'B', 'HK', 'TEN', 'DD'], setting % 2 === 1 ? [13.28, 3.91, 7.81, 74.22, 0.78] : [13.28, 3.91, 17.19, 64.84, 0.78]);
    case 'DD':
      if (t === 'm') return [['SDD', 100]];
      if (t === 'k') return row(['DD', 'SDD'], [96.88, 3.13]);
      if (t === 's') return row(['DD', 'SDD'], [99.22, 0.78]);
      if (t === 'c') return row(['DD', 'SDD'], [99.61, 0.39]);
      return row(['HO', 'DD', 'SDD'], [17.97, 81.64, 0.39]);
    case 'SDD':
      if (t === 'o') return row(['HO', 'SDD'], [9.38, 90.63]);
      return [['SDD', 100]];
  }
}

/** チャンス・引き戻しの規定ゲーム数（100〜143G が各 0.78、144〜199G が各 1.17） */
const SHORT_CEIL: [number, number][] = Array.from({ length: 100 }, (_, k): [number, number] => [100 + k, 100 + k < 144 ? 0.78 : 1.17]);
/**
 * モードに入ったときの天井（このゲーム数目に当たる）。規定ゲーム数の次のゲームなので +1。
 * 保障以上は 1/8 で 0（＝今のボーナスの後に 1G連）、ほかは 32G
 */
export function ceilingOf(mode: Mode, rnd: () => number): number {
  if (isHeaven(mode)) return rnd() < ZERO_G ? 0 : 32;
  if (mode === 'CH' || mode === 'HK') return pick(rnd, SHORT_CEIL) + 1;
  return 1000;
}

/** 小役。r は 0 以上 DENOM 未満。nav = ナビがある（ボーナス中）。通常時の押し順ベルは取りこぼし */
export function drawRole(setting: number, r: number, nav = false): Role {
  const cb = CBELL_N[setting] ?? CBELL_N[1];
  const table: [Role, number][] = [
    ['replay', ROLE_N.replay], ['bell', ROLE_N.bells - cb], ['cbell', cb], ['cherry', ROLE_N.cherry],
    ['suika', ROLE_N.suika], ['kakutei', ROLE_N.kakutei], ['kcherry', ROLE_N.kcherry], ['mcherry', ROLE_N.mcherry],
  ];
  let acc = 0;
  for (const [role, n] of table) {
    acc += n;
    if (r < acc) return role !== 'bell' || nav ? role : r - (acc - n) < KOBOSHI_N ? 'koboshi' : 'bell_miss';
  }
  return nav ? 'bell' : 'bell_miss';
}

/** 次のモードから、ハイビスカスの光り方を選ぶ */
export function patternFor(next: Mode, rnd: () => number): Pattern {
  const W: Record<Mode, [Pattern, number][]> = {
    A: [['normal', 90], ['fast', 5], ['slow', 5]],
    CH: [['normal', 84], ['fast', 8], ['slow', 8]],
    HK: [['normal', 84], ['fast', 8], ['slow', 8]],
    B: [['normal', 70], ['fast', 10], ['slow', 10], ['sync', 10]],
    TEN: [['normal', 55], ['fast', 8], ['slow', 8], ['sync', 8], ['b337', 12], ['right', 6], ['panel', 3]],
    HO: [['normal', 55], ['fast', 8], ['slow', 8], ['sync', 8], ['b337', 12], ['right', 6], ['panel', 3]],
    DD: [['normal', 45], ['sync', 5], ['b337', 10], ['right', 10], ['panel', 5], ['left', 15], ['reverse', 10]],
    SDD: [['normal', 30], ['left', 10], ['reverse', 10], ['doki', 30], ['shidare', 20]],
  };
  return pick(rnd, W[next]);
}

/** フリーズ以外のプレミア演出（ふつうは null） */
export function premiumFor(t: Trigger, kind: Kind, rnd: () => number): Premium | null {
  if (rnd() < delayRate(t)) return 'delay';
  if ((t === 'kakutei' || t === 'kcherry') && rnd() < 0.5) return 'flash';
  const r = rnd();
  if (r < 0.03) return 'senchika';
  if (r < 0.05 && kind === 'big') return 'silent';
  return null;
}

/** 当たったときの中身。next は次のモード、later は次のゲームで告知する */
export type Hit = { kind: Kind; next: Mode; pattern: Pattern; premium: Premium | null; lamp: 'pre' | 'post'; later: boolean };
export function drawHit(mode: Mode, setting: number, t: Trigger, rnd: () => number): Hit {
  const freeze = rnd() < freezeRate(t);
  const kind: Kind = freeze || rnd() < bigShare(setting, mode, t) ? 'big' : 'reg';
  const next: Mode = freeze ? 'SDD' : pick(rnd, transition(mode, setting, t === 'ceil' ? 'none' : t));
  const pattern = patternFor(next, rnd);
  const premium: Premium | null = freeze ? 'freeze' : premiumFor(t, kind, rnd);
  const lamp = premium === 'delay' || premium === 'senchika' ? 'pre' : premium ? 'post' : rnd() < PRE_NOTICE_RATE ? 'pre' : 'post';
  const later = t !== 'ceil' && (RARE.has(t as Role) || rnd() < 0.5);
  return { kind, next, pattern, premium, lamp, later };
}

/** ボーナス中の1ゲーム。nav はナビの押し順（0〜5。押し順ベルのときだけ）、stock はこのゲームで 1G連 に当たった */
export type AtGame = { role: Role; nav: number | null; stock: boolean };

/** ボーナス（AT）のゲームをまとめて決める。押し順ベルはナビどおりに揃う前提 */
export function drawAt(setting: number, kind: Kind, rnd: () => number): { games: AtGame[]; pay: number; stock: number; bells: number } {
  const games: AtGame[] = [];
  let pay = 0, stock = 0, bells = 0;
  for (let i = 0; i < AT_GAMES[kind]; i++) {
    const role = drawRole(setting, Math.floor(rnd() * DENOM), true);
    const s = SURE.has(role) || (role === 'cherry' && rnd() < STOCK_P.cherry) || (role === 'suika' && rnd() < STOCK_P.suika);
    const nav = role === 'bell' ? Math.floor(rnd() * 6) : null;
    if (role === 'bell') bells++;
    if (s) stock++;
    pay += PAYOUT[role];
    games.push({ role, nav, stock: s });
  }
  return { games, pay, stock, bells };
}

/**
 * ボーナスを揃えた後のモードと天井。ボーナス中の確定系の役はモードの昇格を抽選し、
 * 天井が 0G なら 1G連 を1つ足して（ゲーム数当選として）次のモードを決める
 */
export function afterBonus(mode: Mode, ceil: number, games: AtGame[], setting: number, rnd: () => number): { mode: Mode; ceil: number; zero: boolean } {
  for (const g of games) {
    if (!SURE.has(g.role)) continue;
    const m = pick(rnd, transition(mode, setting, g.role));
    if (m !== mode) { mode = m; ceil = ceilingOf(m, rnd); }
  }
  if (ceil !== 0) return { mode, ceil, zero: false };
  const m = pick(rnd, transition(mode, setting, 'none'));
  return { mode: m, ceil: ceilingOf(m, rnd), zero: true };
}

/**
 * 理論値（マルコフ連鎖で解く）。「通常時を打ち始めるときのモード」を状態にして、当たるまでのゲーム数・当たった役・
 * ボーナス（1G連・0G・ボーナス中の昇格込み）を経て次の状態へ移る連鎖の定常分布から、機械割・確率を出す。3枚掛け・ナビどおりに打つ前提
 */
export function analyze(setting: number) {
  const MODES: Mode[] = ['A', 'B', 'CH', 'HK', 'HO', 'TEN', 'DD', 'SDD'];
  const cb = CBELL_N[setting];
  const p: Record<Role, number> = {
    replay: ROLE_N.replay / DENOM, bell: 0, bell_miss: (ROLE_N.bells - cb - KOBOSHI_N) / DENOM, koboshi: KOBOSHI_N / DENOM, cbell: cb / DENOM,
    cherry: ROLE_N.cherry / DENOM, suika: ROLE_N.suika / DENOM, kakutei: ROLE_N.kakutei / DENOM, kcherry: ROLE_N.kcherry / DENOM,
    mcherry: ROLE_N.mcherry / DENOM, none: 0,
  };
  const roles = (Object.keys(p) as Role[]).filter((r) => p[r] > 0);
  const normalRet = roles.reduce((a, r) => a + p[r] * PAYOUT[r], 0);
  const atRet = normalRet + p.bell_miss * PAYOUT.bell + p.koboshi * (PAYOUT.bell - PAYOUT.koboshi);
  const pSure = p.kakutei + p.kcherry + p.mcherry;
  const sRate = p.cherry * STOCK_P.cherry + p.suika * STOCK_P.suika + pSure;
  // ボーナス1回（とそこから続く 1G連）の回数・コイン。揃えるゲームも 3枚
  const chain = (k: Kind) => {
    const n = 1 + (AT_GAMES[k] * sRate) / (1 - AT_GAMES.big * sRate);
    const big = (k === 'big' ? 1 : 0) + (n - 1);
    return { n, big, cin: AT_GAMES.big * 0 + (n - 1) * (BET + AT_GAMES.big * BET) + BET + AT_GAMES[k] * BET,
      cout: (n - 1) * AT_GAMES.big * atRet + AT_GAMES[k] * atRet, games: (n - 1) * AT_GAMES.big + AT_GAMES[k] };
  };
  const vec = () => Object.fromEntries(MODES.map((m) => [m, 0])) as Record<Mode, number>;
  const T = (m: Mode, r: Role) => { const w = transition(m, setting, r); const s = w.reduce((a, [, n]) => a + n, 0); const v = vec(); for (const [x, n] of w) v[x] += n / s; return v; };
  // ボーナス中の確定系の役での昇格（ゲーム数 g のボーナス）
  const U = (x: Mode, g: number) => {
    const q = g * pSure, v = vec();
    v[x] += 1 - q;
    for (const [r, w] of [['kakutei', p.kakutei + p.kcherry], ['mcherry', p.mcherry]] as [Role, number][]) {
      const t = T(x, r);
      for (const m of MODES) v[m] += (q * w) / pSure * t[m];
    }
    return v;
  };
  // 0G（1G連）を解く：D[y] = ボーナス後のモード y から、通常時を打ち始めるモードの分布と、そのあいだの BIG（連鎖ごと）の数
  const cBig = chain('big');
  let D = Object.fromEntries(MODES.map((m) => [m, { to: { ...vec(), [m]: 1 }, extra: 0 }])) as Record<Mode, { to: Record<Mode, number>; extra: number }>;
  for (let it = 0; it < 200; it++) {
    const nd = {} as typeof D;
    for (const y of MODES) {
      if (!isHeaven(y)) { nd[y] = { to: { ...vec(), [y]: 1 }, extra: 0 }; continue; }
      const to = vec(); to[y] += 1 - ZERO_G;
      let extra = ZERO_G;
      const z = T(y, 'none');
      for (const zm of MODES) {
        if (!z[zm]) continue;
        const u = U(zm, cBig.games);
        for (const w of MODES) {
          if (!u[w]) continue;
          const f = ZERO_G * z[zm] * u[w];
          for (const m of MODES) to[m] += f * D[w].to[m];
          extra += f * D[w].extra;
        }
      }
      nd[y] = { to, extra };
    }
    D = nd;
  }
  // 通常時（モード n から当たるまで）
  const ceilDist = (m: Mode): [number, number][] => isHeaven(m) ? [[32, 1]] : m === 'CH' || m === 'HK'
    ? SHORT_CEIL.map(([g, w]): [number, number] => [g + 1, w / SHORT_CEIL.reduce((a, [, x]) => a + x, 0)]) : [[1000, 1]];
  type Seg = { games: number; cin: number; cout: number; bonus: number; big: number; to: Record<Mode, number> };
  const seg = {} as Record<Mode, Seg>;
  for (const n of MODES) {
    const h = roles.reduce((a, r) => a + p[r] * hitChance(setting, r, n), 0);
    const trig = new Map<Trigger, number>();
    let E = 0;
    for (const [C, w] of ceilDist(n)) {
      let surv = 1;
      for (let k = 1; k <= C; k++) {
        E += w * surv;
        for (const r of roles) trig.set(r, (trig.get(r) ?? 0) + w * surv * p[r] * hitChance(setting, r, n));
        surv *= 1 - h;
      }
      trig.set('ceil', (trig.get('ceil') ?? 0) + w * surv);
    }
    const s: Seg = { games: E, cin: E * BET, cout: E * normalRet, bonus: 0, big: 0, to: vec() };
    for (const [t, pt] of trig) {
      if (!pt) continue;
      const fz = freezeRate(t);
      const later = t === 'ceil' ? 0 : RARE.has(t as Role) ? 1 : 0.5;
      s.games += pt * later; s.cin += pt * later * BET; s.cout += pt * later * normalRet;
      const pb = fz + (1 - fz) * bigShare(setting, n, t);
      const tr = T(n, t === 'ceil' ? 'none' : t);
      for (const [k, pk] of [['big', pb], ['reg', 1 - pb]] as [Kind, number][]) {
        if (!pk) continue;
        const c = chain(k);
        s.bonus += pt * pk * c.n; s.big += pt * pk * c.big; s.cin += pt * pk * c.cin; s.cout += pt * pk * c.cout;
        for (const x of MODES) {
          const px = (k === 'big' ? fz / pb : 0) * (x === 'SDD' ? 1 : 0) + (1 - (k === 'big' ? fz / pb : 0)) * tr[x];
          if (!px) continue;
          const u = U(x, c.games);
          for (const y of MODES) {
            if (!u[y]) continue;
            const f = pt * pk * px * u[y];
            const e = D[y].extra;
            s.bonus += f * e * cBig.n; s.big += f * e * cBig.big; s.cin += f * e * cBig.cin; s.cout += f * e * cBig.cout;
            for (const m of MODES) s.to[m] += f * D[y].to[m];
          }
        }
      }
    }
    seg[n] = s;
  }
  let pi = Object.fromEntries(MODES.map((m) => [m, 1 / MODES.length])) as Record<Mode, number>;
  for (let it = 0; it < 3000; it++) {
    const nx = vec();
    for (const a of MODES) for (const b of MODES) nx[b] += pi[a] * seg[a].to[b];
    pi = nx;
  }
  let games = 0, cin = 0, cout = 0, bonus = 0, big = 0, heaven = 0;
  for (const m of MODES) {
    games += pi[m] * seg[m].games; cin += pi[m] * seg[m].cin; cout += pi[m] * seg[m].cout;
    bonus += pi[m] * seg[m].bonus; big += pi[m] * seg[m].big;
    if (isHeaven(m)) heaven += pi[m];
  }
  return {
    rate: cout / cin, sum: games / bonus, big: games / big, reg: games / (bonus - big),
    heaven, coin50: 50 / (BET - normalRet), cbell: DENOM / cb,
  };
}

/** 押し順（0〜5）→ 止める順（リールの番号の並び） */
export const ORDERS: number[][] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

export function jstDay(nowMs: number): string {
  return new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 10);
}
export function jstWeekStart(nowMs: number): string {
  const d = new Date(nowMs + 9 * 3600_000);
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10);
}
export function cryptoRandom(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

/** 設定の配り方（台1〜12 の設定）。rnd を1回だけ引いて種にし、SETTINGS を混ぜる（Fisher-Yates。ぱびゅらーと同じ） */
export function shuffleSettings(rnd: () => number): number[] {
  let seed = Math.floor(rnd() * 2 ** 32) >>> 0;
  const next = () => { // mulberry32
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  const a: number[] = [...SETTINGS];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const SETTINGS_KEY = [...SETTINGS].sort().join(',');
/** doki_week.settings を読む。今の台数・配り方と合わなければ null */
export function settingsOf(v: string | null | undefined): number[] | null {
  const list = String(v ?? '').split(',').map(Number);
  return list.length === MACHINES.length && [...list].sort().join(',') === SETTINGS_KEY ? list : null;
}

// ---- D1 ----

export interface DokiDb {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
}

export async function weekSettings(db: DokiDb, nowMs: number, rnd: () => number): Promise<number[]> {
  const week = jstWeekStart(nowMs);
  await db.prepare('INSERT OR IGNORE INTO doki_week (week, settings, created_at) VALUES (?, ?, ?)')
    .bind(week, shuffleSettings(rnd).join(','), new Date(nowMs).toISOString()).run();
  const row = await db.prepare('SELECT settings FROM doki_week WHERE week = ?').bind(week).first<{ settings: string }>();
  return settingsOf(row?.settings) ?? MACHINES.map(() => 1);
}

function machineOf(v: unknown): number {
  return MACHINES.includes(v as 1) ? (v as number) : 1;
}
function modeOf(v: unknown): Mode | null {
  return ['A', 'B', 'CH', 'HK', 'TEN', 'DD', 'SDD', 'HO'].includes(String(v)) ? (v as Mode) : null;
}
function kindOf(v: unknown): Kind | null {
  return v === 'big' || v === 'reg' ? v : null;
}

interface MState {
  week: string; mode: string; games: number; ceil: number; pending: string | null; stock: number;
  since: number; chain: number; can_align: number;
  /** 次のゲームで告知する当たりの光り方（'pre|normal|freeze' の形）。告知するまでは pending を画面に出さない */
  notice: string | null;
}
const MSTATE_COLS = 'week, mode, games, ceil, pending, stock, since, chain, can_align, notice';

/** その人のその台の状態。無いか週が変わっていれば、設定変更として選び直す */
async function mstate(db: DokiDb, discordId: string, machine: number, week: string, rnd: () => number): Promise<MState> {
  const row = await db.prepare(`SELECT ${MSTATE_COLS} FROM doki_mstate WHERE discord_id = ? AND machine = ?`)
    .bind(discordId, machine).first<MState>();
  if (row && row.week === week && modeOf(row.mode)) return row;
  const mode = pick(rnd, RESET_MODES);
  return {
    week, mode, games: 0, ceil: ceilingOf(mode, rnd),
    // 週をまたいでランプが光ったままなら、そのボーナスは持ち越す
    pending: kindOf(row?.pending), stock: row?.stock ?? 0, since: row?.since ?? 0, chain: 0, can_align: row?.can_align ?? 0,
    notice: kindOf(row?.pending) ? row?.notice ?? null : null,
  };
}

function saveMState(db: DokiDb, discordId: string, machine: number, s: MState, nowIso: string) {
  return db.prepare(
    `INSERT INTO doki_mstate (discord_id, machine, week, mode, games, ceil, pending, stock, since, chain, can_align, notice, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(discord_id, machine) DO UPDATE SET week = excluded.week, mode = excluded.mode, games = excluded.games,
       ceil = excluded.ceil, pending = excluded.pending, stock = excluded.stock, since = excluded.since, chain = excluded.chain,
       can_align = excluded.can_align, notice = excluded.notice, updated_at = excluded.updated_at`,
  ).bind(discordId, machine, s.week, s.mode, s.games, s.ceil, s.pending, s.stock, s.since, s.chain, s.can_align, s.notice, nowIso);
}

type Today = { games: number; diff: number; big: number; reg: number; cbell: number };
interface DailyRow { games: number; coin_in: number; coin_out: number; big: number; reg: number; cbell: number; graph: string }
const EMPTY_DAY: DailyRow = { games: 0, coin_in: 0, coin_out: 0, big: 0, reg: 0, cbell: 0, graph: '[]' };
const todayOf = (d: DailyRow): Today => ({ games: d.games, diff: d.coin_out - d.coin_in, big: d.big, reg: d.reg, cbell: d.cbell });
async function dayRow(db: DokiDb, discordId: string, day: string): Promise<DailyRow> {
  return (await db.prepare('SELECT games, coin_in, coin_out, big, reg, cbell, graph FROM doki_daily WHERE discord_id = ? AND day = ?')
    .bind(discordId, day).first<DailyRow>()) ?? { ...EMPTY_DAY };
}
async function seatOf(db: DokiDb, discordId: string): Promise<number> {
  return machineOf(await db.prepare('SELECT machine FROM doki_seat WHERE discord_id = ?').bind(discordId).first<number>('machine'));
}

export type SpinResult =
  | { ok: false; reason: 'insufficient' | 'limit' | 'in_bonus' }
  | {
    ok: true; machine: number; role: Role; pay: number;
    /** このゲームでハイビスカスが光る（'pre' = レバーで、'post' = 第3リールの後） */
    lamp: 'pre' | 'post' | null;
    pattern: Pattern | null; premium: Premium | null;
    /** 光っているボーナス（揃えるまで続く。次のゲームで告知する当たりはまだ出さない） */
    pending: Kind | null;
    /** このゲームで 7 を狙えば揃う */
    canAlign: boolean;
    since: number; today: Today;
  };

/** 1回転（3枚掛け）。availableOf は使えるポイント（スロットの収支込み）を返す関数 */
export async function spin(db: DokiDb, discordId: string, nowMs: number, availableOf: (id: string) => Promise<number>, rnd: () => number = cryptoRandom): Promise<SpinResult> {
  const nowIso = new Date(nowMs).toISOString();
  const day = jstDay(nowMs);
  const week = jstWeekStart(nowMs);
  // 席の行（いま座っている台・ボーナス中のベルの数）を先に作っておく
  await db.prepare('INSERT OR IGNORE INTO doki_seat (discord_id, machine, updated_at) VALUES (?, 1, ?)').bind(discordId, nowIso).run();
  const [settings, machine, d, available] = await Promise.all([
    weekSettings(db, nowMs, rnd), seatOf(db, discordId), dayRow(db, discordId, day), availableOf(discordId),
  ]);
  if (available < BET * COIN_PT) return { ok: false, reason: 'insufficient' };
  if (d.games >= DAILY_GAME_LIMIT) return { ok: false, reason: 'limit' };
  const setting = settings[machine - 1] ?? 1;
  const s = await mstate(db, discordId, machine, week, rnd);
  const mode = modeOf(s.mode)!;
  const pendingBefore = kindOf(s.pending);

  let role: Role;
  let lamp: 'pre' | 'post' | null = null;
  let pattern: Pattern | null = null;
  let premium: Premium | null = null;
  let pending = pendingBefore;
  if (pendingBefore && !s.notice) {
    // 光っているあいだは抽選しない。小役なしのゲームで 7 を狙う
    role = 'none';
    s.can_align = 1;
  } else if (pendingBefore && s.notice) {
    // 次ゲーム告知：役はふつうに引く（抽選はしない）。ここでハイビスカスが光り、次のゲームで揃える
    role = drawRole(setting, Math.floor(rnd() * DENOM));
    const [l, pt, pr] = s.notice.split('|');
    lamp = l === 'pre' ? 'pre' : 'post';
    pattern = (pt || 'normal') as Pattern;
    premium = (pr || null) as Premium | null;
    s.notice = null;
    s.can_align = 0;
  } else {
    s.games += 1;
    role = drawRole(setting, Math.floor(rnd() * DENOM));
    const won = rnd() < hitChance(setting, role, mode);
    if (won || s.games >= s.ceil) {
      const h = drawHit(mode, setting, won ? role : 'ceil', rnd);
      s.pending = h.kind;
      s.since = s.games;
      s.mode = h.next;
      s.ceil = ceilingOf(h.next, rnd);
      s.games = 0;
      if (h.later) {
        s.notice = `${h.lamp}|${h.pattern}|${h.premium ?? ''}`;
        pending = null;
      } else {
        lamp = h.lamp; pattern = h.pattern; premium = h.premium;
        pending = h.kind;
      }
    }
    s.can_align = 0;
  }
  const pay = PAYOUT[role];
  const games = d.games + 1;
  const diff = d.coin_out + pay - (d.coin_in + BET);
  let graph: number[] = [];
  try { graph = JSON.parse(d.graph); } catch { graph = []; }
  if (games % GRAPH_EVERY === 0) graph.push(diff);
  const cb = role === 'cbell' ? 1 : 0;
  const net = pay - BET;
  await db.batch([
    saveMState(db, discordId, machine, s, nowIso),
    db.prepare(
      `INSERT INTO doki_daily (discord_id, day, games, coin_in, coin_out, cbell, graph, pt_net) VALUES (?, ?, 1, ?, ?, ?, ?, ?)
       ON CONFLICT(discord_id, day) DO UPDATE SET games = games + 1, coin_in = coin_in + excluded.coin_in,
         coin_out = coin_out + excluded.coin_out, cbell = cbell + excluded.cbell, graph = excluded.graph, pt_net = pt_net + excluded.pt_net`,
    ).bind(discordId, day, BET, pay, cb, JSON.stringify(graph), net * COIN_PT),
    db.prepare(
      `INSERT INTO doki_machine_daily (day, machine, discord_id, games, cbell, diff) VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(day, machine, discord_id) DO UPDATE SET games = games + 1, cbell = cbell + excluded.cbell, diff = diff + excluded.diff,
         graph = CASE WHEN (games + 1) % ? = 0 THEN json_insert(graph, '$[#]', diff + excluded.diff) ELSE graph END`,
    ).bind(day, machine, discordId, cb, net, GRAPH_EVERY),
    db.prepare(
      `INSERT INTO doki_machine_day (day, machine, games, diff, cbell, since) VALUES (?, ?, 1, ?, ?, 1)
       ON CONFLICT(day, machine) DO UPDATE SET games = games + 1, diff = diff + excluded.diff, cbell = cbell + excluded.cbell, since = since + 1,
         graph = CASE WHEN (games + 1) % ? = 0 THEN json_insert(graph, '$[#]', diff + excluded.diff) ELSE graph END`,
    ).bind(day, machine, net, cb, GRAPH_EVERY),
  ]);
  return {
    ok: true, machine, role, pay, lamp, pattern, premium, pending, canAlign: !!pendingBefore && role === 'none',
    since: pending || s.notice ? s.since : s.games,
    today: { ...todayOf(d), games, diff, cbell: d.cbell + cb },
  };
}

/**
 * 7 が揃った。直前のゲームが「光っていて小役なし」のときだけ（2回来ても1回だけ）。
 * ボーナス中のゲームをまとめて決め、ナビどおりに打った純増をここで足す。1G連があれば、次のボーナスを光らせておく
 */
export async function align(db: DokiDb, discordId: string, nowMs: number, rnd: () => number = cryptoRandom)
  : Promise<{ ok: false; reason: 'not_ready' } | {
    ok: true; kind: Kind; games: AtGame[]; net: number; since: number; chain: number; stock: number; next: Kind | null;
    machine: number; msince: number; today: Today;
  }> {
  const nowIso = new Date(nowMs).toISOString();
  const week = jstWeekStart(nowMs);
  const machine = await seatOf(db, discordId);
  const s = await db.prepare(`SELECT ${MSTATE_COLS} FROM doki_mstate WHERE discord_id = ? AND machine = ? AND can_align = 1`)
    .bind(discordId, machine).first<MState>();
  const kind = kindOf(s?.pending);
  if (!s || !kind) return { ok: false, reason: 'not_ready' };
  const r = await db.prepare('UPDATE doki_mstate SET can_align = 0, pending = NULL WHERE discord_id = ? AND machine = ? AND can_align = 1 AND pending = ?')
    .bind(discordId, machine, kind).run();
  if ((r.meta?.changes ?? 0) !== 1) return { ok: false, reason: 'not_ready' };
  const settings = await weekSettings(db, nowMs, rnd);
  const setting = settings[machine - 1] ?? 1;
  const at = drawAt(setting, kind, rnd);
  const net = at.pay - BET * AT_GAMES[kind];
  // ボーナス中の確定系の役でモードの昇格。天井が 0G なら 1G連 を足す（押し順ベルのゲームでしなのちゃんランプが光る）
  const after = afterBonus(modeOf(s.mode) ?? 'A', s.ceil, at.games, setting, rnd);
  if (after.zero) {
    const free = at.games.map((g, i) => (!g.stock && (g.role === 'bell' || g.role === 'replay') ? i : -1)).filter((i) => i >= 0);
    const i = free.length ? free[Math.floor(rnd() * free.length)] : at.games.length - 1;
    at.games[i] = { ...at.games[i], stock: true };
  }
  // 1G連：ストックがあれば次のボーナス（BIG）をすぐ光らせる
  const stock = s.stock + at.stock + (after.zero ? 1 : 0);
  const next: Kind | null = stock > 0 ? 'big' : null;
  // 連チャン：前のボーナスから 32G 以内なら続き（1G連も続き）
  const chain = s.since <= 32 && s.chain > 0 ? s.chain + 1 : 1;
  const st: MState = {
    ...s, week: s.week || week, mode: after.mode, ceil: after.ceil, pending: next, stock: next ? stock - 1 : 0, chain,
    can_align: next ? 1 : 0, since: next ? 0 : s.since, notice: null,
  };
  const day = jstDay(nowMs);
  const [d, msince] = await Promise.all([
    dayRow(db, discordId, day),
    db.prepare('SELECT since FROM doki_machine_day WHERE day = ? AND machine = ?').bind(day, machine).first<number>('since'),
  ]);
  const big = kind === 'big' ? 1 : 0, reg = kind === 'reg' ? 1 : 0;
  await db.batch([
    saveMState(db, discordId, machine, st, nowIso),
    db.prepare('UPDATE doki_seat SET at_bells = ?, at_day = ? WHERE discord_id = ?').bind(at.bells, day, discordId),
    db.prepare(
      `INSERT INTO doki_daily (discord_id, day, coin_out, big, reg, pt_net, graph) VALUES (?, ?, ?, ?, ?, ?, '[]')
       ON CONFLICT(discord_id, day) DO UPDATE SET coin_out = coin_out + excluded.coin_out, big = big + excluded.big,
         reg = reg + excluded.reg, pt_net = pt_net + excluded.pt_net`,
    ).bind(discordId, day, net, big, reg, net * COIN_PT),
    db.prepare('INSERT INTO doki_bonus (discord_id, day, machine, kind, since, chain, game, msince, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(discordId, day, machine, kind, s.since, chain, d.games, msince ?? 0, nowIso),
    db.prepare(
      `INSERT INTO doki_machine_daily (day, machine, discord_id, big, reg, diff) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(day, machine, discord_id) DO UPDATE SET big = big + excluded.big, reg = reg + excluded.reg, diff = diff + excluded.diff`,
    ).bind(day, machine, discordId, big, reg, net),
    db.prepare(
      `INSERT INTO doki_machine_day (day, machine, big, reg, diff) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(day, machine) DO UPDATE SET big = big + excluded.big, reg = reg + excluded.reg, diff = diff + excluded.diff, since = 0`,
    ).bind(day, machine, big, reg, net),
  ]);
  const t = todayOf(d);
  return {
    ok: true, kind, games: at.games, net, since: s.since, chain, stock: st.stock, next, machine, msince: msince ?? 0,
    today: { ...t, diff: t.diff + net, big: t.big + big, reg: t.reg + reg },
  };
}

/** ボーナス中にナビを外したベル（n 個）。揃ったぶんで足していたので、取りこぼし（0枚）との差（7枚ずつ）を戻す */
export async function miss(db: DokiDb, discordId: string, n: number): Promise<{ ok: false; reason: 'nothing' } | { ok: true; back: number }> {
  const k = Math.max(0, Math.min(70, Math.floor(n)));
  const st = await db.prepare('SELECT at_bells, at_day, machine FROM doki_seat WHERE discord_id = ?')
    .bind(discordId).first<{ at_bells: number; at_day: string | null; machine: number }>();
  if (!st || !st.at_day || k === 0 || st.at_bells <= 0) return { ok: false, reason: 'nothing' };
  const take = Math.min(k, st.at_bells);
  const r = await db.prepare('UPDATE doki_seat SET at_bells = at_bells - ? WHERE discord_id = ? AND at_bells >= ?').bind(take, discordId, take).run();
  if ((r.meta?.changes ?? 0) !== 1) return { ok: false, reason: 'nothing' };
  const back = take * (PAYOUT.bell - PAYOUT.bell_miss);
  const machine = machineOf(st.machine);
  await db.batch([
    db.prepare('UPDATE doki_daily SET coin_out = coin_out - ?, pt_net = pt_net - ? WHERE discord_id = ? AND day = ?')
      .bind(back, back * COIN_PT, discordId, st.at_day),
    db.prepare('UPDATE doki_machine_daily SET diff = diff - ? WHERE day = ? AND machine = ? AND discord_id = ?').bind(back, st.at_day, machine, discordId),
    db.prepare('UPDATE doki_machine_day SET diff = diff - ? WHERE day = ? AND machine = ?').bind(back, st.at_day, machine),
  ]);
  return { ok: true, back };
}

/** 台を移る。ハイビスカスが光っている（揃えていない）あいだは移れない */
export async function moveMachine(db: DokiDb, discordId: string, machine: number, nowMs: number)
  : Promise<{ ok: false; reason: 'bad_machine' | 'pending' } | { ok: true; machine: number }> {
  if (!MACHINES.includes(machine as 1)) return { ok: false, reason: 'bad_machine' };
  const cur = await seatOf(db, discordId);
  const p = await db.prepare('SELECT pending, notice FROM doki_mstate WHERE discord_id = ? AND machine = ?')
    .bind(discordId, cur).first<{ pending: string | null; notice: string | null }>();
  // 次ゲーム告知を待っているあいだは移れる（台ごとに残るので、戻ってくれば告知される）
  if (kindOf(p?.pending) && !p?.notice) return { ok: false, reason: 'pending' };
  await db.prepare(
    `INSERT INTO doki_seat (discord_id, machine, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(discord_id) DO UPDATE SET machine = excluded.machine, updated_at = excluded.updated_at`,
  ).bind(discordId, machine, new Date(nowMs).toISOString()).run();
  return { ok: true, machine };
}

export type MachineTotal = { machine: number; games: number; big: number; reg: number; cbell: number; players: number };
export const MACHINE_TOTAL_SQL = `SELECT machine, SUM(games) AS games, SUM(big) AS big, SUM(reg) AS reg, SUM(cbell) AS cbell,
    COUNT(DISTINCT CASE WHEN games > 0 THEN discord_id END) AS players
  FROM doki_machine_daily WHERE day >= ? GROUP BY machine`;

export async function machineStats(db: DokiDb, nowMs: number): Promise<{ today: MachineTotal[]; week: MachineTotal[] }> {
  const q = (from: string) => db.prepare(MACHINE_TOTAL_SQL).bind(from).all<MachineTotal>();
  const [t, w] = await Promise.all([q(jstDay(nowMs)), q(jstWeekStart(nowMs))]);
  const fill = (rows: MachineTotal[] | undefined) => MACHINES.map((m) => rows?.find((x) => x.machine === m) ?? { machine: m, games: 0, big: 0, reg: 0, cbell: 0, players: 0 });
  return { today: fill(t.results), week: fill(w.results) };
}

export type Counter = { games: number; diff: number; big: number; reg: number; cbell: number; since: number | null; graph: number[] };
function graphOf(v: unknown): number[] {
  try { const g = JSON.parse(String(v ?? '[]')); return Array.isArray(g) ? g.map(Number) : []; } catch { return []; }
}

/** 台ごとのデータカウンター（今日）。自分のぶんと、みんなのぶん */
export async function machineCounters(db: DokiDb, discordId: string, nowMs: number) {
  const day = jstDay(nowMs);
  type Row = { machine: number; games: number; diff: number; big: number; reg: number; cbell: number; since?: number; graph: string };
  const [mine, all, hist] = await Promise.all([
    db.prepare('SELECT machine, games, diff, big, reg, cbell, graph FROM doki_machine_daily WHERE day = ? AND discord_id = ?').bind(day, discordId).all<Row>(),
    db.prepare('SELECT machine, games, diff, big, reg, cbell, since, graph FROM doki_machine_day WHERE day = ?').bind(day).all<Row>(),
    db.prepare('SELECT machine, kind, msince, chain, created_at FROM doki_bonus WHERE day = ? ORDER BY id DESC LIMIT 200')
      .bind(day).all<{ machine: number; kind: string; msince: number; chain: number; created_at: string }>(),
  ]);
  const toCounter = (row: Row | undefined, withSince: boolean): Counter => ({
    games: row?.games ?? 0, diff: row?.diff ?? 0, big: row?.big ?? 0, reg: row?.reg ?? 0, cbell: row?.cbell ?? 0,
    since: withSince ? (row?.since ?? 0) : null, graph: graphOf(row?.graph),
  });
  return MACHINES.map((m) => ({
    machine: m,
    mine: toCounter(mine.results?.find((x) => x.machine === m), false),
    all: toCounter(all.results?.find((x) => x.machine === m), true),
    allBonuses: (hist.results ?? []).filter((x) => x.machine === m).slice(0, 50)
      .map((x) => ({ kind: x.kind, msince: x.msince ?? 0, chain: x.chain ?? 1, created_at: x.created_at })),
  }));
}

/** 自分の台の様子（画面を開いたとき） */
export async function dokiState(db: DokiDb, discordId: string, nowMs: number) {
  const day = jstDay(nowMs);
  const machine = await seatOf(db, discordId);
  const [st, d, bonuses, days, machines, counters] = await Promise.all([
    db.prepare('SELECT week, pending, notice, games, since, chain FROM doki_mstate WHERE discord_id = ? AND machine = ?')
      .bind(discordId, machine).first<{ week: string; pending: string | null; notice: string | null; games: number; since: number; chain: number }>(),
    dayRow(db, discordId, day),
    db.prepare('SELECT kind, game, since, chain, machine, created_at FROM doki_bonus WHERE discord_id = ? AND day = ? ORDER BY id DESC LIMIT 50')
      .bind(discordId, day).all<{ kind: string; game: number; since: number; chain: number; machine: number; created_at: string }>(),
    db.prepare('SELECT day, games, coin_out - coin_in AS diff, big, reg FROM doki_daily WHERE discord_id = ? AND day < ? ORDER BY day DESC LIMIT 7')
      .bind(discordId, day).all<{ day: string; games: number; diff: number; big: number; reg: number }>(),
    machineStats(db, nowMs),
    machineCounters(db, discordId, nowMs),
  ]);
  const fresh = !st || st.week !== jstWeekStart(nowMs);
  const hidden = !!st?.notice;
  const pending = hidden ? null : kindOf(st?.pending);
  return {
    machine, pending,
    since: pending || hidden ? (st?.since ?? 0) : fresh ? 0 : (st?.games ?? 0),
    chain: fresh ? 0 : (st?.chain ?? 0),
    machines, counters, today: todayOf(d), graph: graphOf(d.graph),
    bonuses: bonuses.results ?? [], days: days.results ?? [], limit: DAILY_GAME_LIMIT,
  };
}
