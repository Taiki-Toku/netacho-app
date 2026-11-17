import { describe, expect, it } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import type { LoadedData } from '../data/source.ts'
import { renderApp } from '../test/renderApp.tsx'
import { baseSample } from '../test/sampleData.ts'

// 基本の 9 本(最新日 2026-01-02)。「表示の安全確認」のネタ(2026-01-02-07)が最新日にあり、前後の移動と一緒に確かめられる
const sample: LoadedData = baseSample

async function renderItem(id: string) {
  renderApp(`#/item/${id}`, sample)
  return screen.findByRole('article')
}

/** jsdom は Touch を持たないため、素の Event に changedTouches を付けて流す */
function touch(target: Element, type: 'touchstart' | 'touchend', x: number, y: number) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'changedTouches', { value: [{ clientX: x, clientY: y }] })
  fireEvent(target, event)
}

describe('ネタの詳細', () => {
  it('ジャンル名・見出し・出典と日付・要点・試してみる・気をつけること・このネタについて・評価・メモを出す', async () => {
    const article = await renderItem('2026-01-02-01')
    expect(within(article).getByRole('heading', { level: 1 })).toHaveTextContent('架空:手順書の差分チェックを半自動にする')
    expect(within(article).getByText('仕事・自動化')).toBeInTheDocument()
    expect(within(article).getByText('2026年1月2日(金)')).toBeInTheDocument()
    expect(within(article).getByText('見本のリード文です。')).toBeInTheDocument()
    expect(within(article).getByRole('heading', { level: 2, name: '要点' })).toBeInTheDocument()
    expect(within(article).getByText(/2〜4文の長さの要約が入ります/)).toBeInTheDocument()
    expect(within(article).getByText('この要点は、元の記事をもとにAIがまとめたものです。')).toBeInTheDocument()
    expect(within(article).getByRole('heading', { level: 2, name: '試してみる' })).toBeInTheDocument()
    expect(within(article).getByText('最初の一歩の見本です。')).toBeInTheDocument()
    expect(within(article).getByRole('heading', { level: 2, name: '気をつけること' })).toBeInTheDocument()
    expect(within(article).getByText('注意点の見本です。')).toBeInTheDocument()
    // 依頼書の項目(コーナー、情報の確かさ、扱い、分類)は「このネタについて」に残す
    expect(within(article).getByText('取り組みに効く')).toBeInTheDocument()
    expect(within(article).getByText('公式')).toBeInTheDocument()
    expect(within(article).getByText('試す予定')).toBeInTheDocument()
    expect(within(article).getByText('自動化パイプライン')).toBeInTheDocument()
    expect(within(article).getByText('業務効率◎、無料')).toBeInTheDocument()
    // 元から付いている評価とメモ
    expect(within(article).getByRole('button', { name: '熱い' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(article).getByText('評価:熱い')).toBeInTheDocument()
    expect(within(article).getByLabelText('メモ')).toHaveValue('見本のメモ')
    // 位置は見出しの下と、前後のボタンの間(aria-hidden)の2か所に同じ書き方で出る
    expect(within(article).getAllByText('1 / 7')).toHaveLength(2)
  })

  it('セキュリティニュース・プロダクトでは「試してみる」が「確かめること」になる', async () => {
    renderApp('#/item/2026-01-03-05', { ...sample, items: [...sample.items, ...(await import('../test/sampleData.ts')).fullSample.items] })
    const article = await screen.findByRole('article')
    expect(within(article).getByRole('heading', { level: 2, name: '確かめること' })).toBeInTheDocument()
    expect(within(article).queryByRole('heading', { level: 2, name: '試してみる' })).not.toBeInTheDocument()
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

  it('出典が無いときは「出典なし」。評価・扱いが空なら未評価・未設定。前の日のネタの戻り先はそのジャンル', async () => {
    const article = await renderItem('2026-01-01-02')
    expect(within(article).getByText('出典なし')).toBeInTheDocument()
    expect(within(article).getByText('未評価')).toBeInTheDocument()
    expect(within(article).getByText('未設定')).toBeInTheDocument()
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

  it('評価の4つのボタンは1つだけ選べ、もう一度押すと外れる。端末に残る', async () => {
    const article = await renderItem('2026-01-02-03')
    const group = within(article).getByRole('group', { name: 'このニュース、どうでしたか' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['熱い', '良い', 'ふつう', 'いまいち'])
    fireEvent.click(within(group).getByRole('button', { name: '良い' }))
    expect(within(group).getByRole('button', { name: '良い' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(article).getByText('評価:良い')).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('button', { name: 'ふつう' }))
    expect(within(group).getByRole('button', { name: '良い' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(group).getByRole('button', { name: 'ふつう' })).toHaveAttribute('aria-pressed', 'true')
    expect(JSON.parse(window.localStorage.getItem('nodal-user') ?? '{}')).toMatchObject({ feedback: { '2026-01-02-03': { rating: 'meh' } } })
    fireEvent.click(within(group).getByRole('button', { name: 'ふつう' }))
    expect(within(article).getByText('未評価')).toBeInTheDocument()
  })

  it('メモは書くたびに保存し、「メモを保存しました」と知らせる', async () => {
    const article = await renderItem('2026-01-02-03')
    const memo = within(article).getByLabelText('メモ')
    expect(memo).toHaveValue('')
    expect(within(article).queryByText('メモを保存しました')).not.toBeInTheDocument()
    fireEvent.change(memo, { target: { value: '試してみた' } })
    expect(memo).toHaveValue('試してみた')
    expect(within(article).getByText('メモを保存しました')).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('nodal-user') ?? '{}')).toMatchObject({ feedback: { '2026-01-02-03': { memo: '試してみた' } } })
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

  it('左にスワイプすると次へ、右にスワイプすると前へ移る。縦の動きは無視する', async () => {
    const article = await renderItem('2026-01-02-02')
    touch(article, 'touchstart', 300, 200)
    touch(article, 'touchend', 100, 210)
    expect(window.location.hash).toBe('#/item/2026-01-02-03')
    await screen.findAllByText('3 / 7')

    const next = screen.getByRole('article')
    touch(next, 'touchstart', 100, 200)
    touch(next, 'touchend', 300, 190)
    expect(window.location.hash).toBe('#/item/2026-01-02-02')
    await screen.findAllByText('2 / 7')

    const back = screen.getByRole('article')
    touch(back, 'touchstart', 100, 100)
    touch(back, 'touchend', 160, 400)
    expect(window.location.hash).toBe('#/item/2026-01-02-02')
  })

  it('無い id なら、見つからない旨と今朝のネタへの案内を出す', async () => {
    renderApp('#/item/nowhere', sample)
    expect(await screen.findByRole('heading', { level: 1, name: 'このニュースは見つかりません' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '今日のニュースへ' })).toHaveAttribute('href', '#/home')
  })
})
