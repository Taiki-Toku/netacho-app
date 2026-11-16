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
    // 頭文字の札(製品名の2文字)。ロゴは使わない
    expect(within(rows[0]!).getByText('サン', { selector: 'div' })).toBeInTheDocument()
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
