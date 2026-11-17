import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../src/lib/doki.ts';
import * as P from '../../poker/src/doki.ts';

test('定数は Worker（poker/src/doki.ts）と同じ', () => {
  assert.deepEqual(W.PAYOUT, P.PAYOUT);
  assert.deepEqual(W.AT_GAMES, P.AT_GAMES);
  assert.deepEqual(W.ORDERS, P.ORDERS);
  assert.deepEqual(W.ROLE_N, P.ROLE_N);
  assert.deepEqual(W.CBELL_N, P.CBELL_N);
  assert.equal(W.KOBOSHI_N, P.KOBOSHI_N);
  assert.deepEqual(W.HIT, P.HIT);
  assert.deepEqual([...W.MACHINES], [...P.MACHINES]);
  assert.equal(W.BET, P.BET);
  assert.equal(W.COIN_PT, P.COIN_PT);
  assert.deepEqual([...W.SETTINGS], [...P.SETTINGS]);
  for (let s = 1; s <= 6; s++) {
    const a = P.analyze(s);
    assert.ok(Math.abs(W.SPEC[s].rate - a.rate * 100) < 0.06, `設定${s} 機械割`);
    assert.ok(Math.abs(W.SPEC[s].sum - a.sum) < 0.1, `設定${s} 合算`);
    assert.ok(Math.abs(W.SPEC[s].big - a.big) < 0.1, `設定${s} BIG`);
    assert.ok(Math.abs(W.SPEC[s].reg - a.reg) < 0.1, `設定${s} REG`);
  }
});

const TARGETS: W.Target[] = ['none', 'bell_miss', 'koboshi', 'replay', 'bell', 'cbell', 'suika', 'cherry', 'mcherry', 'kcherry', 'kakutei', 'big', 'reg'];

test('どこで押しても、小役とはずれは必ずその形に止まる（押す順もばらばら）', () => {
  for (const t of TARGETS.filter((x) => x !== 'big' && x !== 'reg')) {
    for (let i = 0; i < 300; i++) {
      const tops: (number | null)[] = [null, null, null];
      for (const r of [0, 1, 2].sort(() => Math.random() - 0.5)) tops[r] = W.chooseStop(r, Math.floor(Math.random() * 21), tops, t).top;
      assert.ok(W.shows(tops as number[], t), `${t} ${tops.join(',')}`);
    }
  }
});

test('ボーナスは目押しすれば揃い、適当に押すと揃わない（そのときは何も揃わない形）', () => {
  let random = 0;
  for (const t of ['big', 'reg'] as const) {
    for (let i = 0; i < 200; i++) {
      const tops: (number | null)[] = [null, null, null];
      for (const r of [0, 1, 2]) tops[r] = W.chooseStop(r, W.aimPress(r, tops, t), tops, t).top;
      assert.ok(W.shows(tops as number[], t), `${t} aim ${tops.join(',')}`);
      const t2: (number | null)[] = [null, null, null];
      for (const r of [0, 1, 2]) t2[r] = W.chooseStop(r, Math.floor(Math.random() * 21), t2, t).top;
      if (W.shows(t2 as number[], t)) random++;
      else assert.ok(W.shows(t2 as number[], 'none'));
    }
  }
  assert.ok(random < 120, `適当に押して揃った ${random}/400`);
});

test('はずれ・小役のゲームで 7・7・7 や 7・7・BAR には止まらない', () => {
  for (const t of TARGETS.filter((x) => x !== 'big' && x !== 'reg')) {
    for (let i = 0; i < 200; i++) {
      const tops: (number | null)[] = [null, null, null];
      for (const r of [0, 1, 2]) tops[r] = W.chooseStop(r, Math.floor(Math.random() * 21), tops, t).top;
      assert.ok(!W.lineHits(tops as number[]).some((h) => h.pat === '7' || h.pat === '77B'));
    }
  }
});
