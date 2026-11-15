# netacho-app

毎朝配信される「AIネタ帳」を読むための PWA(開発中・ベータ版)。

- 開発のルール:`CLAUDE.md`
- ベータ版の依頼書:`docs/beta_brief.md`
- 見本のデータ(架空):`fixtures/`
- 本物のデータは `local-data/` に置く(git には入らない)
- 設計判断の記録:`docs/adr/`
- デザインの方向の見本:`docs/design/direction.html`(ブラウザーで開く)

## 開発

Node の版は `.nvmrc` のとおり。

```sh
npm ci              # 依存パッケージを入れる
npm run dev         # 開発サーバー(オーナーが別のシェルで起動する)
npm run typecheck   # 型チェック
npm run lint        # ESLint
npm test -- --run   # 試験(Vitest)
npm run build       # 型チェック + ビルド(dist/)
```
