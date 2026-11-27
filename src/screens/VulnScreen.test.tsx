import { describe, expect, it } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { follow, renderApp, waitForHeading } from '../test/renderApp.tsx'
import { fullSample as sample } from '../test/sampleData.ts'

describe('脆弱性', () => {
  it('深刻度ごとの件数カードと、CVE 番号・製品・CVSS・状況のカードを新しい順に出す', async () => {
    renderApp('#/vuln', sample)
    expect(await waitForHeading('脆弱性')).toBeInTheDocument()
    const stats = screen.getByRole('navigation', { name: '深刻度で絞り込む' })
    expect(within(stats).getAllByRole('link').map((a) => a.textContent)).toEqual(['Critical2', 'High1', 'Medium1', 'Low1'])
    expect(screen.getByText('すべてを表示中。5件(新しい順)')).toBeInTheDocument()
    const cards = screen.getByRole('list', { name: '脆弱性の一覧' }).querySelectorAll('li')
    expect(cards).toHaveLength(5)
    const first = cards[0]!
    expect(within(first).getByRole('link', { name: 'CVE-2026-90001' })).toHaveAttribute('href', '#/vuln/feed-007')
    expect(first).toHaveTextContent('Critical')
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
    const critical = within(stats).getByRole('link', { name: 'Critical2' })
    expect(critical).toHaveAttribute('href', '#/vuln?sev=critical')
    follow(critical)
    expect(window.location.hash).toBe('#/vuln?sev=critical')
    await screen.findByText('Criticalだけを表示中。2件(新しい順)')
    expect(within(stats).getByRole('link', { name: 'Critical2' })).toHaveAttribute('aria-current', 'true')
    expect(within(stats).getByRole('link', { name: 'Critical2' })).toHaveAttribute('href', '#/vuln')
    expect(screen.getByRole('list', { name: '脆弱性の一覧' }).querySelectorAll('li')).toHaveLength(2)
    expect(screen.getByRole('link', { name: '絞り込みを外す' })).toHaveAttribute('href', '#/vuln')

    follow(within(stats).getByRole('link', { name: 'Critical2' }))
    expect(window.location.hash).toBe('#/vuln')
    await screen.findByText('すべてを表示中。5件(新しい順)')
    window.location.hash = ''
  })

  it('URL に深刻度が入った状態で開いても同じ表示になる。0件なら案内', async () => {
    renderApp('#/vuln?sev=low', sample)
    await waitForHeading('脆弱性')
    expect(await screen.findByText('Lowだけを表示中。1件(新しい順)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'CVE-2026-90005' })).toBeInTheDocument()
    window.location.hash = ''
  })

  it('脆弱性が0件(公式フィードが無い)なら、絞り込みに関係なく「公式情報はまだありません」と出す', async () => {
    renderApp('#/vuln', { ...sample, feed: [] })
    expect(await screen.findByText('公式情報はまだありません')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '脆弱性の一覧' })).not.toBeInTheDocument()
    cleanup()
    renderApp('#/vuln?sev=critical', { ...sample, feed: [] })
    expect(await screen.findByText('Criticalだけを表示中。0件(新しい順)')).toBeInTheDocument()
    expect(screen.getByText('公式情報はまだありません')).toBeInTheDocument()
    window.location.hash = ''
  })

  it('個別の画面:CVE 番号、深刻度、CVSS、対象の製品、ベンダー、公開日、修正の状況、情報源(https だけリンク)', async () => {
    renderApp('#/vuln/feed-007', sample)
    expect(await waitForHeading('CVE-2026-90001')).toBeInTheDocument()
    const article = screen.getByRole('article')
    expect(within(article).getByText('Critical')).toBeInTheDocument()
    expect(within(article).getByText('9.8')).toBeInTheDocument()
    expect(within(article).getByText(/認証を回避される脆弱性/)).toBeInTheDocument()
    expect(within(article).getByText('見本ファイアウォール')).toBeInTheDocument()
    expect(within(article).getByText('サンプルネットワークス')).toBeInTheDocument()
    expect(within(article).getByText('1月3日')).toBeInTheDocument()
    expect(within(article).getByText('修正版 7.4.3 あり')).toBeInTheDocument()
    const source = within(article).getByRole('link', { name: /example\.com/ })
    expect(source).toHaveAttribute('href', 'https://example.com/feed/7')
    expect(source).toHaveAttribute('rel', 'noopener noreferrer')
    // TST-VULN-04 決まり文句の「確かめること」は出さない(詳細設計 5.6.3)
    expect(within(article).queryByRole('heading', { level: 2, name: '確かめること' })).not.toBeInTheDocument()
    expect(within(article).queryByText(/使っている版が対象に入るかを確かめ/)).not.toBeInTheDocument()
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
    await waitForHeading('今日のニュース')
    const rail = screen.getByRole('complementary', { name: '補助の情報' })
    expect(within(rail).getByRole('link', { name: 'CVE-2026-90001' })).toHaveAttribute('href', '#/vuln/feed-007')
    expect(within(rail).getByText('9.8')).toBeInTheDocument()
    expect(within(rail).getByRole('link', { name: '脆弱性をすべて見る' })).toHaveAttribute('href', '#/vuln')
    expect(within(rail).getByRole('link', { name: 'お知らせをすべて見る' })).toHaveAttribute('href', '#/feed')
    expect(within(rail).getByText('しおりの印を押すと、ここに並びます。')).toBeInTheDocument()
  })
})

describe('脆弱性のカード全体を押せる(依頼 13-2、詳細設計 5.6.1)', () => {
  it('TST-VULN-01 カードのリンクは CVE 番号の1つだけ(読み上げの名前も CVE 番号)。訳の行・製品・状況はリンクの外', async () => {
    renderApp('#/vuln', sample)
    await waitForHeading('脆弱性')
    const cards = screen.getByRole('list', { name: '脆弱性の一覧' }).querySelectorAll('li')
    expect(cards).toHaveLength(5)
    for (const card of cards) {
      const links = within(card).getAllByRole('link')
      expect(links).toHaveLength(1)
      expect(links[0]).toHaveAccessibleName(/^CVE-2026-\d+$/)
      expect(links[0]?.textContent).toMatch(/^CVE-2026-\d+$/)
    }
    // ::after をカードいっぱいに広げる CSS は、試験の設定(vite.config.ts の css.include)で読み込まれないため、
    // ここではクラスが付いていることだけを確かめる(CSS の中身は design-check の 375px の点検で確かめる)
    const first = cards[0]!
    expect(first.className).not.toBe('')
    expect(within(first).getByRole('link').className).not.toBe('')
    window.location.hash = ''
  })

  it('TST-VULN-01 絞りがあるとき、カードのリンクに ?sev= が付く。「すべて」なら付けない。トップ・さがすのカードも付けない', async () => {
    renderApp('#/vuln?sev=critical', sample)
    await screen.findByText('Criticalだけを表示中。2件(新しい順)')
    expect(screen.getByRole('link', { name: 'CVE-2026-90001' })).toHaveAttribute('href', '#/vuln/feed-007?sev=critical')
    expect(screen.getByRole('link', { name: 'CVE-2026-90003' })).toHaveAttribute('href', '#/vuln/feed-009?sev=critical')

    window.location.hash = '#/vuln'
    await screen.findByText('すべてを表示中。5件(新しい順)')
    expect(within(screen.getByRole('list', { name: '脆弱性の一覧' })).getByRole('link', { name: 'CVE-2026-90001' })).toHaveAttribute(
      'href',
      '#/vuln/feed-007',
    )

    window.location.hash = '#/search?q=CVE-2026-90001'
    await waitForHeading('「CVE-2026-90001」の結果')
    for (const link of await screen.findAllByRole('link', { name: 'CVE-2026-90001' })) {
      expect(link.getAttribute('href')).toBe('#/vuln/feed-007')
    }
    window.location.hash = ''
  })
})

// feed-007(Critical)にだけ架空の訳を付けた見本
const translated = { ...sample, feed: sample.feed.map((entry) => (entry.id === 'feed-007' ? { ...entry, titleJa: '架空の脆弱性の訳' } : entry)) }

describe('脆弱性の訳(詳細設計 5.3)', () => {
  it('TST-TRUI-03 カード:訳がある脆弱性は原文の直下に「機械翻訳」と訳を出す。リンクの外。無いカードは今のまま', async () => {
    renderApp('#/vuln', translated)
    await waitForHeading('脆弱性')
    const cards = screen.getByRole('list', { name: '脆弱性の一覧' }).querySelectorAll('li')
    const line = within(cards[0]!).getByText('架空の脆弱性の訳').closest('p')!
    expect(line).toHaveAttribute('lang', 'ja')
    expect(line).toHaveTextContent('機械翻訳架空の脆弱性の訳')
    expect(line.closest('a')).toBeNull()
    expect(line.previousElementSibling).toHaveAttribute('lang', 'en')
    expect(line.previousElementSibling).toHaveTextContent(/認証を回避される脆弱性/)
    expect(within(cards[0]!).getByRole('link', { name: 'CVE-2026-90001' })).toBeInTheDocument()
    for (const card of [...cards].slice(1)) {
      expect(card).not.toHaveTextContent('機械翻訳')
      expect(card.querySelector('[lang]')).toBeNull()
    }
    window.location.hash = ''
  })

  it('TST-TRUI-03 個別の画面:CVE 番号・深刻度の後、原文の直下に訳を出す。訳の無い脆弱性は今のまま', async () => {
    renderApp('#/vuln/feed-007', translated)
    await waitForHeading('CVE-2026-90001')
    const article = screen.getByRole('article')
    const line = within(article).getByText('架空の脆弱性の訳').closest('p')!
    expect(line).toHaveAttribute('lang', 'ja')
    expect(line).toHaveTextContent('機械翻訳架空の脆弱性の訳')
    expect(line.closest('a')).toBeNull()
    expect(line.previousElementSibling).toHaveAttribute('lang', 'en')
    expect(line.previousElementSibling).toHaveTextContent(/認証を回避される脆弱性/)

    window.location.hash = '#/vuln/feed-008'
    await waitForHeading('CVE-2026-90002')
    expect(screen.getByRole('article')).not.toHaveTextContent('機械翻訳')
    expect(screen.getByRole('article').querySelector('[lang]')).toBeNull()
    window.location.hash = ''
  })

  it('TST-TRUI-05 訳の中の <script> などは要素にならず、文字のまま出る(カードと個別の画面)', async () => {
    const text = '<script>alert(1)</script><img src=x onerror=alert(1)>'
    const data = { ...sample, feed: sample.feed.map((entry) => (entry.id === 'feed-007' ? { ...entry, titleJa: text } : entry)) }
    renderApp('#/vuln', data)
    await waitForHeading('脆弱性')
    const list = screen.getByRole('list', { name: '脆弱性の一覧' })
    expect(within(list).getByText(text)).toBeInTheDocument()
    expect(list.querySelector('script, img')).toBeNull()
    window.location.hash = '#/vuln/feed-007'
    await waitForHeading('CVE-2026-90001')
    expect(within(screen.getByRole('article')).getByText(text)).toBeInTheDocument()
    expect(screen.getByRole('article').querySelector('script, img')).toBeNull()
    window.location.hash = ''
  })
})
