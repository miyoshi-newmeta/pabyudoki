-- スロット「ぱびゅドキ！」（沖ドキ風。poker/src/doki.ts）
-- 週ごとの設定（台1〜6 の設定を "3,6,1,5,2,4" のように台順で）
CREATE TABLE IF NOT EXISTS doki_week (
  week TEXT PRIMARY KEY,
  settings TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- 人ごとの席（いま座っている台）と、直前のボーナスで足したナビどおりのベルの数（取りこぼしを戻すため）
CREATE TABLE IF NOT EXISTS doki_seat (
  discord_id TEXT PRIMARY KEY,
  machine INTEGER NOT NULL DEFAULT 1,
  at_bells INTEGER NOT NULL DEFAULT 0,
  at_day TEXT,
  updated_at TEXT
);
-- 人ごと・台ごとのモード（週が変わると設定変更として選び直す）
CREATE TABLE IF NOT EXISTS doki_mstate (
  discord_id TEXT NOT NULL,
  machine INTEGER NOT NULL,
  week TEXT NOT NULL,
  mode TEXT NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,   -- ボーナス後の回転数
  ceil INTEGER NOT NULL DEFAULT 999,  -- このモードの天井
  pending TEXT,                       -- 光っているボーナス（big / reg）
  stock INTEGER NOT NULL DEFAULT 0,   -- 1G連のストック
  since INTEGER NOT NULL DEFAULT 0,   -- 当たったときのボーナス後の回転数
  chain INTEGER NOT NULL DEFAULT 0,   -- 連チャン（32G 以内）の数
  can_align INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT,
  PRIMARY KEY (discord_id, machine)
);
-- 人ごと・日ごとの収支（pt_net を使えるポイントに足す）
CREATE TABLE IF NOT EXISTS doki_daily (
  discord_id TEXT NOT NULL,
  day TEXT NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  coin_in INTEGER NOT NULL DEFAULT 0,
  coin_out INTEGER NOT NULL DEFAULT 0,
  big INTEGER NOT NULL DEFAULT 0,
  reg INTEGER NOT NULL DEFAULT 0,
  cbell INTEGER NOT NULL DEFAULT 0,
  graph TEXT NOT NULL DEFAULT '[]',
  pt_net INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (discord_id, day)
);
CREATE TABLE IF NOT EXISTS doki_bonus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  day TEXT NOT NULL,
  machine INTEGER NOT NULL,
  kind TEXT NOT NULL,
  since INTEGER NOT NULL DEFAULT 0,
  chain INTEGER NOT NULL DEFAULT 1,
  game INTEGER NOT NULL DEFAULT 0,
  msince INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS doki_bonus_day ON doki_bonus (day, machine);
CREATE INDEX IF NOT EXISTS doki_bonus_user ON doki_bonus (discord_id, day);
-- 台ごと・日ごとのみんなの合計
CREATE TABLE IF NOT EXISTS doki_machine_day (
  day TEXT NOT NULL,
  machine INTEGER NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  diff INTEGER NOT NULL DEFAULT 0,
  big INTEGER NOT NULL DEFAULT 0,
  reg INTEGER NOT NULL DEFAULT 0,
  cbell INTEGER NOT NULL DEFAULT 0,
  since INTEGER NOT NULL DEFAULT 0,
  graph TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (day, machine)
);
-- 台ごと・日ごと・人ごと
CREATE TABLE IF NOT EXISTS doki_machine_daily (
  day TEXT NOT NULL,
  machine INTEGER NOT NULL,
  discord_id TEXT NOT NULL,
  games INTEGER NOT NULL DEFAULT 0,
  diff INTEGER NOT NULL DEFAULT 0,
  big INTEGER NOT NULL DEFAULT 0,
  reg INTEGER NOT NULL DEFAULT 0,
  cbell INTEGER NOT NULL DEFAULT 0,
  graph TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (day, machine, discord_id)
);
