# しくみ

## 1回転の流れ

```
画面（doki.astro）                        API（Worker / ローカルは api/doki/[action].ts）
  レバー ───────────── POST /api/doki/spin ──→ spin()：小役を引き、当たりを抽選、モードを移す
          ←── { role, pay, lamp, pattern, premium, pending, canAlign } ──
  役のとおりにリールを止める（web/src/lib/doki.ts の chooseStop）
  ハイビスカスが光ったら、次のゲームで 7 を狙う
  7 が揃った ───────── POST /api/doki/align ─→ align()：ボーナス（AT）の全ゲームをまとめて決め、純増を足す
          ←── { kind, games: [{ role, nav, stock }], net, next } ──
  ボーナス中は画面だけで回す（ナビ・1G連のランプ・BGM）
  ナビを外したベル ──── POST /api/doki/miss ──→ miss()：揃った前提で足したぶんを戻す
  台を移る ─────────── POST /api/doki/machine → moveMachine()
```

- **抽選はすべてサーバー**でします。画面は返ってきた役のとおりに止めるだけなので、画面をいじっても結果は変わりません
- 役の形に止めるのは画面の仕事です（`chooseStop`）。押した位置から最大4コマ滑らせて、その役の形にできる場所に止めます。ボーナスの 7 は 4コマで届かなければ揃いません（目押しが要る）
- ボーナス中のゲームは揃えたときにまとめて決めて返し、画面はそれを1つずつ見せます。純増はナビどおりに打った前提で先に足し、外したぶんを `miss` で戻します

## 抽選（poker/src/doki.ts）

| 関数 | すること |
|---|---|
| `drawRole` | 小役を引く（合わせて 65536。通常時の押し順ベルは取りこぼし） |
| `hitChance` | その役・モード・設定でボーナスに当たる確率 |
| `drawHit` | 当たったときの BIG/REG、次のモード、光り方、プレミア、告知のタイミング |
| `transition` | 「モード × 当たった役 × 設定」の移行表 |
| `ceilingOf` | 天井（規定ゲーム数） |
| `drawAt` | ボーナス中のゲームと 1G連 |
| `afterBonus` | ボーナス後のモード（ボーナス中の確定役での昇格、0G の 1G連） |
| `analyze` | 理論値（機械割・合算・BIG・REG・天国の割合・コイン持ち）をマルコフ連鎖で解く |

数値を変えたら `npm test`（poker）で機械割がずれていないか確かめます。`analyze(設定)` を呼べば、すぐに理論値が出ます。

```sh
cd poker
node --input-type=module -e "import {analyze} from './src/doki.ts'; for (let s=1;s<=6;s++) console.log(s, analyze(s))"
```

画面側の `web/src/lib/doki.ts` には、払い出し・小役の数・理論値（`SPEC`）の写しがあります。抽選側を変えたら写しも直し、`web/` の `npm test` で一致を確かめます。

## 記録（web/migrations）

| 表 | 中身 |
|---|---|
| `doki_week` | 週ごとの設定の並び（台1〜12） |
| `doki_mstate` | 人ごと・台ごとのモード・天井・光っているボーナス・1G連のストック・次ゲーム告知 |
| `doki_seat` | いま座っている台、ボーナス中のベルの数 |
| `doki_daily` | 人ごと・日ごとの回転数・差枚・BIG・REG・グラフ・ポイントの収支 |
| `doki_bonus` | ボーナスの履歴 |
| `doki_machine_day` / `doki_machine_daily` | 台ごとのデータカウンター（みんな・自分） |

## 画面（web/src/pages/doki.astro）

- 上半分（`---` の中）はサーバーで描く部分で、台ごとのデータやランキングを DB から読みます。ローカル版は DB を渡していないので空で出ます
- 下の `<script>` がブラウザで動く部分です。リール・ハイビスカスの光り方・プレミア演出・音（Web Audio で合成）・ナビの声・データカウンター
- 絵柄は `web/public/doki/sym/` の画像を SVG の `<symbol>` で使っています
