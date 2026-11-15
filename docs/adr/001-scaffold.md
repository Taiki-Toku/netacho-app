# ADR-001 ひな形の構成(ビルド・型チェック・lint・試験)

- 日付:2026-11-15
- 状態:採用(ベータ版)

## 背景
依頼書 5章の前提(React + TypeScript strict + Vite、ESLint、Vitest + Testing Library、CSS Modules)で、
CI(`.github/workflows/ci.yml`)が `tsc --noEmit` / `npm run lint` / `npm test -- --run` / `npm run build` を実行する。
2026-11-15 時点のレジストリでは、TypeScript 7、ESLint 10、Vite 8、Vitest 5 が最新で、互いに対応していない組み合わせがある。

## 選択肢と決定

| 項目 | 決定 | 理由 |
|---|---|---|
| TypeScript | 5.9.3(最新は 7.0.2) | typescript-eslint 8.72 が対応するのは 6.1 未満。型情報を使う lint を優先した |
| ESLint | 9.39.5(最新は 10.15.0) | eslint-plugin-react 7.37 と eslint-plugin-jsx-a11y 6.10 が 10 に未対応。10 では `getFilename is not a function` で止まることを確認した。ただし 9 系はレジストリで「サポート終了」と表示される(下の「見直し」) |
| Vite / Vitest | 8.3.8 / 5.1.0(最新) | Node 26(`.nvmrc`)で動く最新の組み合わせ。Vitest 5 は Vite 8 に対応 |
| tsconfig | 1つ(`src` と `vite.config.ts` を含む) | CI が `tsc --noEmit`(`-b` なし)で動くため、参照(references)方式にしない |
| Vitest の globals | 使わない | `describe` などを import で書き、型の出所を明確にする。cleanup は `src/test/setup.ts` で明示する |
| lint の方式 | flat config。typescript-eslint の型付きルール(recommendedTypeChecked)+ react + react-hooks + jsx-a11y(strict) | 依頼書とセキュリティ規約の要件。HTML を DOM に差し込む書き方は `react/no-danger` と `no-restricted-syntax`(innerHTML / outerHTML / insertAdjacentHTML / document.write)で禁止 |
| `npm run build` | `tsc --noEmit && vite build` | ビルドのたびに型チェックが走る。CI と Cloudflare Pages で同じ結果になる |

## 見直しのきっかけ
- eslint-plugin-react と eslint-plugin-jsx-a11y が ESLint 10 に対応したら、ESLint を 10 に上げる
- それまでに対応しなければ、eslint-plugin-react を外し、`dangerouslySetInnerHTML` の禁止を `no-restricted-syntax` の JSX 属性のセレクターに置き換える案を検討する(jsx-a11y は代わりがないため待つ)
- typescript-eslint が TypeScript 7 に対応したら、TypeScript を上げる
