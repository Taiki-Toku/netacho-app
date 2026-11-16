import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { follow, renderApp, waitForHeading } from '../test/renderApp.tsx'
import { fullSample as sample } from '../test/sampleData.ts'

describe('ジャンルの画面', () => {
  it('そのジャンルのネタを新しい順に出す。ジャンルの名前は fixtures から', async () => {
    renderApp('#/genre/work', sample)
    expect(await waitForHeading('仕事・自動化')).toBeInTheDocument()
    expect(screen.getByText('3本のネタ')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: '仕事・自動化のネタ' })
    expect([...list.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '#/item/2026-01-03-06',
      '#/item/2026-01-02-01',
      '#/item/2026-01-01-01',
    ])
    expect(screen.queryByRole('heading', { level: 2, name: '公式のお知らせ' })).not.toBeInTheDocument()
    const genres = screen.getByRole('navigation', { name: 'ジャンル' })
    expect(within(genres).getByRole('link', { name: '仕事・自動化', current: 'page' })).toBeInTheDocument()
  })

  it('プロダクトだけ、下に公式のお知らせと種類の絞り込みを出す。絞り込みは URL に残る', async () => {
    renderApp('#/genre/product', sample)
    expect(await waitForHeading('プロダクト')).toBeInTheDocument()
    expect(screen.getByText('2本のネタと、公式のお知らせ')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: '公式のお知らせ' })).toBeInTheDocument()
    const chips = screen.getByRole('navigation', { name: 'お知らせの種類' })
    expect(within(chips).getAllByRole('link').map((a) => a.textContent)).toEqual(['すべて', 'リリース', 'サポート終了', '試験', '障害'])
    expect(within(chips).getByRole('link', { name: 'すべて' })).toHaveAttribute('aria-current', 'true')
    // 脆弱性はお知らせには混ぜない(見本は脆弱性 5 件を除く 9 件)
    expect(screen.getByRole('list', { name: '公式のお知らせ' }).querySelectorAll('li')).toHaveLength(9)
    expect(screen.getByText('9件')).toBeInTheDocument()

    follow(within(chips).getByRole('link', { name: '障害' }))
    expect(window.location.hash).toBe('#/genre/product?kind=outage')
    await screen.findByText('3件')
    expect(within(chips).getByRole('link', { name: '障害' })).toHaveAttribute('aria-current', 'true')
    const rows = screen.getByRole('list', { name: '公式のお知らせ' }).querySelectorAll('li')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('障害 調査中')
    window.location.hash = ''
  })

  it('再読み込み(URL に絞り込みが入った状態で開く)でも同じ表示になる', async () => {
    renderApp('#/genre/product?kind=eol', sample)
    expect(await waitForHeading('プロダクト')).toBeInTheDocument()
    const chips = screen.getByRole('navigation', { name: 'お知らせの種類' })
    expect(within(chips).getByRole('link', { name: 'サポート終了' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('list', { name: '公式のお知らせ' }).querySelectorAll('li')).toHaveLength(1)
    window.location.hash = ''
  })

  it('ネタが無いジャンルと、知らないジャンルは、その旨を出す', async () => {
    renderApp('#/genre/creative', { ...sample, items: sample.items.filter((item) => item.genre !== 'creative') })
    expect(await waitForHeading('VTuber・創作')).toBeInTheDocument()
    expect(screen.getByText('今朝はこのジャンルのネタがありません')).toBeInTheDocument()
    window.location.hash = '#/genre/nowhere'
    expect(await screen.findByText('このジャンルはありません')).toBeInTheDocument()
    window.location.hash = ''
  })
})
