import { describe, expect, it } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import type { LoadedData } from '../data/source.ts'
import { renderApp, waitForHeading } from '../test/renderApp.tsx'
import { baseSample, fullSample } from '../test/sampleData.ts'

// 基本の 9 本(最新日 2026-01-02 の 7 本に「表示の安全確認」のネタがある)で、画面の作りと安全性を確かめる
const sample: LoadedData = baseSample

async function renderToday(data: LoadedData = sample) {
  renderApp('', data)
  await waitForHeading('今朝のネタ')
  return screen.getByRole('list', { name: '今朝のラインナップ' })
}

describe('今朝のネタ', () => {
  it('見本の一式(追加の 6 本を含む)では、最新日 2026-01-03 の 6 本だけを出す(トップ 1 本 + ラインナップ 5 本)', async () => {
    const list = await renderToday(fullSample)
    const feature = screen.getByRole('article', { name: '架空:サンプル商事で不正アクセス、会員情報およそ12万件が流出か' })
    expect(within(feature).getByText('今朝のトップ')).toBeInTheDocument()
    expect(within(feature).getByRole('link', { name: /サンプル商事/ })).toHaveAttribute('href', '#/item/2026-01-03-01')
    expect(within(list).getAllByRole('listitem').flatMap((li) => [...li.querySelectorAll('a')]).map((a) => a.getAttribute('href'))).toEqual([
      '#/item/2026-01-03-02',
      '#/item/2026-01-03-03',
      '#/item/2026-01-03-04',
      '#/item/2026-01-03-05',
      '#/item/2026-01-03-06',
    ])
    expect(screen.getByText('1月3日 土曜日。全6本、放送の順に並んでいます。')).toBeInTheDocument()
    expect(screen.getByText('あと5本')).toBeInTheDocument()
  })

  it('最新日(2026-01-02)の 7 本だけを、順番どおりに出す。前の日のネタは出さない', async () => {
    const list = await renderToday()
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(6)
    expect(rows.map((row) => row.querySelector('a')?.getAttribute('href'))).toEqual([
      '#/item/2026-01-02-02',
      '#/item/2026-01-02-03',
      '#/item/2026-01-02-04',
      '#/item/2026-01-02-05',
      '#/item/2026-01-02-06',
      '#/item/2026-01-02-07',
    ])
    // 放送順の番号
    expect(rows[0]).toHaveTextContent(/^2/)
    expect(screen.queryByText('架空:前の日の放送の1本目')).not.toBeInTheDocument()
  })

  it('見出しだけがリンク。行全体はリンクでなく、保存ボタンはリンクの外にある', async () => {
    const list = await renderToday()
    const row = within(list).getAllByRole('listitem')[0]!
    expect(row.tagName).toBe('LI')
    expect(row.getAttribute('role')).toBeNull()
    const link = within(row).getByRole('link')
    expect(link.textContent).toBe('架空:ノートアプリ「サンプルノート」2.0 が登場')
    const save = within(row).getByRole('button', { name: '保存する' })
    expect(link.contains(save)).toBe(false)
  })

  it('評価済みのネタにはその旨が付き、未評価には付かない', async () => {
    const list = await renderToday()
    const rows = within(list).getAllByRole('listitem')
    // 見本で rating が入っているのは 01(トップ)、02、04、06。ラインナップでは 02、04、06 の 3 本
    expect(within(list).getAllByText('評価済み')).toHaveLength(3)
    expect(within(rows[1]!).queryByText('評価済み')).not.toBeInTheDocument()
  })

  it('ジャンルの名前と出典を出す。ジャンルの一覧は fixtures から引く', async () => {
    const list = await renderToday()
    const rows = within(list).getAllByRole('listitem')
    expect(within(rows[0]!).getByText('ツール・業界')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('見本の出典B')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('エージェント')).toBeInTheDocument()
  })

  it('見出しの中の HTML は文字のまま出て、要素にならない', async () => {
    const list = await renderToday()
    expect(within(list).getByText('架空:表示の安全確認 <script>alert(1)</script> <b>太字</b> &amp;')).toBeInTheDocument()
    expect(list.querySelector('script')).toBeNull()
    expect(list.querySelector('b')).toBeNull()
  })

  it('画像:同じオリジンの相対パスは img になり、javascript: や http: の画像は札になる。読み込みに失敗しても札に替わる', async () => {
    const list = await renderToday()
    const rows = within(list).getAllByRole('listitem')
    // 02 は fixtures/images/term.svg
    const img = rows[0]!.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toMatch(/fixtures\/images\/term\.svg$/)
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('width')
    expect(img).toHaveAttribute('height')
    expect(img).toHaveAttribute('loading', 'lazy')
    // 06 は http:、07 は javascript: の画像 URL。どちらも img にならない
    expect(rows[4]!.querySelector('img')).toBeNull()
    expect(rows[5]!.querySelector('img')).toBeNull()
    expect(list.querySelector('img[src^="javascript:"]')).toBeNull()
    expect(list.querySelector('img[src^="http://example.com"]')).toBeNull()
    // 03 は画像なし → 頭文字(ジャンル名の2文字)の札
    expect(rows[1]!.querySelector('img')).toBeNull()
    expect(within(rows[1]!).getByText('エー', { selector: 'div' })).toBeInTheDocument()
    // 読み込みの失敗
    fireEvent.error(img!)
    expect(rows[0]!.querySelector('img')).toBeNull()
    expect(within(rows[0]!).getByText('ツー', { selector: 'div' })).toBeInTheDocument()
  })

  it('ラインナップの保存ボタンで保存でき、「保存しました」と知らせる。メニューの件数も変わる', async () => {
    const list = await renderToday()
    const row = within(list).getAllByRole('listitem')[0]!
    fireEvent.click(within(row).getByRole('button', { name: '保存する' }))
    expect(screen.getByText('保存しました')).toHaveAttribute('aria-live', 'polite')
    expect(within(row).getByRole('button', { name: '保存から外す' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: /^保存\s*1$/ })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('nodal-user') ?? '{}')).toMatchObject({ saved: ['2026-01-02-02'] })
  })

  it('ネタが1本も無いときは、その旨を出す', async () => {
    renderApp('', { items: [], genres: [], feed: [], source: 'fixtures' })
    expect(await screen.findByText('今朝のネタはまだありません')).toBeInTheDocument()
  })

  it('見本データのときは、その旨の添え書きを出す', async () => {
    await renderToday()
    expect(screen.getByText('表示しているのは、すべて見本用の架空データです。')).toBeInTheDocument()
  })
})
