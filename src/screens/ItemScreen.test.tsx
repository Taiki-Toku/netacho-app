import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { App } from '../App.tsx'
import type { LoadedData } from '../data/source.ts'
import { parseGenres, parseItems } from '../data/parse.ts'
import sampleItems from '../../fixtures/sample-items.json'
import genresJson from '../../fixtures/genres.json'

const sample: LoadedData = {
  items: parseItems(sampleItems),
  genres: parseGenres(genresJson),
  source: 'fixtures',
}

async function renderItem(id: string) {
  window.location.hash = `#/item/${id}`
  render(<App load={() => Promise.resolve(sample)} />)
  return screen.findByRole('article')
}

/** jsdom は Touch を持たないため、素の Event に changedTouches を付けて流す */
function touch(target: Element, type: 'touchstart' | 'touchend', x: number, y: number) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'changedTouches', { value: [{ clientX: x, clientY: y }] })
  fireEvent(target, event)
}

describe('ネタの詳細', () => {
  it('見出し・リード・要約・試すなら・注意点・分類・評価・扱い・メモを出す', async () => {
    const article = await renderItem('2026-01-02-01')
    expect(within(article).getByRole('heading', { level: 1 })).toHaveTextContent('架空:手順書の差分チェックを半自動にする')
    expect(within(article).getByText('取り組みに効く')).toBeInTheDocument()
    expect(within(article).getByText('見本のリード文です。')).toBeInTheDocument()
    expect(within(article).getByText(/2〜4文の長さの要約が入ります/)).toBeInTheDocument()
    expect(within(article).getByText('最初の一歩の見本です。')).toBeInTheDocument()
    expect(within(article).getByRole('complementary', { name: '注意点' })).toHaveTextContent('注意点の見本です。')
    expect(within(article).getByText('仕事・自動化')).toBeInTheDocument()
    expect(within(article).getByText('自動化パイプライン')).toBeInTheDocument()
    expect(within(article).getByText('業務効率◎')).toBeInTheDocument()
    expect(within(article).getByText('刺さった')).toBeInTheDocument()
    expect(within(article).getByText('試す予定')).toBeInTheDocument()
    expect(within(article).getByText('見本のメモ')).toBeInTheDocument()
    expect(within(article).getByText('1/7本目')).toBeInTheDocument()
  })

  it('星の指標を「話題度 3/5」のように読み上げる', async () => {
    const article = await renderItem('2026-01-02-01')
    expect(within(article).getByRole('img', { name: '話題度 3/5' })).toBeInTheDocument()
    expect(within(article).getByRole('img', { name: '実用度 5/5' })).toBeInTheDocument()
    expect(within(article).getByRole('img', { name: '遊べる度 2/5' })).toBeInTheDocument()
  })

  it('https: の出典はリンクになり、新しいタブで安全に開く', async () => {
    const article = await renderItem('2026-01-02-01')
    const link = within(article).getByRole('link', { name: /見本の出典A/ })
    expect(link).toHaveAttribute('href', 'https://example.com/a')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(article).getByText('公式')).toBeInTheDocument()
  })

  it('http: の出典はリンクにせず、文字のまま出す', async () => {
    const article = await renderItem('2026-01-02-06')
    expect(within(article).getByText('https ではない出典(リンクにしない)')).toBeInTheDocument()
    expect(within(article).getByText('http://example.com/not-https')).toBeInTheDocument()
    expect(within(article).queryByRole('link', { name: /出典/ })).not.toBeInTheDocument()
    expect(article.querySelector('a[href^="http://"]')).toBeNull()
  })

  it('javascript: の出典はリンクにせず、HTML 入りの見出し・要約は文字のまま出す', async () => {
    const article = await renderItem('2026-01-02-07')
    expect(article.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(within(article).getByText('javascript:alert(1)')).toBeInTheDocument()
    expect(within(article).getByRole('heading', { level: 1 })).toHaveTextContent(
      '架空:表示の安全確認 <script>alert(1)</script> <b>太字</b> &amp;',
    )
    expect(within(article).getByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument()
    expect(article.querySelector('script')).toBeNull()
    expect(article.querySelector('b')).toBeNull()
    expect(article.querySelector('img')).toBeNull()
  })

  it('出典が無いときは「出典なし」。評価・扱いが空なら未評価・未設定', async () => {
    const article = await renderItem('2026-01-01-02')
    expect(within(article).getByText('出典なし')).toBeInTheDocument()
    expect(within(article).getByText('未評価')).toBeInTheDocument()
    expect(within(article).getByText('未設定')).toBeInTheDocument()
    // 前の日のネタなので、戻り先はその日のバックナンバー
    expect(within(article).getByRole('link', { name: '進行表へ' })).toHaveAttribute('href', '#/archive/2026-01-01')
  })

  it('前後のボタン:1本目は前が無く、最後は次の代わりに進行表へ', async () => {
    await renderItem('2026-01-02-01')
    const pager = screen.getByRole('navigation', { name: '前後のネタ' })
    expect(within(pager).queryByRole('link', { name: '前のネタ' })).not.toBeInTheDocument()
    expect(within(pager).getByText('前のネタ')).toBeInTheDocument()
    expect(within(pager).getByRole('link', { name: '次のネタ' })).toHaveAttribute('href', '#/item/2026-01-02-02')

    window.location.hash = '#/item/2026-01-02-07'
    await screen.findByText('7/7本目')
    const last = screen.getByRole('navigation', { name: '前後のネタ' })
    expect(within(last).getByRole('link', { name: '前のネタ' })).toHaveAttribute('href', '#/item/2026-01-02-06')
    expect(within(last).queryByRole('link', { name: '次のネタ' })).not.toBeInTheDocument()
    expect(within(last).getByRole('link', { name: '進行表へ' })).toHaveAttribute('href', '#/today')
  })

  it('左にスワイプすると次へ、右にスワイプすると前へ移る。縦の動きは無視する', async () => {
    const article = await renderItem('2026-01-02-02')
    touch(article, 'touchstart', 300, 200)
    touch(article, 'touchend', 100, 210)
    expect(window.location.hash).toBe('#/item/2026-01-02-03')
    await screen.findByText('3/7本目')

    const next = screen.getByRole('article')
    touch(next, 'touchstart', 100, 200)
    touch(next, 'touchend', 300, 190)
    expect(window.location.hash).toBe('#/item/2026-01-02-02')
    await screen.findByText('2/7本目')

    const back = screen.getByRole('article')
    touch(back, 'touchstart', 100, 100)
    touch(back, 'touchend', 160, 400)
    expect(window.location.hash).toBe('#/item/2026-01-02-02')
  })

  it('無い id なら、見つからない旨と今日への案内を出す', async () => {
    window.location.hash = '#/item/nowhere'
    render(<App load={() => Promise.resolve(sample)} />)
    expect(await screen.findByRole('heading', { level: 1, name: 'このネタは見つかりません' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '今日の放送へ' })).toHaveAttribute('href', '#/today')
  })
})
