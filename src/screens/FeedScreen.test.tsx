import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { follow, renderApp, waitForHeading } from '../test/renderApp.tsx'
import { fullSample as sample } from '../test/sampleData.ts'

describe('公式のお知らせ', () => {
  it('脆弱性以外の公式フィードを新しい順に並べ、AIによる要約はしていないと明記する', async () => {
    renderApp('#/feed', sample)
    expect(await waitForHeading('公式のお知らせ')).toBeInTheDocument()
    expect(screen.getByText(/AIによる要約はしていません/)).toBeInTheDocument()
    const rows = screen.getByRole('list', { name: '公式のお知らせ' }).querySelectorAll('li')
    expect(rows).toHaveLength(9)
    expect(rows[0]).toHaveTextContent('サンプルクラウド')
    expect(rows[0]).toHaveTextContent('障害 調査中')
    expect(rows[0]).toHaveTextContent('1/3 14:20')
    // 頭文字の札(製品名の最初の1文字。出典の札と同じ作り方)。ロゴは使わない
    expect(within(rows[0]!).getByText('サ', { selector: 'div' })).toHaveAttribute('aria-hidden', 'true')
    expect(rows[0]!.querySelector('img')).toBeNull()
    expect(screen.queryByText(/脆弱性の管理画面/)).not.toBeInTheDocument()
  })

  it('https: の URL だけ見出しをリンクにし、http: の URL は文字のまま', async () => {
    renderApp('#/feed?kind=outage', sample)
    await waitForHeading('公式のお知らせ')
    const list = screen.getByRole('list', { name: '公式のお知らせ' })
    const rows = list.querySelectorAll('li')
    expect(rows).toHaveLength(3)
    const link = within(rows[0]!).getByRole('link', { name: /仮想マシンの起動に失敗する/ })
    expect(link).toHaveAttribute('href', 'https://example.com/feed/11')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    // feed-013 は http: の URL
    expect(within(rows[2]!).queryByRole('link')).not.toBeInTheDocument()
    expect(within(rows[2]!).getByText(/ワークフローの実行が待ち状態/)).toBeInTheDocument()
    expect(list.querySelector('a[href^="http://"]')).toBeNull()
    window.location.hash = ''
  })

  it('種類の絞り込みは URL に残り、0件なら案内を出す', async () => {
    renderApp('#/feed', sample)
    await waitForHeading('公式のお知らせ')
    const chips = screen.getByRole('navigation', { name: 'お知らせの種類' })
    follow(within(chips).getByRole('link', { name: '試験' }))
    expect(window.location.hash).toBe('#/feed?kind=exam')
    await screen.findByText('1件')
    follow(within(chips).getByRole('link', { name: 'すべて' }))
    expect(window.location.hash).toBe('#/feed')
    await screen.findByText('9件')

    window.location.hash = '#/feed?kind=exam'
    await screen.findByText('1件')
    renderApp('#/feed?kind=release', { ...sample, feed: [] })
    expect(await screen.findAllByText('該当するお知らせがありません')).not.toHaveLength(0)
    window.location.hash = ''
  })
})

// feed-011(障害。いちばん新しいお知らせ)にだけ架空の訳を付けた見本
const translated = { ...sample, feed: sample.feed.map((entry) => (entry.id === 'feed-011' ? { ...entry, titleJa: '架空の訳の見出し' } : entry)) }

describe('公式のお知らせの訳(詳細設計 5.3)', () => {
  it('TST-TRUI-03 訳がある行は、原文の下に「機械翻訳」と訳を1行で出す。訳はリンクの外。無い行は今のまま', async () => {
    renderApp('#/feed?kind=outage', translated)
    await waitForHeading('公式のお知らせ')
    const rows = screen.getByRole('list', { name: '公式のお知らせ' }).querySelectorAll('li')
    const line = within(rows[0]!).getByText('架空の訳の見出し').closest('p')!
    expect(line).toHaveAttribute('lang', 'ja')
    expect(line).toHaveTextContent('機械翻訳架空の訳の見出し')
    expect(line.closest('a')).toBeNull()
    // 原文のリンクの名前に訳が入らない。原文の文字には lang="en"
    const link = within(rows[0]!).getByRole('link', { name: /仮想マシンの起動に失敗する/ })
    expect(link).not.toHaveTextContent('架空の訳の見出し')
    expect(link.querySelector('[lang="en"]')).toHaveTextContent(/仮想マシンの起動に失敗する/)
    // 訳の無い行には、印も lang の段落も出ない
    expect(rows[1]).not.toHaveTextContent('機械翻訳')
    expect(rows[1]!.querySelector('[lang]')).toBeNull()
    window.location.hash = ''
  })

  it('TST-TRUI-03 トップの右の欄のお知らせにも、原文と時刻の間に訳を出す', async () => {
    renderApp('', translated)
    await waitForHeading('今日のニュース')
    const rail = screen.getByRole('complementary', { name: '補助の情報' })
    const line = within(rail).getByText('架空の訳の見出し').closest('p')!
    expect(line).toHaveAttribute('lang', 'ja')
    expect(line).toHaveTextContent('機械翻訳架空の訳の見出し')
    const item = line.closest('li')!
    expect(item.querySelector('strong [lang="en"]')).toHaveTextContent(/仮想マシンの起動に失敗する/)
    expect(line.previousElementSibling?.tagName).toBe('STRONG')
    expect(line.nextElementSibling).toHaveTextContent('1/3 14:20')
    // 訳の無いお知らせは今のまま
    expect(within(rail).getAllByText('機械翻訳')).toHaveLength(1)
  })

  it('TST-TRUI-05 訳の中の <script> などは要素にならず、文字のまま出る', async () => {
    const text = '<script>alert(1)</script><b>x</b>'
    renderApp('#/feed?kind=outage', { ...sample, feed: sample.feed.map((entry) => (entry.id === 'feed-011' ? { ...entry, titleJa: text } : entry)) })
    await waitForHeading('公式のお知らせ')
    const list = screen.getByRole('list', { name: '公式のお知らせ' })
    expect(within(list).getByText(text)).toBeInTheDocument()
    expect(list.querySelector('script, b')).toBeNull()
    window.location.hash = ''
  })
})
