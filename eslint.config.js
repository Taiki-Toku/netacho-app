// ESLint の設定(flat config)。
// 役割:TypeScript の基本チェックに加えて、React / React Hooks / jsx-a11y(アクセシビリティ)の
// 推奨ルールと、このプロジェクトのセキュリティ規約(HTML を直接差し込む書き方の禁止)を適用する。
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'

// 「HTML 文字列を DOM に差し込む」書き方を、構文の形で禁止する(CLAUDE.md のセキュリティ規約)。
// react/no-danger が dangerouslySetInnerHTML を、ここでは素の DOM API を止める。
const forbiddenHtmlSinks = [
  {
    selector: "MemberExpression[property.name='innerHTML'], MemberExpression[property.value='innerHTML']",
    message: 'innerHTML は使わない(XSS の原因になる)。React の描画でテキストとして表示する。',
  },
  {
    selector: "MemberExpression[property.name='outerHTML'], MemberExpression[property.value='outerHTML']",
    message: 'outerHTML は使わない(XSS の原因になる)。',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'insertAdjacentHTML は使わない(XSS の原因になる)。',
  },
  {
    selector: "CallExpression[callee.object.name='document'][callee.property.name=/^write(ln)?$/]",
    message: 'document.write は使わない(XSS の原因になる)。',
  },
]

export default tseslint.config(
  {
    // 生成物・外部・本物のデータは対象外
    ignores: ['dist', 'node_modules', 'coverage', '.tmp', 'local-data'],
  },
  js.configs.recommended,
  // TypeScript の型情報を使うルール(await 忘れなどを検出できる)
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  reactHooks.configs.flat.recommended,
  jsxA11y.flatConfigs.strict,
  {
    // eslint-plugin-react に React の版を伝える(全ファイル共通)
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        // tsconfig.json を自動で見つけて型情報を使う
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- セキュリティ規約 ---
      'react/no-danger': 'error',
      'no-restricted-syntax': ['error', ...forbiddenHtmlSinks],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // --- 書き方 ---
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // React 19 + TypeScript では propTypes は使わない(型で検査する)
      'react/prop-types': 'off',
    },
  },
  {
    // 設定ファイル自身(JS)は型情報なしで検査する
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node },
  },
)
