# netacho-app

毎朝配信される「AIネタ帳」を読むための PWA(開発中・ベータ版)。

- 開発のルール:`CLAUDE.md`
- ベータ版の依頼書:`docs/beta_brief.md`
- 見本のデータ(架空):`fixtures/`
- 本物のデータは `local-data/` に置く(git には入らない)
- 設計判断の記録:`docs/adr/`
- デザインの仕様:`docs/design_spec.md`。見本(動く試作):`docs/design_reference/nodal-prototype.html`(ブラウザーで開く)
- 画面の名前は NODAL(リポジトリ名とパッケージ名は変えない)

## 開発

Node の版は `.nvmrc` のとおり。

```sh
npm ci              # 依存パッケージを入れる
npm run dev         # 開発サーバー(オーナーが別のシェルで起動する)
npm run typecheck   # 型チェック
npm run lint        # ESLint
npm test -- --run   # 試験(Vitest)
npm run build       # 型チェック + ビルド(dist/)
node scripts/make-icons.mjs  # ロゴ(public/logo/nodal-icon.svg)から favicon と PWA のアイコンを作り直す
```
