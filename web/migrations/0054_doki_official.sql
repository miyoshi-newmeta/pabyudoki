-- ぱびゅドキ！を正式版にする（寮Pts と連動・12台・設定 6/5/4/4/3/3/3/2/2/1/1/1 を週替わり）。
-- テストプレイ（2026-11-16〜17、全台 設定6・テストメダル）の記録は doki_test_* に控えとして移し、正式版は 0 から数える。
CREATE TABLE IF NOT EXISTS doki_test_week AS SELECT * FROM doki_week;
CREATE TABLE IF NOT EXISTS doki_test_seat AS SELECT * FROM doki_seat;
CREATE TABLE IF NOT EXISTS doki_test_mstate AS SELECT * FROM doki_mstate;
CREATE TABLE IF NOT EXISTS doki_test_daily AS SELECT * FROM doki_daily;
CREATE TABLE IF NOT EXISTS doki_test_bonus AS SELECT * FROM doki_bonus;
CREATE TABLE IF NOT EXISTS doki_test_machine_day AS SELECT * FROM doki_machine_day;
CREATE TABLE IF NOT EXISTS doki_test_machine_daily AS SELECT * FROM doki_machine_daily;
DELETE FROM doki_week;
DELETE FROM doki_seat;
DELETE FROM doki_mstate;
DELETE FROM doki_daily;
DELETE FROM doki_bonus;
DELETE FROM doki_machine_day;
DELETE FROM doki_machine_daily;
