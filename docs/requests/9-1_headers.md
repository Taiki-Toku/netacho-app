# 依頼 9-1:セキュリティヘッダー(`_headers`)をビルドで作る+workflow-guard

- 対象:このリポジトリ(netacho-app)。claude.ai/code のクラウドセッション(環境 netacho-dev)で行う
- もとの設計:netacho-infra の基本設計 9.3・10.2・10.5(v1.1)。netacho-infra はこのリポジトリからは読めないので、要る内容はこの依頼に全部書いた。ほかの文書は読まない(CLAUDE.md と、下の表のファイルだけ)
- 危ない場所(`_headers`・`.github/`・ビルドの設定)に触れるので、`pr-reviewer` を必ず通す(5章)

## 0. 最初に
依頼の英文の Step 0(使える MCP の道具の確認)を、まだしていなければここで行う。止まる条件は英文のとおり。

## 1. 目的
1. 本番の応答に、セキュリティヘッダー(CSP など)が出ていない(要件 REQ-S-03 を満たしていない)。ビルドのたびに `dist/_headers` を作り、Cloudflare Pages に読ませる。
2. CI・AI の設定・ビルドの仕組み・依存を変えた PR を、CI の新しいジョブ workflow-guard で赤にする。赤は「オーナーが差分を目で確かめる」印にする(壊れている印ではない)。
3. 設計(10.2)のうち、まだ入れていない2つを同じ変更で入れる:秘密の値の検査を PR を経ない push でも動かす(新しいワークフロー secrets-push)/ドラフトの PR では CI を動かさない。

## 2. 触るファイル
この表の外は触らない。必要になったら、実装せずに止まって報告する。

| ファイル | すること |
|---|---|
| `src/lib/securityHeaders.ts` | 新規。`_headers` の中身を作る関数(3.2) |
| `src/lib/securityHeaders.test.ts` | 新規。試験(3.5) |
| `vite.config.ts` | `_headers` を出力に足すプラグイン、`build.assetsInlineLimit: 0`、注記(3.3) |
| `scripts/check-dist-clean.mjs` | `dist/_headers` の点検を足す(3.4) |
| `.github/workflows/ci.yml` | 4章の形に置き換える |
| `.github/workflows/secrets-push.yml` | 新規。4章の形で作る |

`package.json` と `package-lock.json` は変えない(build の行も今のまま)。新しいパッケージは足さない。この依頼文(`docs/requests/9-1_headers.md`)も変えない。

## 3. `_headers`

### 3.1 中身
本番(ビルドのときに Supabase の URL があるとき)は、次と1文字も違わない内容にする。1行目は `/*`、ヘッダーの行は空白2つで字下げ、最後の行も改行で終える。

```
/*
  Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https:; font-src 'self'; connect-src 'self' https://igkelhluqhfmlmiihumg.supabase.co; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  Strict-Transport-Security: max-age=31536000
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  X-Robots-Tag: noindex
```

URL が無いとき(Cloudflare の Preview・CI・このセッション)は、connect-src を `connect-src 'self';` にする。ほかの行は同じ。

各ヘッダーのねらい(説明に使う):CSP は自分の配信のスクリプトだけを動かし、通信先を Supabase だけにする(画面に外部のデータを出すので、スクリプトを仕込まれたときの被害を止める)。HSTS は https だけで開かせる(includeSubDomains は pages.dev が自分のドメインではないので付けない)。nosniff は型の取り違えを防ぐ。no-referrer は画像・リンクの先に URL を送らない。Permissions-Policy は使わない機能を閉じる。COOP は別の窓から触られないようにする。noindex は検索に載せない。

### 3.2 関数(`src/lib/securityHeaders.ts`)
`export function securityHeaders(supabaseUrl: string | undefined): string`

- `supabaseUrl` が `undefined`、または前後の空白を除くと空 → connect-src は `'self'` だけ
- 値がある → 前後の空白を除いた値が `/^https:\/\/[a-z0-9]+\.supabase\.co$/` に合うときだけ connect-src に足す。合わなければ `Error` を投げる。メッセージに値そのものは入れない(例:`VITE_SUPABASE_URL の形が違います(https://<英小文字と数字>.supabase.co)`)
- 戻り値は 3.1 の文字列。どの行も 2,000 文字以下であることを確かめ、超えたら `Error`(Cloudflare の上限が1行 2,000 文字のため)
- node の API(fs など)を使わない(`@types/node` が入っておらず、型チェックが通らないため)。`any` を使わない

### 3.3 ビルドへの組み込み(`vite.config.ts`)
- 値は `loadEnv(mode, '.', 'VITE_SUPABASE_URL')` で読む。アプリの本体が `import.meta.env` で読むのと同じ仕組みなので、CSP の通信先と、アプリが実際につなぐ先が必ずそろう。`.env` で始まるファイルを自分で開いたり、値を表示したりしない
- `apply: 'build'` のプラグインを1つ足し、`generateBundle` の中で `this.emitFile({ type: 'asset', fileName: '_headers', source: securityHeaders(値) })` を呼ぶ(node の fs を使わずに `dist/_headers` ができる)。値の形が違えば関数が投げるので、ビルドが失敗し、本番は前の配信のまま残る
- `build: { assetsInlineLimit: 0 }` を足す。小さな画像・フォントを `data:` の URL にして JS・CSS に埋め込むのを止めるため(既定は 4 KiB 未満を埋め込む。埋め込むと CSP に `data:` を足すことになる)
- 先頭の注記に次を足す:「このファイルと、ここから読み込むファイル(src/lib/buildInfo.ts・src/lib/securityHeaders.ts)は、ci.yml の workflow-guard の対象。ここで読み込むファイルを増やしたら、workflow-guard の対象にも足す」

### 3.4 ビルドの点検(`scripts/check-dist-clean.mjs`)
- `dist/_headers` が無い、または `  Content-Security-Policy: default-src 'none';` で始まる行が無ければ、日本語のメッセージで失敗(exit 1)にする。CSP の無い版を本番に出さないため
- 今のスクリプトは local-data が無いと途中で `process.exit(0)` するので、その前に点検する

### 3.5 試験(`src/lib/securityHeaders.test.ts`)
少なくとも次を確かめる。期待する文字列は、試験の中にそのまま書く(関数の出力から作らない)。
1. `undefined`・`''`・`'   '` → `connect-src 'self';` を含み、`supabase` を含まない
2. `'https://igkelhluqhfmlmiihumg.supabase.co'` → 3.1 の本番の中身と完全に一致する。前後に空白・改行が付いていても同じ結果
3. 次はどれも `Error` を投げる:`'http://igkelhluqhfmlmiihumg.supabase.co'`/`'https://evil.example.com'`/`'https://abc.supabase.co.evil.com'`/`'https://abc.supabase.co/'`/`"https://abc.supabase.co; script-src *"`/`'https://abc.supabase.co\nX-Test: 1'`/`'https://ABC.supabase.co'`/`'https://.supabase.co'`
4. 1行目が `/*`、ヘッダーの行が空白2つで始まる、最後が改行で終わる、どの行も 2,000 文字以下
5. CSP の行に `'unsafe-inline'`・`'unsafe-eval'`・`data:`・`*` が無い

## 4. CI(`.github/workflows/ci.yml` と `secrets-push.yml`)
### 4.1 ci.yml
次の内容に置き換える。今のファイルとの違いは、①先頭の注記と `on:`(ドラフトの PR が「レビューできる状態」になったときにも動かす)、②check・audit・secrets の `if:`(ドラフトでは動かさない)、③workflow-guard のジョブ、の3つだけ。uses: の SHA・`permissions: contents: read`・ほかの手順は変えない。違う書き方にしたいときは、理由を報告する。

```yaml
# PR ごとの自動チェック(課題管理表 K-012「PR ごとのレビュー」の層1)
# uses: は、公式リリースのコミットハッシュで固定している(2026-11-15 に git ls-remote で取得)
name: ci

# PR(ドラフトは除く)と手動のときに動かす。PR を経ない push での秘密の値の検査は secrets-push.yml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    if: github.event.pull_request.draft != true
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci --ignore-scripts
      - run: npx --no-install tsc --noEmit
      - run: npm run lint
      - run: npm test -- --run
      - run: npm run build

  audit:
    if: github.event.pull_request.draft != true
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version-file: .nvmrc
      - run: npm audit --omit=dev --audit-level=high
      - name: npm audit (all, report only)
        run: npm audit --audit-level=high
        continue-on-error: true

  secrets:
    if: github.event.pull_request.draft != true
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      # gitleaks の公式バイナリをチェックサム照合して使う(Action のライセンスキーを要らなくするため)
      - name: gitleaks
        env:
          GL_VER: "8.30.1"
        run: |
          set -euo pipefail
          base="https://github.com/gitleaks/gitleaks/releases/download/v${GL_VER}"
          curl -fsSLO "${base}/gitleaks_${GL_VER}_linux_x64.tar.gz"
          curl -fsSLO "${base}/gitleaks_${GL_VER}_checksums.txt"
          grep " gitleaks_${GL_VER}_linux_x64.tar.gz$" "gitleaks_${GL_VER}_checksums.txt" | sha256sum -c -
          tar -xzf "gitleaks_${GL_VER}_linux_x64.tar.gz" gitleaks
          ./gitleaks git --redact --exit-code 1 .

  # PR が、CI・AI の設定・ビルドの仕組み(_headers を作る処理を含む)・依存を変えていたら赤にする。
  # 赤は「オーナーが差分を目で確かめる」印で、壊れている印ではない(基本設計 9.3・10.2・10.5)。
  # この行が検査の一覧に無いときは、ci.yml から消された印なのでマージしない
  workflow-guard:
    if: github.event_name == 'pull_request' && github.event.pull_request.draft != true
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - name: guard
        env:
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
        run: |
          set -euo pipefail
          changed="$(git diff --no-renames --name-only "${BASE_SHA}...${HEAD_SHA}")"
          hits="$(printf '%s\n' "${changed}" | grep -E '^(\.github/|\.claude/|scripts/|CLAUDE\.md$|vite\.config\.ts$|src/lib/(buildInfo|securityHeaders)\.ts$|package\.json$|package-lock\.json$|\.npmrc$|public/_headers$)' || true)"
          if [ -n "${hits}" ]; then
            echo "::error::守る対象のファイルが変わっています。オーナーが差分を目で確かめてからマージしてください"
            printf '%s\n' "${hits}"
            exit 1
          fi
          echo "守る対象のファイルの変更はありません"
```

### 4.2 secrets-push.yml(新規)
次の内容で作る。ci.yml の secrets と同じ gitleaks の手順を、PR を経ない push(作業中のブランチ・main)で動かす。ci.yml に `push:` を足さずにファイルを分けるのは、PR の検査の一覧に同じ名前の「動かなかった(スキップの)検査」が並び、オーナーが見分けにくくなるのと、公開後のブランチ保護で、スキップの検査が「通った」と数えられるおそれ【推測】を避けるため。

```yaml
# PR を経ない push(作業中のブランチ・main)でも、秘密の値が入っていないかを調べる(基本設計 10.2・10.4、G1 の SEC-05)
# 中身は ci.yml の secrets と同じ。gitleaks の版を上げるときは、両方を同じ版にする
# ci.yml とファイルを分けたのは、PR の検査の一覧に、同じ名前の「動かなかった(スキップの)検査」が並ばないようにするため
name: secrets-push

on:
  push:

permissions:
  contents: read

concurrency:
  group: secrets-push-${{ github.ref }}
  cancel-in-progress: true

jobs:
  secrets-push:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      # gitleaks の公式バイナリをチェックサム照合して使う(Action のライセンスキーを要らなくするため)
      - name: gitleaks
        env:
          GL_VER: "8.30.1"
        run: |
          set -euo pipefail
          base="https://github.com/gitleaks/gitleaks/releases/download/v${GL_VER}"
          curl -fsSLO "${base}/gitleaks_${GL_VER}_linux_x64.tar.gz"
          curl -fsSLO "${base}/gitleaks_${GL_VER}_checksums.txt"
          grep " gitleaks_${GL_VER}_linux_x64.tar.gz$" "gitleaks_${GL_VER}_checksums.txt" | sha256sum -c -
          tar -xzf "gitleaks_${GL_VER}_linux_x64.tar.gz" gitleaks
          ./gitleaks git --redact --exit-code 1 .
```

### 4.3 説明に使う要点
- workflow-guard の PR の値(SHA)は `${{ }}` で `run:` に直接書かず、`env:` を通して渡す(値に仕込まれた文字が命令として動くのを防ぐ書き方)
- `--no-renames` は、守る対象のファイルを別の名前に移す変更も拾うため
- 守る対象:`.github/`(CI)、`.claude/` と `CLAUDE.md`(AI のセッションの権限と決まり)、`scripts/` と `vite.config.ts` とそこから読み込むファイル(ビルドで動くコード。`_headers` を書き換えられる)、`package.json`(`postbuild` などの書き足しでビルドの後に別の処理を足せる)と `package-lock.json`(依存の差し替え)、`.npmrc`(パッケージの取得先)、`public/_headers`
- この PR 自体も workflow-guard が赤になる(ci.yml などを変えるため)。それでよい
- secrets-push は push のたびに動くので、この PR の検査の一覧にも「secrets-push」が出る(緑になればよい)

## 5. 確かめること(コミットの前)
1. CLAUDE.md の「push の前に通すコマンド」6つを、上から1つずつ全部通す(Node は `.nvmrc` の版)
2. `dist/_headers` を表示し、3.1 のとおり(connect-src は `'self'` だけ)であることを確かめる。`grep -rEl "url\(data:|data:(image|font)/" dist` で、埋め込みの画像・フォントが残っていないかも見る(見つかったらファイル名を報告。消せなければ止めて報告)
3. `src/screens/LoginScreen.tsx` と `src/components/SearchBox.tsx` の form が、送信のときに `preventDefault` していることをコードで確かめる(`form-action 'none'` の下でも動くため。直す必要があれば止めて報告)
4. ブラウザでの確認は任意:Chromium(Playwright など)がすでに入っていれば、`dist` を 3.1 のヘッダー付きで配る小さなサーバー(`.tmp/` に置き、node の http だけ。コミットしない)で開き、コンソールに CSP の違反が 0 件かを見る。入っていなければ飛ばして「未確認」と書く。何もインストールしない
5. 2章の表のファイルだけを `git add <ファイル>` で足し(ほかのファイルが現れていたら足さずに報告する)、`git diff --cached main > .tmp/review.diff` を保存して(新しいファイルも差分に入れるため)、サブエージェント `pr-reviewer` にレビューさせる。重大は直して、もう一度 1 とレビューを通す。中は直すか、直さない理由を報告に書く

## 6. コミット・push・報告
- ブランチは main から `claude/9-1-headers`。コミットは1つ。メッセージは日本語で、要件 ID(REQ-S-03・REQ-S-08)を入れる
- push はこのブランチだけ。main には push しない。PR はオーナーがセッションの画面から作る
- 報告は日本語で、`.tmp/report-9-1.md` にも保存する:
  1. Step 0 の MCP の道具の一覧(サーバーごと)と判定
  2. 変えたファイル。危ない場所(vite.config.ts・securityHeaders.ts・check-dist-clean.mjs・ci.yml・secrets-push.yml)は、変えた行ごとに「何をしているか/なぜ安全か」
  3. コマンドと試験の結果、`dist/_headers` の中身、5章の 2〜4 の結果
  4. pr-reviewer の指摘と対応
  5. 依頼と違う実装にした所と理由(無ければ「なし」)
  6. **テストが保証していないこと**(少なくとも:本番の Supabase への通信が CSP で止まらないこと、iPhone のホーム画面のアプリでの表示とログイン、Cloudflare が `_headers` を読むこと)
  7. PR のタイトルと本文。本文の先頭に「.github/workflows/ を変えた」と書き、見出しは 何をしたか/なぜ/危ない点/試験とレビューの結果/テストが保証していないこと

## 7. やらないこと
- CSP を緩めない。違反が出ても `'unsafe-inline'`・`data:`・`*` などを足さず、原因(埋め込み・外部の読み込み)を報告して止まる
- 依頼に無い画面・部品・設定を触らない。`.env` で始まるファイルを開かない
- 外部への通信(curl など)をしない(npm の取得を除く)

## 8. オーナー向けのメモ(エージェントは読まなくてよい)
- PR を作ると workflow-guard は赤になる(この PR は ci.yml・vite.config.ts・scripts/ を変えるため)。check・audit・secrets・secrets-push が緑なら、設計のチャットで PR のレビューを受ける
- Preview の確認(ブラウザの開発者ツール)、マージ後のヘッダーの確認、iPhone での確認の手順は、設計のチャットで出す
- マージの後にログインや一覧が動かなくなったら、Cloudflare で前の配信に戻す(基本設計 6.3 の R-05)
