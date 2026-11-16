import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import { follow, renderApp, waitForHeading } from '../test/renderApp.tsx'
import { fullSample as sample } from '../test/sampleData.ts'

describe('脆弱性', () => {
  it('深刻度ごとの件数カードと、CVE 番号・製品・CVSS・状況のカードを新しい順に出す', async () => {
    renderApp('#/vuln', sample)
    expect(await waitForHeading('脆弱性')).toBeInTheDocument()
    const stats = screen.getByRole('navigation', { name: '深刻度で絞り込む' })
    expect(within(stats).getAllByRole('link').map((a) => a.textContent)).toEqual(['緊急2', '重要1', '警告1', '注意1'])
    expect(screen.getByText('すべてを表示中。5件(新しい順)')).toBeInTheDocument()
    const cards = screen.getByRole('list', { name: '脆弱性の一覧' }).querySelectorAll('li')
    expect(cards).toHaveLength(5)
    const first = cards[0]!
    expect(within(first).getByRole('link', { name: 'CVE-2026-90001' })).toHaveAttribute('href', '#/vuln/feed-007')
    expect(first).toHaveTextContent('緊急')
    expect(first).toHaveTextContent('見本ファイアウォール(サンプルネットワークス)')
    expect(first).toHaveTextContent('9.8')
    expect(first).toHaveTextContent('修正版 7.4.3 あり')
    expect(first).toHaveTextContent('公開 1月3日')
    expect(screen.getByText('CVE番号と点数は、画面を確かめるための架空のものです。')).toBeInTheDocument()
  })

  it('件数カードを押すとその深刻度だけになり、URL に残る。もう一度押すと解除', async () => {
    renderApp('#/vuln', sample)
    await waitForHeading('脆弱性')
    const stats = screen.getByRole('navigation', { name: '深刻度で絞り込む' })
    const critical = within(stats).getByRole('link', { name: '緊急2' })
    expect(critical).toHaveAttribute('href', '#/vuln?sev=critical')
    follow(critical)
    expect(window.location.hash).toBe('#/vuln?sev=critical')
    await screen.findByText('緊急だけを表示中。2件(新しい順)')
    expect(within(stats).getByRole('link', { name: '緊急2' })).toHaveAttribute('aria-current', 'true')
    expect(within(stats).getByRole('link', { name: '緊急2' })).toHaveAttribute('href', '#/vuln')
    expect(screen.getByRole('list', { name: '脆弱性の一覧' }).querySelectorAll('li')).toHaveLength(2)
    expect(screen.getByRole('link', { name: '絞り込みを外す' })).toHaveAttribute('href', '#/vuln')

    follow(within(stats).getByRole('link', { name: '緊急2' }))
    expect(window.location.hash).toBe('#/vuln')
    await screen.findByText('すべてを表示中。5件(新しい順)')
    window.location.hash = ''
  })

  it('URL に深刻度が入った状態で開いても同じ表示になる。0件なら案内', async () => {
    renderApp('#/vuln?sev=low', sample)
    await waitForHeading('脆弱性')
    expect(await screen.findByText('注意だけを表示中。1件(新しい順)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CVE-2026-90005' })).toBeInTheDocument()
    renderApp('#/vuln', { ...sample, feed: [] })
    expect(await screen.findByText('脆弱性の情報はありません')).toBeInTheDocument()
    window.location.hash = ''
  })

  it('個別の画面:CVE 番号、深刻度、CVSS、対象の製品、ベンダー、公開日、修正の状況、情報源(https だけリンク)', async () => {
    renderApp('#/vuln/feed-007', sample)
    expect(await waitForHeading('CVE-2026-90001')).toBeInTheDocument()
    const article = screen.getByRole('article')
    expect(within(article).getByText('緊急')).toBeInTheDocument()
    expect(within(article).getByText('9.8')).toBeInTheDocument()
    expect(within(article).getByText(/認証を回避される脆弱性/)).toBeInTheDocument()
    expect(within(article).getByText('見本ファイアウォール')).toBeInTheDocument()
    expect(within(article).getByText('サンプルネットワークス')).toBeInTheDocument()
    expect(within(article).getByText('1月3日')).toBeInTheDocument()
    expect(within(article).getByText('修正版 7.4.3 あり')).toBeInTheDocument()
    const source = within(article).getByRole('link', { name: /example\.com/ })
    expect(source).toHaveAttribute('href', 'https://example.com/feed/7')
    expect(source).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(article).getByRole('heading', { level: 2, name: '確かめること' })).toBeInTheDocument()
    expect(within(article).getByRole('link', { name: '脆弱性の一覧に戻る' })).toHaveAttribute('href', '#/vuln')
    window.location.hash = ''
  })

  it('個別の画面:無い id や、脆弱性でないフィードの id なら見つからない旨を出す', async () => {
    renderApp('#/vuln/feed-001', sample)
    expect(await waitForHeading('この脆弱性は見つかりません')).toBeInTheDocument()
    window.location.hash = ''
  })

  it('右の列の脆弱性ウォッチには、深刻度がいちばん高い中でいちばん新しい1件を出す', async () => {
    renderApp('', sample)
    await waitForHeading('今朝のネタ')
    const rail = screen.getByRole('complementary', { name: '補助の情報' })
    expect(within(rail).getByRole('link', { name: 'CVE-2026-90001' })).toHaveAttribute('href', '#/vuln/feed-007')
    expect(within(rail).getByText('9.8')).toBeInTheDocument()
    expect(within(rail).getByRole('link', { name: '脆弱性をすべて見る' })).toHaveAttribute('href', '#/vuln')
    expect(within(rail).getByRole('link', { name: 'お知らせをすべて見る' })).toHaveAttribute('href', '#/feed')
    expect(within(rail).getByText('しおりの印を押すと、ここに並びます。')).toBeInTheDocument()
  })
})
