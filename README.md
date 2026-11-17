# ぱびゅドキ！

Discord コミュニティ「ぱぶびゅ！」のダッシュボードで遊べる、沖縄テーマの AT 型スロット「ぱびゅドキ！」の一式です。
新しいスロットを作るときの土台として使えるよう、抽選のしくみ・画面・素材・テスト・解析をまとめてあります。

- 役・恩恵・モードの数値は、初代 沖ドキ！ の公開されている解析値に合わせています（[docs/okidoki-spec.md](docs/okidoki-spec.md)）
- 名前・絵柄・音・キャラクターはすべてぱびゅドキ！のオリジナルです（実機の画像・音は使っていません）

## 動かしてみる（ローカル）

Node.js 22.5 以上（24 推奨。`node:sqlite` を使います）が要ります。

```sh
cd web
npm install
npm run dev          # http://localhost:4321/doki
```

- ログインは無く、いつも同じ1人として遊べます。元手は 100,000pt です
- 遊んだ記録は `web/.local/doki.sqlite` に残ります。消せば最初からになります
- 台の設定（6・5・4・4・3・3・3・2・2・1・1・1）は毎週月曜に配り直されます

## テスト

```sh
cd poker && npm install && npm test   # 抽選・機械割・D1 まわり（SQLite で確かめる）
cd web && npm test                    # 画面側の定数が抽選側と同じか・リールの止まり方
```

## 中身

| 場所 | 中身 |
|---|---|
| `poker/src/doki.ts` | 抽選のすべて（小役・ボーナス・モード移行・天井・1G連・告知）と、DB への記録、理論値の計算（`analyze`） |
| `poker/test/doki.test.ts` | 機械割が実機に近いか、表どおりか、回しても理論値に近いか、API の流れ |
| `web/src/lib/doki.ts` | 画面側：リール配列・止め方（引き込み）・払い出し表。抽選側の定数の写し |
| `web/src/pages/doki.astro` | 画面（筐体・リール・ハイビスカス・演出・音・データカウンター） |
| `web/src/pages/api/doki/[action].ts` | ローカル用の API（本番は Cloudflare Worker が同じ形で答える） |
| `web/src/dev/localdb.ts` | ローカル用の DB（本番の D1 の代わりに SQLite） |
| `web/migrations/` | 表の定義（D1 / SQLite 共通） |
| `web/public/doki/` | 絵柄・ランプの画像、ナビの声 |
| `docs/` | 実機の解析値のまとめ、しくみの説明、新しいスロットの作り方 |

しくみの説明は [docs/architecture.md](docs/architecture.md)、新しいスロットを作るときの手順は [docs/new-slot.md](docs/new-slot.md) にあります。

## 素材について

- 絵柄・ランプの画像は、ぱびゅドキ！のために AI（OpenAI の画像生成）で作ったものです
- ナビの声（「ヒダリ！」「ナカ！」「ミギ！」）は Soniox の音声合成で作ったものです
- 効果音と BGM は、画面の中でその場で合成しています（音のファイルはありません）
- リプレイの絵柄は、同じダッシュボードのスロット「ぱびゅらー」のものを使っています

利用・改変はぱぶびゅ！のメンバーで相談しながら進めてください。

## 本番の構成（参考）

本番は Cloudflare で動いています。

- 画面：Astro（Cloudflare Pages）。`doki.astro` はローカル版と同じファイルです
- API：Cloudflare Worker。`/api/doki/state`・`spin`・`align`・`miss`・`machine` を `poker/src/doki.ts` の関数につないでいます
- DB：Cloudflare D1。使えるポイントは、ダッシュボード全体のポイント（寮Pts など）にぱびゅドキ！の収支（`doki_daily.pt_net`）を足したものです

このリポジトリには、本番の鍵・トークン・接続先は入っていません。
