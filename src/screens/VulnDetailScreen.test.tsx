import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { follow, renderApp, waitForHeading } from '../test/renderApp.tsx'
import { fullSample as sample } from '../test/sampleData.ts'

// 見本の脆弱性は新しい順に feed-007(Critical)→ 008(High)→ 009(Critical)→ 010(Medium)→ 014(Low)

type TouchType = 'touchstart' | 'touchmove' | 'touchend'

/** jsdom は Touch を持たないため、素の Event に touches を付けて流す(ItemScreen.test.tsx と同じ) */
function touch(target: Element, type: TouchType, x: number, y: number, time: number) {
  const event = new Event(type, { bubbles: true })
  const point = { clientX: x, clientY: y }
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [point] })
  Object.defineProperty(event, 'changedTouches', { value: [point] })
  Object.defineProperty(event, 'timeStamp', { value: time })
  fireEvent(target, event)
}

/** 横に dx だけゆっくり動かして離す(jsdom の画面幅 1024px の 25% より大きく動かす) */
function swipe(target: Element, dx: number) {
  touch(target, 'touchstart', 500, 300, 1000)
  touch(target, 'touchmove', 500 + dx / 2, 300, 2000)
  touch(target, 'touchmove', 500 + dx, 300, 3000)
  touch(target, 'touchend', 500 + dx, 300, 3000)
}

function pager() {
  return screen.getByRole('navigation', { name: '前後の脆弱性' })
}

describe('脆弱性の詳細の前後(依頼 13-2、詳細設計 5.6.2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    window.location.hash = ''
  })

  it('TST-VULN-03 絞りが無ければ、一覧の順(新しい順)に前後へ移る。端では押せない文字', async () => {
    renderApp('#/vuln/feed-007', sample)
    await waitForHeading('CVE-2026-90001')
    expect(within(pager()).queryByRole('link', { name: '前の脆弱性' })).not.toBeInTheDocument()
    expect(within(pager()).getByText('前の脆弱性')).toBeInTheDocument()
    expect(within(pager()).getByText('1 / 5')).toBeInTheDocument()
    const next = within(pager()).getByRole('link', { name: '次の脆弱性' })
    expect(next).toHaveAttribute('href', '#/vuln/feed-008')
    follow(next)
    await waitForHeading('CVE-2026-90002')
    expect(within(pager()).getByRole('link', { name: '前の脆弱性' })).toHaveAttribute('href', '#/vuln/feed-007')
    expect(within(pager()).getByRole('link', { name: '次の脆弱性' })).toHaveAttribute('href', '#/vuln/feed-009')

    window.location.hash = '#/vuln/feed-014'
    await waitForHeading('CVE-2026-90005')
    expect(within(pager()).getByText('5 / 5')).toBeInTheDocument()
    expect(within(pager()).getByRole('link', { name: '前の脆弱性' })).toHaveAttribute('href', '#/vuln/feed-010')
    expect(within(pager()).queryByRole('link', { name: '次の脆弱性' })).not.toBeInTheDocument()
    expect(within(pager()).getByText('次の脆弱性')).toBeInTheDocument()
  })

  it('TST-VULN-03 深刻度で絞っていたら、その絞りの中で移る。リンクに ?sev= が付き、戻るは絞りつきの一覧', async () => {
    renderApp('#/vuln/feed-007?sev=critical', sample)
    await waitForHeading('CVE-2026-90001')
    const article = screen.getByRole('article')
    expect(within(article).getByRole('link', { name: '脆弱性の一覧に戻る' })).toHaveAttribute('href', '#/vuln?sev=critical')
    expect(within(pager()).getByText('1 / 2')).toBeInTheDocument()
    // 008(High)を飛ばして 009(Critical)へ
    const next = within(pager()).getByRole('link', { name: '次の脆弱性' })
    expect(next).toHaveAttribute('href', '#/vuln/feed-009?sev=critical')
    follow(next)
    await waitForHeading('CVE-2026-90003')
    expect(within(pager()).getByText('2 / 2')).toBeInTheDocument()
    expect(within(pager()).getByRole('link', { name: '前の脆弱性' })).toHaveAttribute('href', '#/vuln/feed-007?sev=critical')
    expect(within(pager()).queryByRole('link', { name: '次の脆弱性' })).not.toBeInTheDocument()
    // 絞りの値は画面に文字として出さない
    expect(screen.getByRole('article')).not.toHaveTextContent('sev=')
  })

  it('TST-VULN-03 左右のスワイプで、絞りの中の前後へ移る(端では移らない)', async () => {
    // 動きを減らす設定にして、離した時点で切り替える(動きの終わりを待たない)
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
    renderApp('#/vuln/feed-007?sev=critical', sample)
    await waitForHeading('CVE-2026-90001')
    // 最初の1件で右へ払っても(前が無い)移らない
    swipe(screen.getByRole('article'), 300)
    expect(window.location.hash).toBe('#/vuln/feed-007?sev=critical')
    // 左へ払うと次へ
    swipe(screen.getByRole('article'), -300)
    expect(window.location.hash).toBe('#/vuln/feed-009?sev=critical')
    await waitForHeading('CVE-2026-90003')
    // 右へ払うと前へ
    swipe(screen.getByRole('article'), 300)
    expect(window.location.hash).toBe('#/vuln/feed-007?sev=critical')
    await waitForHeading('CVE-2026-90001')
  })

  it('TST-VULN-03 縦の動きでは移らない', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    renderApp('#/vuln/feed-008', sample)
    await waitForHeading('CVE-2026-90002')
    const article = screen.getByRole('article')
    touch(article, 'touchstart', 500, 300, 1000)
    touch(article, 'touchmove', 504, 340, 1100)
    touch(article, 'touchmove', 200, 600, 1200)
    touch(article, 'touchend', 200, 600, 1210)
    expect(window.location.hash).toBe('#/vuln/feed-008')
  })

  it('TST-VULN-03 絞りに入らない id・無い id は「見つからない」(前後は出さない)。戻るは絞りつきの一覧', async () => {
    renderApp('#/vuln/feed-008?sev=critical', sample)
    expect(await waitForHeading('この脆弱性は見つかりません')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '前後の脆弱性' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '脆弱性の一覧に戻る' })).toHaveAttribute('href', '#/vuln?sev=critical')

    window.location.hash = '#/vuln/nowhere'
    expect(await waitForHeading('この脆弱性は見つかりません')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '前後の脆弱性' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '脆弱性の一覧に戻る' })).toHaveAttribute('href', '#/vuln')
  })

  it('TST-VULN-04 詳細に「確かめること」が無い', async () => {
    renderApp('#/vuln/feed-007', sample)
    for (const [id, cve] of [
      ['feed-007', 'CVE-2026-90001'],
      ['feed-008', 'CVE-2026-90002'],
      ['feed-014', 'CVE-2026-90005'],
    ] as const) {
      window.location.hash = `#/vuln/${id}`
      await waitForHeading(cve)
      const article = screen.getByRole('article')
      expect(within(article).queryByRole('heading', { name: '確かめること' })).not.toBeInTheDocument()
      expect(article).not.toHaveTextContent('確かめること')
    }
  })
})
