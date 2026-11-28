import { describe, expect, it } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import type { LoadedData } from '../data/source.ts'
import { renderApp, waitForHeading } from '../test/renderApp.tsx'
import { baseSample, fullSample } from '../test/sampleData.ts'

// 基本の 9 本(最新日 2026-01-02 の 7 本に「表示の安全確認」のネタがある)で、画面の作りと安全性を確かめる
const sample: LoadedData = baseSample

async function renderHome(data: LoadedData = sample) {
  renderApp('', data)
  await waitForHeading('今日のニュース')
  return screen.getByRole('list', { name: 'ニュース一覧' })
}

function rowHrefs(list: HTMLElement): (string | null)[] {
  return within(list)
    .getAllByRole('listitem')
    .map((row) => row.querySelector('a')?.getAttribute('href') ?? null)
}

describe('トップ(今朝のネタ)', () => {
  it('並び順:トップの枠 → 脆弱性ウォッチの帯 → ニュース一覧', async () => {
    await renderHome(fullSample)
    const feature = screen.getByRole('article', { name: /サンプル商事/ })
    const band = screen.getByRole('link', { name: /脆弱性ウォッチ/ })
    const lineup = screen.getByRole('heading', { level: 2, name: 'ニュース一覧' })
    const order = [feature, band, lineup]
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    // 画面の中身はトップの枠から始まる(見出しは読み上げ用だけ)
    const section = screen.getByRole('region', { name: '今日のニュース' })
    expect(section.firstElementChild?.tagName).toBe('H1')
    expect(section.children[1]).toBe(feature)
  })

  it('h1「今日のニュース」は読み上げ用に残し、見た目だけ隠す。日付・件数・並び順の説明文は出さない', async () => {
    await renderHome(fullSample)
    const heading = screen.getByRole('heading', { level: 1, name: '今日のニュース' })
    expect(heading).toHaveClass('visually-hidden')
    expect(screen.queryByText(/配信の順に並んでいます/)).not.toBeInTheDocument()
    expect(screen.queryByText(/1月3日 土曜日。/)).not.toBeInTheDocument()
  })

  it('トップの枠:見出しが本物のリンクで、保存ボタンはリンクの外にあり別に押せる', async () => {
    await renderHome(fullSample)
    const feature = screen.getByRole('article', { name: /サンプル商事/ })
    // 枠そのものはリンクやボタンにしない(押せる範囲は見出しのリンクの ::after で広げる)
    expect(feature.tagName).toBe('ARTICLE')
    expect(feature.getAttribute('role')).toBeNull()
    const links = within(feature).getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '#/item/2026-01-03-01')
    const save = within(feature).getByRole('button', { name: '保存する' })
    expect(links[0]!.contains(save)).toBe(false)
    // 保存ボタンを押しても詳細へは移らず、保存だけされる
    fireEvent.click(save)
    expect(window.location.hash).toBe('')
    expect(within(feature).getByRole('button', { name: '保存から外す' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('見本の一式では、最新日 2026-01-03 の 6 本を、トップを含めて全件、放送順に出す', async () => {
    const list = await renderHome(fullSample)
    const feature = screen.getByRole('article', { name: '架空:サンプル商事で不正アクセス、会員情報およそ12万件が流出か' })
    expect(within(feature).getByText('トップ')).toBeInTheDocument()
    expect(within(feature).getByRole('link', { name: /サンプル商事/ })).toHaveAttribute('href', '#/item/2026-01-03-01')
    expect(rowHrefs(list)).toEqual([
      '#/item/2026-01-03-01',
      '#/item/2026-01-03-02',
      '#/item/2026-01-03-03',
      '#/item/2026-01-03-04',
      '#/item/2026-01-03-05',
      '#/item/2026-01-03-06',
    ])
    expect(screen.getByText('全6本')).toBeInTheDocument()
  })

  it('最新日(2026-01-02)の 7 本だけを、放送順の番号つきで出す。前の日のネタは出さない', async () => {
    const list = await renderHome()
    const rows = within(list).getAllByRole('listitem')
    expect(rowHrefs(list)).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => `#/item/2026-01-02-0${n}`))
    rows.forEach((row, index) => {
      expect(row).toHaveTextContent(new RegExp(`^${index + 1}`))
    })
    expect(screen.queryByText('架空:前の日の放送の1本目')).not.toBeInTheDocument()
    // 読み上げの番号(li の value)も放送順。リードも行に出る
    expect(rows.map((row) => row.getAttribute('value'))).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(within(rows[0]!).getByText('見本のリード文です。')).toBeInTheDocument()
  })

  it('見出しだけがリンク。行全体はリンクでなく、保存ボタンはリンクの外にある', async () => {
    const list = await renderHome()
    const row = within(list).getAllByRole('listitem')[1]!
    expect(row.tagName).toBe('LI')
    expect(row.getAttribute('role')).toBeNull()
    const link = within(row).getByRole('link')
    expect(link.textContent).toBe('架空:ノートアプリ「サンプルノート」2.0 が登場')
    const save = within(row).getByRole('button', { name: '保存する' })
    expect(link.contains(save)).toBe(false)
  })

  it('トップの枠と一覧の行の画像は、包む枠ごと押す操作を下のリンクの ::after へ通す', async () => {
    const list = await renderHome(fullSample)
    const feature = screen.getByRole('article', { name: /サンプル商事/ })
    // jsdom では押した先を判定できないため、画像を包む要素に当たった指定で確かめる(画像は alt が空なので役割では探せない)
    const images = [...feature.querySelectorAll('img'), ...list.querySelectorAll('img')]
    expect(feature.querySelector('img')).not.toBeNull()
    expect(list.querySelector('img')).not.toBeNull()
    for (const image of images) {
      expect(getComputedStyle(image.parentElement!).pointerEvents).toBe('none')
    }
  })

  it('TST-DETAIL-02 一覧の行に「評価済み」を出さない(rating に値がある見本でも)', async () => {
    const list = await renderHome()
    // 見本で rating が入っているのは 01、02、04、06
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(within(list).queryByText('評価済み')).not.toBeInTheDocument()
    expect(screen.queryByText('評価済み')).not.toBeInTheDocument()
  })

  it('ジャンルの名前と出典を出す。ジャンルの一覧は fixtures から引く', async () => {
    const list = await renderHome()
    const rows = within(list).getAllByRole('listitem')
    expect(within(rows[1]!).getByText('ツール・業界')).toBeInTheDocument()
    // 出典は sourceTitle ではなく、URL のホスト名から作った媒体名
    expect(within(rows[1]!).getByText('example.com')).toBeInTheDocument()
    expect(within(rows[1]!).queryByText('見本の出典B')).not.toBeInTheDocument()
    expect(within(rows[2]!).getByText('エージェント')).toBeInTheDocument()
  })

  it('見出しの中の HTML は文字のまま出て、要素にならない', async () => {
    const list = await renderHome()
    expect(within(list).getByText('架空:表示の安全確認 <script>alert(1)</script> <b>太字</b> &amp;')).toBeInTheDocument()
    expect(list.querySelector('script')).toBeNull()
    expect(list.querySelector('b')).toBeNull()
  })

  it('画像:同じオリジンの相対パスは img になり、javascript: や http: の画像は img にせず、出典の横の小さな札になる', async () => {
    const list = await renderHome()
    const rows = within(list).getAllByRole('listitem')
    // 02 は fixtures/images/term.svg
    const img = rows[1]!.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toMatch(/fixtures\/images\/term\.svg$/)
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('width')
    expect(img).toHaveAttribute('height')
    expect(img).toHaveAttribute('loading', 'lazy')
    // 06 は http:、07 は javascript: の画像 URL。どちらも img にならず、出典の横の小さな札になる
    // 出典の URL も http: / javascript: で媒体名を作れないため、札はジャンル名の頭文字
    expect(rows[5]!.querySelector('img')).toBeNull()
    expect(within(rows[5]!).getByText('セ', { selector: 'span' })).toBeInTheDocument()
    expect(rows[6]!.querySelector('img')).toBeNull()
    expect(within(rows[6]!).getByText('プ', { selector: 'span' })).toBeInTheDocument()
    expect(list.querySelector('img[src^="javascript:"]')).toBeNull()
    expect(list.querySelector('img[src^="http://example.com"]')).toBeNull()
  })

  it('画像なし:行は画像の場所を取らず、出典の横に小さな札(媒体名の1文字目)。URL が使えなければジャンル名', async () => {
    const list = await renderHome()
    const rows = within(list).getAllByRole('listitem')
    // 02 は画像あり:番号・文章・画像の3つ。札は出さない
    expect(rows[1]!.children).toHaveLength(3)
    expect(within(rows[1]!).queryByText('E')).not.toBeInTheDocument()
    // 03 は画像が無い:番号・文章の2つだけ(画像の枠を置かない)。URL は https://example.com/c → 媒体名 example.com の1文字目
    expect(rows[2]!.querySelector('img')).toBeNull()
    expect(rows[2]!.children).toHaveLength(2)
    const badge = within(rows[2]!).getByText('E', { selector: 'span' })
    expect(badge).toHaveAttribute('aria-hidden', 'true')
    // 札は出典(媒体名)のすぐ前
    expect(badge.nextElementSibling).toHaveTextContent('example.com')
    // 07 は URL が javascript: → 媒体名の欄もジャンル名(プロダクト)。ジャンルの札と2か所に出る
    expect(within(rows[6]!).getAllByText('プロダクト')).toHaveLength(2)
  })

  it('画像の読み込みに失敗したら、画像の場所をやめて出典の横の小さな札に替わる(トップの枠も行も)', async () => {
    const list = await renderHome()
    const row = within(list).getAllByRole('listitem')[1]!
    fireEvent.error(row.querySelector('img')!)
    expect(row.querySelector('img')).toBeNull()
    expect(row.children).toHaveLength(2)
    expect(within(row).getByText('E', { selector: 'span' })).toBeInTheDocument()

    const feature = screen.getByRole('article', { name: '架空:手順書の差分チェックを半自動にする' })
    // 画像があるうちは、文章と画像の2つ。札は出さない
    expect(feature.children).toHaveLength(2)
    expect(within(feature).queryByText('E')).not.toBeInTheDocument()
    fireEvent.error(feature.querySelector('img')!)
    expect(feature.querySelector('img')).toBeNull()
    expect(feature.children).toHaveLength(1)
    expect(within(feature).getByText('E', { selector: 'span' }).nextElementSibling).toHaveTextContent('example.com')
  })

  it('トップの記事に画像が無いとき、大きな枠は文章だけ(画像の場所を取らない)。出典の横に小さな札', async () => {
    const [first] = fullSample.items.filter((item) => item.id === '2026-01-03-01')
    if (first === undefined) throw new Error('見本のネタがありません')
    const noImage = { ...first, imageUrl: undefined, sourceUrl: 'https://docs.ollama.com/x' }
    await renderHome({ ...fullSample, items: fullSample.items.map((item) => (item.id === first.id ? noImage : item)) })
    const feature = screen.getByRole('article', { name: first.title })
    expect(feature.querySelector('img')).toBeNull()
    expect(feature.children).toHaveLength(1)
    const badge = within(feature).getByText('O', { selector: 'span' })
    expect(badge).toHaveAttribute('aria-hidden', 'true')
    expect(badge.nextElementSibling).toHaveTextContent('ollama.com')
  })

  it('脆弱性ウォッチの帯:緊急の件数、いちばん新しい CVE と CVSS。深刻度ではなく新しさで選ぶ', async () => {
    // 見本のフィードから、いちばん新しい緊急(feed-007)を除く → 最新は重要の CVE-2026-90002(8.1)、緊急は 1 件
    await renderHome({ ...fullSample, feed: fullSample.feed.filter((entry) => entry.id !== 'feed-007') })
    const band = screen.getByRole('link', { name: /脆弱性ウォッチ/ })
    expect(band).toHaveAttribute('href', '#/vuln')
    expect(band).toHaveAccessibleName('脆弱性ウォッチ。Critical 1件。最新:CVE-2026-90002 サンプルOS Server、CVSS 8.1')
    expect(band).toHaveTextContent('Critical 1件')
    expect(band).toHaveTextContent('最新:CVE-2026-90002 サンプルOS Server')
    expect(band).toHaveTextContent('8.1')
  })

  it('脆弱性が0件のときも帯は消さず、「公式情報はまだありません」と出す', async () => {
    await renderHome({ ...fullSample, feed: [] })
    const empty = screen.getByText('公式情報はまだありません')
    // トップの枠とラインナップの間にある
    const feature = screen.getByRole('article')
    const lineup = screen.getByRole('heading', { level: 2, name: 'ニュース一覧' })
    expect(feature.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(empty.compareDocumentPosition(lineup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('link', { name: /脆弱性ウォッチ/ })).not.toBeInTheDocument()
  })

  it('ラインナップの保存ボタンで保存でき、「保存しました」と知らせる。メニューの件数も変わる', async () => {
    const list = await renderHome()
    const row = within(list).getAllByRole('listitem')[1]!
    fireEvent.click(within(row).getByRole('button', { name: '保存する' }))
    expect(screen.getByText('保存しました')).toHaveAttribute('aria-live', 'polite')
    expect(within(row).getByRole('button', { name: '保存から外す' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: /^保存\s*1$/ })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('nodal-user') ?? '{}')).toMatchObject({ saved: ['2026-01-02-02'] })
  })

  it('登場アニメは最初の表示だけ。別の画面に移って戻ると付かない', async () => {
    await renderHome()
    const intro = () => screen.getByRole('article').className
    expect(intro()).toMatch(/intro1/)
    window.location.hash = '#/saved'
    await waitForHeading('保存したニュース')
    window.location.hash = '#/home'
    await waitForHeading('今日のニュース')
    expect(intro()).not.toMatch(/intro1/)
    window.location.hash = ''
  })

  it('ネタが1本も無いときは、その旨を出す(脆弱性の帯は残る)', async () => {
    renderApp('', { items: [], genres: [], feed: [], feedError: null, source: 'fixtures' })
    expect(await screen.findByText('今日のニュースはまだありません')).toBeInTheDocument()
    expect(screen.getByText('公式情報はまだありません')).toBeInTheDocument()
  })

  it('見本データのときは、その旨の添え書きを出す', async () => {
    await renderHome()
    expect(screen.getByText('表示しているのは、すべて見本用の架空データです。')).toBeInTheDocument()
  })
})
