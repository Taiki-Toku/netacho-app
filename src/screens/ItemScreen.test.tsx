import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { rowsToItems } from '../data/itemRow.ts'
import { parseItems } from '../data/parse.ts'
import type { LoadedData } from '../data/source.ts'
import { createLocalUserStore } from '../data/userStore.ts'
import { freshUserStore, renderApp } from '../test/renderApp.tsx'
import { baseSample } from '../test/sampleData.ts'
import type * as GenreImages from '../data/genreImages.ts'

// この試験は「ジャンルの画像が無いとき」の形を確かめる。ジャンルの画像の表は空に差し替える(ジャンルの画像は genreImages.test.tsx の TST-GIMG-01)
vi.mock('../data/genreImages.ts', async () => {
  const actual = await vi.importActual<typeof GenreImages>('../data/genreImages.ts')
  return { GENRE_IMAGES: {}, genreImageOf: (genre: string | null) => actual.genreImageOf(genre, {}) }
})

// 基本の 9 本(最新日 2026-01-02)。「表示の安全確認」のネタ(2026-01-02-07)が最新日にあり、前後の移動と一緒に確かめられる
const sample: LoadedData = baseSample

async function renderItem(id: string) {
  renderApp(`#/item/${id}`, sample)
  return screen.findByRole('article')
}

type TouchType = 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel'

/** jsdom は Touch を持たないため、素の Event に touches を付けて流す。time は event.timeStamp(ms。払う速さの計算に使う) */
function touch(target: Element, type: TouchType, x: number, y: number, time: number, fingers = 1) {
  const event = new Event(type, { bubbles: true })
  const point = { clientX: x, clientY: y }
  const touches = type === 'touchstart' || type === 'touchmove' ? Array.from({ length: fingers }, () => point) : []
  Object.defineProperty(event, 'touches', { value: touches })
  Object.defineProperty(event, 'changedTouches', { value: [point] })
  Object.defineProperty(event, 'timeStamp', { value: time })
  fireEvent(target, event)
}

/** 指を置いて (dx, dy) だけ動かす(まだ離さない)。duration は動かすのにかけた時間(ms) */
function drag(target: Element, dx: number, dy: number, duration: number) {
  touch(target, 'touchstart', 500, 300, 1000)
  touch(target, 'touchmove', 500 + dx / 2, 300 + dy / 2, 1000 + duration / 2)
  touch(target, 'touchmove', 500 + dx, 300 + dy, 1000 + duration)
}

/** 指を離す(drag の続き) */
function lift(target: Element, dx: number, dy: number, duration: number) {
  touch(target, 'touchend', 500 + dx, 300 + dy, 1000 + duration)
}

/** スワイプで動く枠(記事の中身)。読了バーの次にある */
function moverOf(article: HTMLElement): HTMLElement {
  const mover = article.lastElementChild
  if (!(mover instanceof HTMLElement)) throw new Error('スワイプで動く枠がありません')
  return mover
}

// jsdom の画面幅は 1024px。移るのに必要な距離は、その 25% の 256px
const FAR = 300
const NEAR = 100
// ゆっくり(0.5px/ms 未満)動かすときの時間
const SLOW = 2000

describe('ネタの詳細', () => {
  it('TST-DETAIL-01 ジャンル名・見出し・出典と日付・要点・本文・抜粋・このニュースについてを出す。扱い・取り組み・評価・メモは出さない', async () => {
    const article = await renderItem('2026-01-02-01')
    expect(within(article).getByRole('heading', { level: 1 })).toHaveTextContent('架空:手順書の差分チェックを半自動にする')
    expect(within(article).getByText('仕事・自動化')).toBeInTheDocument()
    expect(within(article).getByText('2026年1月2日(金)')).toBeInTheDocument()
    expect(within(article).getByText('見本のリード文です。')).toBeInTheDocument()
    expect(within(article).getByRole('heading', { level: 2, name: '要点' })).toBeInTheDocument()
    expect(within(article).getByText('見本の要点の1行目です。')).toBeInTheDocument()
    expect(within(article).getByRole('heading', { level: 2, name: '本文' })).toBeInTheDocument()
    expect(within(article).getByText('要点と本文は、元の記事をもとにAIがまとめたものです。')).toBeInTheDocument()
    expect(within(article).getByRole('heading', { level: 2, name: '元記事の抜粋' })).toBeInTheDocument()
    // 「試してみる」「気をつけること」の欄は出さない(データに値があっても。詳細設計 5.5.3)
    expect(within(article).queryByRole('heading', { level: 2, name: '試してみる' })).not.toBeInTheDocument()
    expect(within(article).queryByText('最初の一歩の見本です。')).not.toBeInTheDocument()
    expect(within(article).queryByRole('heading', { level: 2, name: '気をつけること' })).not.toBeInTheDocument()
    expect(within(article).queryByText('注意点の見本です。')).not.toBeInTheDocument()
    // 「このニュースについて」:コーナー・情報の確かさ・カテゴリ・タグ・星3つ(詳細設計 5.7.1)
    const about = within(article).getByRole('region', { name: 'このニュースについて' })
    expect(within(about).getAllByRole('term').map((term) => term.textContent)).toEqual(['コーナー', '情報の確かさ', 'カテゴリ', 'タグ'])
    expect(within(about).getByText('取り組みに効く')).toBeInTheDocument()
    expect(within(about).getByText('公式')).toBeInTheDocument()
    expect(within(about).getByText('業務自動化、Copilot')).toBeInTheDocument()
    expect(within(about).getByText('業務効率◎、無料')).toBeInTheDocument()
    expect(within(about).getAllByRole('img', { name: /\d\/5$/ })).toHaveLength(3)
    // 扱い(status)・取り組み(projects)・評価(rating)・メモ(memo)は、データに値があっても出さない
    expect(within(article).queryByText('扱い')).not.toBeInTheDocument()
    expect(within(article).queryByText('試す予定')).not.toBeInTheDocument()
    expect(within(article).queryByText('取り組み')).not.toBeInTheDocument()
    expect(within(article).queryByText('自動化パイプライン')).not.toBeInTheDocument()
    expect(within(article).queryByRole('group', { name: 'このニュース、どうでしたか' })).not.toBeInTheDocument()
    expect(within(article).queryByRole('button', { name: '熱い' })).not.toBeInTheDocument()
    expect(within(article).queryByText(/評価/)).not.toBeInTheDocument()
    expect(within(article).queryByLabelText('メモ')).not.toBeInTheDocument()
    expect(within(article).queryByText('見本のメモ')).not.toBeInTheDocument()
    expect(within(article).queryByText('メモを保存しました')).not.toBeInTheDocument()
    expect(article.querySelector('textarea')).toBeNull()
    // 位置は見出しの下と、前後のボタンの間(aria-hidden)の2か所に同じ書き方で出る
    expect(within(article).getAllByText('1 / 7')).toHaveLength(2)
  })

  it('並び:一覧に戻る(1行)→ジャンル名→見出し→出典と日付→保存→画像→要点→本文→AI の注記→抜粋→出典→このニュースについて→前後', async () => {
    const article = await renderItem('2026-01-02-01')
    const back = within(article).getAllByRole('link', { name: '一覧に戻る' })[0]
    const order = [
      back,
      within(article).getByText('仕事・自動化'),
      within(article).getByRole('heading', { level: 1 }),
      within(article).getByText('2026年1月2日(金)'),
      within(article).getByRole('button', { name: '保存する' }),
      article.querySelector('img'),
      within(article).getByRole('heading', { level: 2, name: '要点' }),
      within(article).getByRole('heading', { level: 2, name: '本文' }),
      within(article).getByText('要点と本文は、元の記事をもとにAIがまとめたものです。'),
      within(article).getByRole('heading', { level: 2, name: '元記事の抜粋' }),
      within(article).getByRole('link', { name: /元の記事を読む/ }),
      within(article).getByRole('heading', { level: 2, name: 'このニュースについて' }),
      screen.getByRole('navigation', { name: '前後のニュース' }),
    ]
    for (const [index, element] of order.entries()) {
      if (element === null || element === undefined) throw new Error(`${index} 番目の欄がありません`)
      const next = order[index + 1]
      if (next === undefined || next === null) continue
      expect(element.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('要点が配列なら箇条で出す。抜粋は手を加えずに引用で出す', async () => {
    const article = await renderItem('2026-01-02-01')
    const points = within(article).getByRole('heading', { level: 2, name: '要点' }).closest('section')
    if (points === null) throw new Error('要点の欄がありません')
    expect(within(points).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '見本の要点の1行目です。',
      '見本の要点の2行目です。',
      '見本の要点の3行目です。',
    ])
    // 箇条があるときは summary の段落を要点の欄に出さない(本文の欄に出す)
    expect(within(points).queryByText(/2〜4文の長さの要約が入ります/)).not.toBeInTheDocument()
    // AI の注記は要点の欄の外(本文の後)
    expect(within(points).queryByText('要点と本文は、元の記事をもとにAIがまとめたものです。')).not.toBeInTheDocument()
    const quote = article.querySelector('blockquote')
    expect(quote?.textContent).toBe('これは架空の元記事から引用した、という体裁の見本の文です。\n改行もそのまま出ます。')
  })

  it('要点が文字列1つなら段落のまま出す(文を切って箇条にしない)。要点・抜粋の項目が無ければ欄を出さない', async () => {
    const article = await renderItem('2026-01-02-02')
    const points = within(article).getByRole('heading', { level: 2, name: '要点' }).closest('section')
    if (points === null) throw new Error('要点の欄がありません')
    expect(within(points).queryByRole('list')).not.toBeInTheDocument()
    expect(within(points).getByText('これは画面確認用の架空のネタです。実在の製品や出来事ではありません。2〜4文の長さの要約が入ります。').tagName).toBe('P')
    expect(within(article).queryByRole('heading', { level: 2, name: '元記事の抜粋' })).not.toBeInTheDocument()
    expect(article.querySelector('blockquote')).toBeNull()
  })

  it('箇条の中の HTML は文字のまま出す。空白だけの箇条は出さない', async () => {
    renderApp('#/item/html-points', {
      ...sample,
      items: parseItems([{ id: 'html-points', date: '2026-01-02', points: ['<a href="javascript:alert(1)">箇条</a>', '  ', '<b>太字</b>'] }]),
    })
    const article = await screen.findByRole('article')
    expect(within(article).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['<a href="javascript:alert(1)">箇条</a>', '<b>太字</b>'])
    expect(article.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(article.querySelector('b')).toBeNull()
  })

  it('要点も抜粋も無いニュースは、どちらの欄も出さない(架空の文で埋めない)', async () => {
    const [first] = sample.items
    if (first === undefined) throw new Error('見本のネタがありません')
    const bare = { ...first, id: 'bare', summary: '', points: [], excerpt: '' }
    renderApp('#/item/bare', { ...sample, items: [bare, ...sample.items.slice(1)] })
    const article = await screen.findByRole('article')
    expect(within(article).queryByRole('heading', { level: 2, name: '要点' })).not.toBeInTheDocument()
    expect(within(article).queryByText('要点と本文は、元の記事をもとにAIがまとめたものです。')).not.toBeInTheDocument()
    expect(within(article).queryByRole('heading', { level: 2, name: '本文' })).not.toBeInTheDocument()
    expect(within(article).queryByRole('heading', { level: 2, name: '元記事の抜粋' })).not.toBeInTheDocument()
  })

  it('画像が無いときは大きな枠を出さず、出典の横に小さな札(媒体名の1文字目を大文字)。docs. は外す', async () => {
    const [first] = sample.items
    if (first === undefined) throw new Error('見本のネタがありません')
    const item = { ...first, id: 'no-image', sourceUrl: 'https://docs.ollama.com/x', imageUrl: undefined }
    renderApp('#/item/no-image', { ...sample, items: [item, ...sample.items.slice(1)] })
    const article = await screen.findByRole('article')
    expect(article.querySelector('img')).toBeNull()
    expect(within(article).getByText('O')).toHaveAttribute('aria-hidden', 'true')
    // 見出しの下の媒体名と、「出典」の欄のホスト名(こちらは docs. を外さない)
    expect(within(article).getByText('ollama.com')).toBeInTheDocument()
    expect(within(article).getByText('docs.ollama.com')).toBeInTheDocument()
  })

  it('画像の読み込みに失敗したら、大きな枠をやめて出典の横の札に替える', async () => {
    const article = await renderItem('2026-01-02-01')
    const img = article.querySelector('img')
    if (img === null) throw new Error('画像がありません')
    expect(within(article).queryByText('E')).not.toBeInTheDocument()
    fireEvent.error(img)
    expect(article.querySelector('img')).toBeNull()
    expect(within(article).getByText('E')).toHaveAttribute('aria-hidden', 'true')
  })

  it('TST-IMG-06 DB の行の image_url を画面に渡すと img の src になり、IP アドレスの画像は img にしない', async () => {
    // DB の items の行の形の見本(架空)
    const dbRow = { id: 'db-image', date: '2026-01-02', sort_order: 1, title: '架空:DB の画像', source_url: 'https://example.com/a' }
    renderApp('#/item/db-image', {
      ...sample,
      items: rowsToItems([
        { ...dbRow, image_url: 'https://example.com/a.png' },
        { ...dbRow, id: 'db-ip-image', sort_order: 2, image_url: 'https://127.0.0.1/a.png' },
      ]),
    })
    const article = await screen.findByRole('article')
    const img = article.querySelector('img')
    expect(img).toHaveAttribute('src', 'https://example.com/a.png')
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')

    window.location.hash = '#/item/db-ip-image'
    await screen.findAllByText('2 / 2')
    expect(screen.getByRole('article').querySelector('img')).toBeNull()
  })

  it('読了バーを出す(読み上げない)', async () => {
    const article = await renderItem('2026-01-02-01')
    const bar = article.querySelector('progress')
    expect(bar).toHaveAttribute('aria-hidden', 'true')
    expect(bar).toHaveAttribute('max', '1')
  })

  it('セキュリティニュース・プロダクトでも「確かめること」「試してみる」「気をつけること」の欄を出さない', async () => {
    renderApp('#/item/2026-01-03-05', { ...sample, items: [...sample.items, ...(await import('../test/sampleData.ts')).fullSample.items] })
    const article = await screen.findByRole('article')
    for (const name of ['確かめること', '試してみる', '気をつけること']) {
      expect(within(article).queryByRole('heading', { level: 2, name })).not.toBeInTheDocument()
    }
  })

  it('星の指標を「話題度 3/5」のように読み上げる', async () => {
    const article = await renderItem('2026-01-02-01')
    expect(within(article).getByRole('img', { name: '話題度 3/5' })).toBeInTheDocument()
    expect(within(article).getByRole('img', { name: '実用度 5/5' })).toBeInTheDocument()
    expect(within(article).getByRole('img', { name: '遊べる度 2/5' })).toBeInTheDocument()
  })

  it('https: の出典はリンクになり、新しいタブで安全に開く', async () => {
    const article = await renderItem('2026-01-02-01')
    const link = within(article).getByRole('link', { name: /元の記事を読む/ })
    expect(link).toHaveAttribute('href', 'https://example.com/a')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    // 見出しの下は URL から作った媒体名、「出典」の欄は出典名とホスト名
    expect(within(article).getAllByText('見本の出典A')).toHaveLength(1)
    expect(within(article).getAllByText('example.com')).toHaveLength(2)
  })

  it('http: の出典はリンクにせず、文字のまま出す', async () => {
    const article = await renderItem('2026-01-02-06')
    expect(within(article).getAllByText('https ではない出典(リンクにしない)')).toHaveLength(1)
    // http: の URL からは媒体名を作らず、見出しの下はジャンル名(上のジャンル名と2か所)
    expect(within(article).getAllByText('セキュリティニュース')).toHaveLength(2)
    expect(within(article).queryByText('example.com')).not.toBeInTheDocument()
    expect(within(article).getByText('http://example.com/not-https')).toBeInTheDocument()
    expect(within(article).queryByRole('link', { name: /元の記事を読む/ })).not.toBeInTheDocument()
    expect(article.querySelector('a[href^="http://"]')).toBeNull()
    // http: の画像も img にしない(頭文字の札)
    expect(article.querySelector('img')).toBeNull()
  })

  it('javascript: の出典・画像はリンクや img にせず、HTML 入りの見出し・要約は文字のまま出す', async () => {
    const article = await renderItem('2026-01-02-07')
    expect(article.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(article.querySelector('img')).toBeNull()
    expect(within(article).getByText('javascript:alert(1)')).toBeInTheDocument()
    expect(within(article).getByRole('heading', { level: 1 })).toHaveTextContent(
      '架空:表示の安全確認 <script>alert(1)</script> <b>太字</b> &amp;',
    )
    expect(within(article).getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument()
    // 抜粋の中の HTML も文字のまま
    expect(article.querySelector('blockquote')?.textContent).toBe('<iframe src="https://example.com"></iframe> 抜粋の中の HTML も文字のまま出ます。')
    expect(article.querySelector('iframe')).toBeNull()
    expect(article.querySelector('script')).toBeNull()
    expect(article.querySelector('b')).toBeNull()
  })

  it('画像があるネタは img を出す(alt は空、幅と高さ付き)', async () => {
    const article = await renderItem('2026-01-02-01')
    const img = article.querySelector('img')
    expect(img?.getAttribute('src')).toMatch(/fixtures\/images\/desk\.svg$/)
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('width')
    expect(img).toHaveAttribute('height')
  })

  it('出典が無いときは「出典なし」。評価・扱いが空でも「未評価」「未設定」は出さない。前の日のネタの戻り先はそのジャンル', async () => {
    const article = await renderItem('2026-01-01-02')
    expect(within(article).getByText('出典なし')).toBeInTheDocument()
    expect(within(article).queryByText('未評価')).not.toBeInTheDocument()
    expect(within(article).queryByText('未設定')).not.toBeInTheDocument()
    // 戻るリンクは上と、最後のネタなので前後のボタンの右にも出る
    const backLinks = within(article).getAllByRole('link', { name: '一覧に戻る' })
    expect(backLinks).toHaveLength(2)
    expect(backLinks[0]).toHaveAttribute('href', '#/genre/creative')
  })

  it('保存ボタンで保存と解除ができ、端末に残る', async () => {
    const article = await renderItem('2026-01-02-01')
    const button = within(article).getByRole('button', { name: '保存する' })
    fireEvent.click(button)
    expect(within(article).getByRole('button', { name: '保存済み' })).toHaveAttribute('aria-pressed', 'true')
    expect(JSON.parse(window.localStorage.getItem('nodal-user') ?? '{}')).toMatchObject({ saved: ['2026-01-02-01'] })
    fireEvent.click(within(article).getByRole('button', { name: '保存済み' }))
    expect(within(article).getByRole('button', { name: '保存する' })).toHaveAttribute('aria-pressed', 'false')
    expect(JSON.parse(window.localStorage.getItem('nodal-user') ?? '{}')).toMatchObject({ saved: [] })
  })

  it('TST-DETAIL-03 前の版の評価・メモが端末にあっても詳細には出さず、保存の付け外しの後も端末に残る', async () => {
    window.localStorage.clear()
    window.localStorage.setItem('nodal-user', JSON.stringify({ saved: [], feedback: { '2026-01-02-03': { rating: 'good', memo: '架空のめも' } } }))
    const store = createLocalUserStore(window.localStorage)
    renderApp('#/item/2026-01-02-03', sample, store)
    const article = await screen.findByRole('article')
    expect(within(article).queryByText('架空のめも')).not.toBeInTheDocument()
    expect(within(article).queryByText(/評価/)).not.toBeInTheDocument()
    fireEvent.click(within(article).getByRole('button', { name: '保存する' }))
    fireEvent.click(within(article).getByRole('button', { name: '保存済み' }))
    expect(JSON.parse(window.localStorage.getItem('nodal-user') ?? '{}')).toEqual({
      saved: [],
      feedback: { '2026-01-02-03': { rating: 'good', memo: '架空のめも' } },
    })
  })

  it('前後のボタン:1本目は前が無く、最後は次の代わりに戻り先へ', async () => {
    await renderItem('2026-01-02-01')
    const pager = screen.getByRole('navigation', { name: '前後のニュース' })
    expect(within(pager).queryByRole('link', { name: '前のニュース' })).not.toBeInTheDocument()
    expect(within(pager).getByText('前のニュース')).toBeInTheDocument()
    expect(within(pager).getByRole('link', { name: '次のニュース' })).toHaveAttribute('href', '#/item/2026-01-02-02')

    window.location.hash = '#/item/2026-01-02-07'
    await screen.findAllByText('7 / 7')
    const last = screen.getByRole('navigation', { name: '前後のニュース' })
    expect(within(last).getByRole('link', { name: '前のニュース' })).toHaveAttribute('href', '#/item/2026-01-02-06')
    expect(within(last).queryByRole('link', { name: '次のニュース' })).not.toBeInTheDocument()
    expect(within(last).getByRole('link', { name: '一覧に戻る' })).toHaveAttribute('href', '#/home')
  })

  describe('開いた一覧の中での前後(?from=)', () => {
    it('そのジャンルに1本だけなら、前は押せない文字、右は「一覧に戻る」でそのジャンルの一覧へ', async () => {
      // 基本の見本では、セキュリティニュースは 2026-01-02-06 の1本だけ
      renderApp('#/item/2026-01-02-06?from=genre:security-news', sample)
      const article = await screen.findByRole('article')
      expect(within(article).getAllByText('1 / 1')).toHaveLength(2)
      const pager = screen.getByRole('navigation', { name: '前後のニュース' })
      expect(within(pager).queryByRole('link', { name: '前のニュース' })).not.toBeInTheDocument()
      expect(within(pager).getByText('前のニュース')).toBeInTheDocument()
      expect(within(pager).queryByRole('link', { name: '次のニュース' })).not.toBeInTheDocument()
      expect(within(pager).getByRole('link', { name: '一覧に戻る' })).toHaveAttribute('href', '#/genre/security-news')
      // 上の戻るリンクも同じ一覧へ
      expect(within(article).getAllByRole('link', { name: '一覧に戻る' })[0]).toHaveAttribute('href', '#/genre/security-news')
      // from の値は画面に文字として出さない
      expect(within(article).queryByText(/genre:/)).not.toBeInTheDocument()
    })

    it('前後のリンクに同じ from が付き、ジャンルの中だけで進む', async () => {
      // 基本の見本の work は 2026-01-02-01 と 2026-01-01-01 の2本(日をまたぐ。間に同じ日の別ジャンルを挟まない)
      renderApp('#/item/2026-01-02-01?from=genre:work', sample)
      await screen.findAllByText('1 / 2')
      const pager = screen.getByRole('navigation', { name: '前後のニュース' })
      expect(within(pager).getByRole('link', { name: '次のニュース' })).toHaveAttribute('href', '#/item/2026-01-01-01?from=genre%3Awork')

      window.location.hash = '#/item/2026-01-01-01?from=genre%3Awork'
      await screen.findAllByText('2 / 2')
      const last = screen.getByRole('navigation', { name: '前後のニュース' })
      expect(within(last).getByRole('link', { name: '前のニュース' })).toHaveAttribute('href', '#/item/2026-01-02-01?from=genre%3Awork')
      expect(within(last).getByRole('link', { name: '一覧に戻る' })).toHaveAttribute('href', '#/genre/work')
    })

    it('保存の一覧から開いたら、保存の順で前後を決め、戻り先は保存の一覧', async () => {
      const store = freshUserStore()
      store.toggleSaved('2026-01-02-05')
      store.toggleSaved('2026-01-02-01')
      // 新しく保存した順:01 → 05
      renderApp('#/item/2026-01-02-01?from=saved', sample, store)
      await screen.findAllByText('1 / 2')
      const pager = screen.getByRole('navigation', { name: '前後のニュース' })
      expect(within(pager).getByRole('link', { name: '次のニュース' })).toHaveAttribute('href', '#/item/2026-01-02-05?from=saved')
      expect(within(screen.getByRole('article')).getAllByRole('link', { name: '一覧に戻る' })[0]).toHaveAttribute('href', '#/saved')
    })

    it('スワイプの移り先にも from が付く', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
      try {
        const article = await renderItem('2026-01-02-01?from=genre:work')
        drag(article, -FAR, 0, SLOW)
        lift(article, -FAR, 0, SLOW)
        expect(window.location.hash).toBe('#/item/2026-01-01-01?from=genre%3Awork')
        await screen.findAllByText('2 / 2')
      } finally {
        vi.unstubAllGlobals()
      }
    })
  })

  describe('左右のスワイプ', () => {
    beforeEach(() => {
      // jsdom には matchMedia が無い。ふだんは「動きを減らす」設定なし
      vi.stubGlobal('matchMedia', () => ({ matches: false }))
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('左へ 25% 以上動かすと、指に付いてきて、離すと画面の外へ出てから次のニュースへ移る。URL が変わり、「戻る」で戻れる', async () => {
      const article = await renderItem('2026-01-02-02')
      const mover = moverOf(article)
      expect(mover).not.toHaveAttribute('data-swipe')
      drag(article, -FAR, 10, SLOW)
      // 指に合わせて動く(なめらかにする指定は付けない)
      expect(mover).toHaveAttribute('data-swipe', 'drag')
      expect(mover.style.getPropertyValue('--swipe-x')).toBe('-300px')
      lift(article, -FAR, 10, SLOW)
      // 離した直後は、まだ移らない(記事を作り直さない)。画面の外へ送り出す
      expect(window.location.hash).toBe('#/item/2026-01-02-02')
      expect(mover).toHaveAttribute('data-swipe', 'settle')
      expect(mover.style.getPropertyValue('--swipe-x')).toBe('-1024px')
      fireEvent.transitionEnd(mover)
      expect(window.location.hash).toBe('#/item/2026-01-02-03')
      await screen.findAllByText('3 / 7')
      // 移った先の記事は右から入り、動きが終わったら印を外す
      const next = moverOf(screen.getByRole('article'))
      expect(next).toHaveAttribute('data-swipe-enter', 'right')
      expect(next).not.toHaveAttribute('data-swipe')
      fireEvent.animationEnd(next)
      expect(next).not.toHaveAttribute('data-swipe-enter')

      window.history.back()
      await waitFor(() => {
        expect(window.location.hash).toBe('#/item/2026-01-02-02')
      })
      await screen.findAllByText('2 / 7')
      // 「戻る」で戻ったときは、動きを付けない
      expect(moverOf(screen.getByRole('article'))).not.toHaveAttribute('data-swipe-enter')
    })

    it('右へ 25% 以上動かすと、前のニュースへ移る(左から入る)', async () => {
      const article = await renderItem('2026-01-02-02')
      drag(article, FAR, -10, SLOW)
      lift(article, FAR, -10, SLOW)
      expect(moverOf(article).style.getPropertyValue('--swipe-x')).toBe('1024px')
      fireEvent.transitionEnd(moverOf(article))
      expect(window.location.hash).toBe('#/item/2026-01-02-01')
      await screen.findAllByText('1 / 7')
      expect(moverOf(screen.getByRole('article'))).toHaveAttribute('data-swipe-enter', 'left')
    })

    it('届かなければ元の位置へ戻し、移らない', async () => {
      const article = await renderItem('2026-01-02-02')
      const mover = moverOf(article)
      drag(article, -NEAR, 0, SLOW)
      expect(mover.style.getPropertyValue('--swipe-x')).toBe('-100px')
      lift(article, -NEAR, 0, SLOW)
      expect(mover).toHaveAttribute('data-swipe', 'settle')
      expect(mover.style.getPropertyValue('--swipe-x')).toBe('0px')
      fireEvent.transitionEnd(mover)
      // 戻り終わったら、位置の指定を残さない
      expect(mover).not.toHaveAttribute('data-swipe')
      expect(mover.style.getPropertyValue('--swipe-x')).toBe('')
      expect(window.location.hash).toBe('#/item/2026-01-02-02')
      expect(screen.getByRole('article')).toBe(article)
    })

    it('距離が短くても、速く払えば移る。止めてから離したときは移らない', async () => {
      const article = await renderItem('2026-01-02-02')
      // 100px を 100ms(1px/ms)。指を止めて 500ms たってから離す → 払っていない
      drag(article, -NEAR, 0, 100)
      lift(article, -NEAR, 0, 600)
      fireEvent.transitionEnd(moverOf(article))
      expect(window.location.hash).toBe('#/item/2026-01-02-02')
      // 同じ動きで、すぐ離す → 移る
      drag(article, -NEAR, 0, 100)
      lift(article, -NEAR, 0, 110)
      fireEvent.transitionEnd(moverOf(article))
      expect(window.location.hash).toBe('#/item/2026-01-02-03')
      await screen.findAllByText('3 / 7')
    })

    it('小さな横ぶれ(30px 未満)は、速くても移らない', async () => {
      const article = await renderItem('2026-01-02-02')
      drag(article, -20, 0, 10)
      lift(article, -20, 0, 11)
      fireEvent.transitionEnd(moverOf(article))
      expect(window.location.hash).toBe('#/item/2026-01-02-02')
    })

    it('動かしている途中で2本目の指が触れたら、スワイプをやめて元の位置へ戻す', async () => {
      const article = await renderItem('2026-01-02-02')
      const mover = moverOf(article)
      drag(article, -FAR, 0, SLOW)
      touch(article, 'touchstart', 600, 400, 1000 + SLOW, 2)
      expect(mover).toHaveAttribute('data-swipe', 'settle')
      expect(mover.style.getPropertyValue('--swipe-x')).toBe('0px')
      // 指を離しても移らない
      lift(article, -FAR, 0, SLOW + 10)
      fireEvent.transitionEnd(mover)
      expect(mover).not.toHaveAttribute('data-swipe')
      expect(window.location.hash).toBe('#/item/2026-01-02-02')
    })

    it('動かしてから始めの位置に戻して離すと、位置の指定を残さない', async () => {
      const article = await renderItem('2026-01-02-02')
      const mover = moverOf(article)
      drag(article, -NEAR, 0, SLOW)
      touch(article, 'touchmove', 500, 300, 1000 + SLOW + 100)
      expect(mover.style.getPropertyValue('--swipe-x')).toBe('0px')
      touch(article, 'touchend', 500, 300, 1000 + SLOW + 110)
      expect(mover).not.toHaveAttribute('data-swipe')
      expect(mover.style.getPropertyValue('--swipe-x')).toBe('')
      expect(window.location.hash).toBe('#/item/2026-01-02-02')
    })

    it('送り出す動きの途中で touchcancel が来ても、動きを二重にせず、1回だけ移る', async () => {
      const article = await renderItem('2026-01-02-02')
      const mover = moverOf(article)
      drag(article, -FAR, 0, SLOW)
      lift(article, -FAR, 0, SLOW)
      touch(article, 'touchcancel', 500 - FAR, 300, 1000 + SLOW + 10)
      expect(mover.style.getPropertyValue('--swipe-x')).toBe('-1024px')
      const before = window.history.length
      fireEvent.transitionEnd(mover)
      expect(window.location.hash).toBe('#/item/2026-01-02-03')
      await screen.findAllByText('3 / 7')
      // 待ち時間(400ms)を過ぎても、もう一度は移らない
      await new Promise((resolve) => setTimeout(resolve, 450))
      expect(window.location.hash).toBe('#/item/2026-01-02-03')
      expect(window.history.length).toBe(before + 1)
    })

    it('縦の動きは無視する(記事を動かさない。あとから横へ動かしても移らない)', async () => {
      const article = await renderItem('2026-01-02-02')
      const mover = moverOf(article)
      touch(article, 'touchstart', 500, 300, 1000)
      // 最初の約 10px で縦と決まる
      touch(article, 'touchmove', 504, 330, 1100)
      touch(article, 'touchmove', 500 - FAR, 600, 1200)
      expect(mover).not.toHaveAttribute('data-swipe')
      touch(article, 'touchend', 500 - FAR, 600, 1210)
      expect(mover).not.toHaveAttribute('data-swipe')
      expect(window.location.hash).toBe('#/item/2026-01-02-02')
    })

    it('端(最初・最後)では、少しだけ動いて戻り、移らない', async () => {
      const first = await renderItem('2026-01-02-01')
      drag(first, FAR, 0, 100)
      // 移る先が無い向きは、指の動きの 3 割だけ動く
      expect(moverOf(first).style.getPropertyValue('--swipe-x')).toBe('90px')
      lift(first, FAR, 0, 110)
      expect(moverOf(first).style.getPropertyValue('--swipe-x')).toBe('0px')
      fireEvent.transitionEnd(moverOf(first))
      expect(window.location.hash).toBe('#/item/2026-01-02-01')

      window.location.hash = '#/item/2026-01-02-07'
      await screen.findAllByText('7 / 7')
      const last = screen.getByRole('article')
      drag(last, -FAR, 0, 100)
      lift(last, -FAR, 0, 110)
      expect(moverOf(last).style.getPropertyValue('--swipe-x')).toBe('0px')
      fireEvent.transitionEnd(moverOf(last))
      expect(window.location.hash).toBe('#/item/2026-01-02-07')
    })

    it('動きの終わりの知らせが来なくても、少し待てば移る', async () => {
      const article = await renderItem('2026-01-02-02')
      drag(article, -FAR, 0, SLOW)
      lift(article, -FAR, 0, SLOW)
      expect(window.location.hash).toBe('#/item/2026-01-02-02')
      await waitFor(() => {
        expect(window.location.hash).toBe('#/item/2026-01-02-03')
      })
      await screen.findAllByText('3 / 7')
    })

    it('動きを減らす設定では、記事を動かさず、離した時点で切り替える', async () => {
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
      const article = await renderItem('2026-01-02-02')
      drag(article, -FAR, 0, SLOW)
      expect(moverOf(article)).not.toHaveAttribute('data-swipe')
      lift(article, -FAR, 0, SLOW)
      expect(window.location.hash).toBe('#/item/2026-01-02-03')
      await screen.findAllByText('3 / 7')
      expect(moverOf(screen.getByRole('article'))).not.toHaveAttribute('data-swipe-enter')
    })

    it('読了バーは、スワイプで動く枠の外にある(記事と一緒に動かない)', async () => {
      const article = await renderItem('2026-01-02-02')
      expect(moverOf(article).querySelector('progress')).toBeNull()
      expect(article.querySelector('progress')).not.toBeNull()
    })
  })

  it('無い id なら、見つからない旨と今朝のネタへの案内を出す', async () => {
    renderApp('#/item/nowhere', sample)
    expect(await screen.findByRole('heading', { level: 1, name: 'このニュースは見つかりません' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '今日のニュースへ' })).toHaveAttribute('href', '#/home')
  })
})

describe('公開日とバックナンバーからの詳細(依頼 13-1)', () => {
  it('TST-PUB-02 詳細の出典の行に「公開 11月17日」。配信日はその横に今までどおり。公開日が無ければ「公開日不明」', async () => {
    const items = parseItems([
      { id: 'p1', date: '2026-11-20', order: 1, title: '公開日あり', publishedAt: '2026-11-17' },
      { id: 'p2', date: '2026-11-20', order: 2, title: '公開日なし' },
    ])
    renderApp('#/item/p1', { ...sample, items })
    const article = await screen.findByRole('article')
    const meta = within(article).getByText('公開 11月17日').parentElement
    expect(meta).not.toBeNull()
    // 出典と同じ行。配信日(2026年11月20日)とは別の値として並ぶ
    expect(meta?.textContent).toContain('2026年11月20日')
    expect(within(article).queryByText('公開 11月20日')).not.toBeInTheDocument()

    window.location.hash = '#/item/p2'
    expect(await screen.findByRole('heading', { level: 1, name: '公開日なし' })).toBeInTheDocument()
    expect(within(screen.getByRole('article')).getByText('公開日不明')).toBeInTheDocument()
  })

  it('TST-ARC-05 from=archive:<日付> なら前後はその日の一覧の並び、「一覧に戻る」はその日のバックナンバー', async () => {
    // 基本の見本の 2026-01-01 は 01(order 1)と 02(order 2)の2本
    renderApp('#/item/2026-01-01-01?from=archive:2026-01-01', sample)
    await screen.findAllByText('1 / 2')
    const article = screen.getByRole('article')
    const pager = screen.getByRole('navigation', { name: '前後のニュース' })
    expect(within(pager).queryByRole('link', { name: '前のニュース' })).not.toBeInTheDocument()
    expect(within(pager).getByRole('link', { name: '次のニュース' })).toHaveAttribute('href', '#/item/2026-01-01-02?from=archive%3A2026-01-01')
    expect(within(article).getAllByRole('link', { name: '一覧に戻る' })[0]).toHaveAttribute('href', '#/archive/2026-01-01')
    // from の値は画面に文字として出さない
    expect(within(article).queryByText(/archive:/)).not.toBeInTheDocument()

    window.location.hash = '#/item/2026-01-01-02?from=archive%3A2026-01-01'
    await screen.findAllByText('2 / 2')
    const last = screen.getByRole('navigation', { name: '前後のニュース' })
    expect(within(last).getByRole('link', { name: '前のニュース' })).toHaveAttribute('href', '#/item/2026-01-01-01?from=archive%3A2026-01-01')
    expect(within(last).getByRole('link', { name: '一覧に戻る' })).toHaveAttribute('href', '#/archive/2026-01-01')
  })

  it('TST-ARC-05 形の違う from=archive は無視する(from なしと同じ戻り先と前後)', async () => {
    renderApp('#/item/2026-01-01-01?from=archive:2026-02-30', sample)
    await screen.findAllByText('1 / 2')
    const article = screen.getByRole('article')
    // 前の日のネタで from なし → 戻り先はそのジャンル(今までの動き)
    expect(within(article).getAllByRole('link', { name: '一覧に戻る' })[0]).toHaveAttribute('href', '#/genre/work')
    const pager = screen.getByRole('navigation', { name: '前後のニュース' })
    expect(within(pager).getByRole('link', { name: '次のニュース' })).toHaveAttribute('href', '#/item/2026-01-01-02')
  })

  it('TST-ARC-05 from=archive の日付が記事の配信日と違うときは、戻り先もその日のバックナンバーにしない(前後とそろえる)', async () => {
    renderApp('#/item/2026-01-01-01?from=archive:2026-01-02', sample)
    await screen.findAllByText('1 / 2')
    expect(within(screen.getByRole('article')).getAllByRole('link', { name: '一覧に戻る' })[0]).toHaveAttribute('href', '#/genre/work')
  })
})

describe('本文の欄(依頼 13-2、詳細設計 5.5.3)', () => {
  const AI_NOTE = '要点と本文は、元の記事をもとにAIがまとめたものです。'

  async function renderOne(fields: Record<string, unknown>) {
    renderApp('#/item/body', { ...sample, items: parseItems([{ id: 'body', date: '2026-01-02', title: '架空:本文の見本', ...fields }]) })
    return screen.findByRole('article')
  }

  function sectionOf(article: HTMLElement, name: string): HTMLElement {
    const section = within(article).getByRole('heading', { level: 2, name }).closest('section')
    if (section === null) throw new Error(`${name}の欄がありません`)
    return section
  }

  it('TST-BODY-01 points と summary があれば「本文」に段落で出す(改行で分かれ、空の段落は出ない)。要点の欄には summary を出さない', async () => {
    const article = await renderOne({
      points: ['架空の要点1', '架空の要点2'],
      summary: '架空の1段落目です。\n\n  \n架空の2段落目です。\r\n架空の3段落目です。\n',
    })
    const body = sectionOf(article, '本文')
    const paragraphs = body.querySelectorAll('p')
    expect([...paragraphs].map((p) => p.textContent)).toEqual(['架空の1段落目です。', '架空の2段落目です。', '架空の3段落目です。'])
    expect(within(sectionOf(article, '要点')).queryByText(/架空の1段落目/)).not.toBeInTheDocument()
    expect(within(sectionOf(article, '要点')).getAllByRole('listitem')).toHaveLength(2)
    // 並び:要点 → 本文 → AI の注記(本文の後。要点・本文の欄の外)
    const note = within(article).getByText(AI_NOTE)
    expect(sectionOf(article, '要点').compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(body.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(body.contains(note)).toBe(false)
    expect(within(article).getAllByText(AI_NOTE)).toHaveLength(1)
  })

  it('TST-BODY-01 本文の中の HTML は文字のまま出す', async () => {
    const article = await renderOne({ points: ['架空の要点'], summary: '<script>alert(1)</script>\n<img src=x onerror=alert(1)>' })
    const body = sectionOf(article, '本文')
    expect([...body.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['<script>alert(1)</script>', '<img src=x onerror=alert(1)>'])
    expect(article.querySelector('script, img')).toBeNull()
  })

  it('TST-BODY-01 points だけなら要点の欄だけ(本文の欄は出ない)。AI の注記は要点の後', async () => {
    const article = await renderOne({ points: ['架空の要点'], summary: '' })
    expect(within(article).queryByRole('heading', { level: 2, name: '本文' })).not.toBeInTheDocument()
    const points = sectionOf(article, '要点')
    const note = within(article).getByText(AI_NOTE)
    expect(points.contains(note)).toBe(false)
    expect(points.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('TST-BODY-01 summary だけなら要点の欄に出して、本文の欄は出さない(同じ文を2回出さない)', async () => {
    const article = await renderOne({ summary: '架空の要約だけの文です。' })
    expect(within(sectionOf(article, '要点')).getByText('架空の要約だけの文です。')).toBeInTheDocument()
    expect(within(article).queryByRole('heading', { level: 2, name: '本文' })).not.toBeInTheDocument()
    expect(within(article).getAllByText('架空の要約だけの文です。')).toHaveLength(1)
    expect(within(article).getByText(AI_NOTE)).toBeInTheDocument()
  })

  it('TST-BODY-01 tryit・caution に値があっても欄を出さない(どのジャンルでも)', async () => {
    for (const genre of ['work', 'security-news', 'product']) {
      const article = await renderOne({ genre, points: ['架空の要点'], tryit: '架空の試すこと', caution: '架空の注意' })
      for (const name of ['試してみる', '確かめること', '気をつけること']) {
        expect(within(article).queryByRole('heading', { level: 2, name })).not.toBeInTheDocument()
      }
      expect(within(article).queryByText('架空の試すこと')).not.toBeInTheDocument()
      expect(within(article).queryByText('架空の注意')).not.toBeInTheDocument()
      cleanup()
    }
  })
})
