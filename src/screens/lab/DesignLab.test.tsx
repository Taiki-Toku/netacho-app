import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../App.tsx'
import type { LoadedData } from '../../data/source.ts'
import { baseSample, fullSample } from '../../test/sampleData.ts'

async function renderLab(data: LoadedData) {
  window.location.hash = '#/design-lab'
  render(<App load={() => Promise.resolve(data)} />)
  await screen.findByRole('heading', { level: 1, name: 'デザイン案の見比べ' })
}

/** jsdom は Touch を持たないため、素の Event に changedTouches を付けて流す */
function touch(target: Element, type: 'touchstart' | 'touchend', x: number, y: number) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'changedTouches', { value: [{ clientX: x, clientY: y }] })
  fireEvent(target, event)
}

describe('デザイン案の見比べ(仮の画面)', () => {
  it('4案を切り替えられ、各案で今日の放送と詳細が出る', async () => {
    const user = userEvent.setup()
    await renderLab(fullSample)
    for (const name of ['案1 生放送', '案2 朝刊フリップ', '案3 スタジオの時計', '案4 ニュースアプリ型']) {
      await user.click(screen.getByRole('button', { name }))
      await user.click(screen.getByRole('button', { name: '今日の放送' }))
      expect(screen.getByRole('list', { name: /進行表|この後のネタ/ })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ネタの詳細' }))
      expect(screen.getByRole('article')).toBeInTheDocument()
    }
  })

  // 案1〜3は最新日の放送だけを見せるため、「表示の安全確認」のネタが最新日にある基本の 9 本で確かめる
  it('案1〜3は、https 以外の出典はリンクにせず、HTML 入りの見出しは文字のまま出す', async () => {
    const user = userEvent.setup()
    await renderLab(baseSample)
    for (const name of ['案1 生放送', '案2 朝刊フリップ', '案3 スタジオの時計']) {
      await user.click(screen.getByRole('button', { name }))
      await user.click(screen.getByRole('button', { name: 'ネタの詳細' }))
      await user.click(screen.getByRole('button', { name: /次の/ }))
      // 7本目まで進む
      for (let step = 0; step < 5; step += 1) {
        await user.click(screen.getByRole('button', { name: /次の/ }))
      }
      const article = screen.getByRole('article')
      expect(within(article).getByRole('heading', { level: 2 })).toHaveTextContent('<script>alert(1)</script>')
      expect(article.querySelector('script')).toBeNull()
      expect(article.querySelector('a[href^="javascript:"]')).toBeNull()
      expect(within(article).getByText('javascript:alert(1)')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '今日の放送' }))
    }
  })
})

describe('案4 ニュースアプリ型', () => {
  async function renderNews() {
    const user = userEvent.setup()
    await renderLab(fullSample)
    await user.click(screen.getByRole('button', { name: '案4 ニュースアプリ型' }))
    return user
  }

  it('「今日」と fixtures のジャンルがタブに並び、今日は最新日の 6 本を番組の順番で出す', async () => {
    await renderNews()
    const tabs = within(screen.getByRole('tablist', { name: 'ジャンル' })).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '今日',
      '仕事・自動化',
      'エージェント',
      'ローカルLLM',
      'セキュリティニュース',
      'プロダクト',
      '脆弱性',
      'VTuber・創作',
      'ツール・業界',
    ])
    expect(screen.getByRole('tab', { name: '今日', selected: true })).toBeInTheDocument()
    const panel = screen.getByRole('tabpanel')
    // 先頭の1本は大きく、残りの5本は「この後のネタ」
    expect(within(panel).getByText('架空:サンプル商事で不正アクセス、会員情報およそ12万件が流出か')).toBeInTheDocument()
    expect(within(within(panel).getByRole('list', { name: 'この後のネタ' })).getAllByRole('listitem')).toHaveLength(5)
    expect(within(panel).getAllByText('セキュリティ速報')).toHaveLength(2)
    expect(within(panel).getByText('2026年1月3日(土)の放送は以上です。')).toBeInTheDocument()
  })

  it('セキュリティニュースのタブ:そのジャンルのネタを新しい順に出し、障害のフィードを別の枠で出す', async () => {
    const user = await renderNews()
    await user.click(screen.getByRole('tab', { name: 'セキュリティニュース' }))
    const panel = screen.getByRole('tabpanel', { name: 'セキュリティニュース' })
    // 先頭(新しい順の1本目)+ 残り4本。別の日のネタ(2026-01-02-06)も含む
    expect(within(panel).getByText('架空:サンプル商事で不正アクセス、会員情報およそ12万件が流出か')).toBeInTheDocument()
    expect(within(within(panel).getByRole('list', { name: 'セキュリティニュースの新着' })).getAllByRole('listitem')).toHaveLength(4)
    // ジャンルのタブではコーナーの札を出さない
    expect(within(panel).queryByText('セキュリティ速報')).not.toBeInTheDocument()
    // 障害の枠:3件、状態の札、日本時間
    const frame = within(panel).getByRole('region', { name: /障害情報/ })
    expect(within(frame).getAllByRole('listitem')).toHaveLength(3)
    expect(within(frame).getByText('調査中')).toBeInTheDocument()
    expect(within(frame).getAllByText('復旧済み')).toHaveLength(2)
    expect(within(frame).getByText('1/3 14:20')).toBeInTheDocument()
    // https の URL だけリンクにする。http: の見本(feed-013)は文字のまま
    const links = within(frame).getAllByRole('link')
    expect(links).toHaveLength(2)
    for (const link of links) {
      expect(link.getAttribute('href')).toMatch(/^https:\/\//)
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    }
    expect(within(frame).getByText('http://example.com/not-https')).toBeInTheDocument()
    expect(frame.querySelector('a[href^="http://"]')).toBeNull()
  })

  it('プロダクトのタブ:公式の発表を製品で絞り込める', async () => {
    const user = await renderNews()
    await user.click(screen.getByRole('tab', { name: 'プロダクト' }))
    const panel = screen.getByRole('tabpanel', { name: 'プロダクト' })
    const frame = within(panel).getByRole('region', { name: /公式の発表/ })
    expect(within(frame).getAllByRole('listitem')).toHaveLength(6)
    expect(within(frame).getByText('サポート期限')).toBeInTheDocument()
    expect(within(frame).getByText('試験の変更')).toBeInTheDocument()
    await user.click(within(frame).getByRole('button', { name: 'サンプルOS Server' }))
    expect(within(frame).getAllByRole('listitem')).toHaveLength(2)
    expect(within(frame).getByText('2件')).toBeInTheDocument()
    await user.click(within(frame).getByRole('button', { name: 'すべて' }))
    expect(within(frame).getAllByRole('listitem')).toHaveLength(6)
  })

  it('脆弱性のタブ:深刻さの札が付き、ネタが無い旨を出す', async () => {
    const user = await renderNews()
    await user.click(screen.getByRole('tab', { name: '脆弱性' }))
    const panel = screen.getByRole('tabpanel', { name: '脆弱性' })
    const frame = within(panel).getByRole('region', { name: /脆弱性の公式情報/ })
    const marks = within(frame).getAllByText('深刻さ')
    expect(marks.map((mark) => mark.parentElement?.textContent)).toEqual(['深刻さ 緊急', '深刻さ 高', '深刻さ 緊急', '深刻さ 中'])
    expect(within(panel).getByText('このジャンルのネタはまだありません。')).toBeInTheDocument()
  })

  it('左右のスワイプと矢印キーでタブが切り替わる', async () => {
    const user = await renderNews()
    const panel = screen.getByRole('tabpanel', { name: '今日' })
    touch(panel, 'touchstart', 300, 200)
    touch(panel, 'touchend', 100, 210)
    expect(screen.getByRole('tab', { name: '仕事・自動化', selected: true })).toBeInTheDocument()
    const next = screen.getByRole('tabpanel', { name: '仕事・自動化' })
    touch(next, 'touchstart', 100, 200)
    touch(next, 'touchend', 300, 190)
    expect(screen.getByRole('tab', { name: '今日', selected: true })).toBeInTheDocument()

    screen.getByRole('tab', { name: '今日' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: '仕事・自動化', selected: true })).toBeInTheDocument()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: '今日', selected: true })).toBeInTheDocument()
  })

  it('詳細は、そのタブの一覧の中で前後に移る。HTML 入りの見出しは文字のまま、javascript: はリンクにしない', async () => {
    const user = await renderNews()
    await user.click(screen.getByRole('tab', { name: 'プロダクト' }))
    // プロダクトのネタは 2026-01-03-05(先頭)と 2026-01-02-07(表示の安全確認)の2本
    await user.click(screen.getByRole('button', { name: /サンプル管理者試験/ }))
    let article = screen.getByRole('article')
    expect(within(article).getByText('1/2')).toBeInTheDocument()
    expect(within(article).getByRole('button', { name: '前のネタ' })).toBeDisabled()
    await user.click(within(article).getByRole('button', { name: '次のネタ' }))
    article = screen.getByRole('article')
    expect(within(article).getByRole('heading', { level: 2 })).toHaveTextContent('<script>alert(1)</script>')
    expect(article.querySelector('script')).toBeNull()
    expect(article.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(within(article).getByText('javascript:alert(1)')).toBeInTheDocument()
    expect(within(article).getByRole('button', { name: '次のネタ' })).toBeDisabled()
    // 戻ると、同じタブの一覧に戻る
    await user.click(within(article).getByRole('button', { name: 'プロダクトの一覧へ' }))
    expect(screen.getByRole('tab', { name: 'プロダクト', selected: true })).toBeInTheDocument()
  })

  it('公式フィードの見出しが HTML 入り・URL が javascript: でも、文字のまま出してリンクにしない', async () => {
    const user = userEvent.setup()
    // 見本のフィードは書き換えず、試験の中で危ないフィードを1本だけ足す
    const hostile: LoadedData = {
      ...fullSample,
      feed: [
        {
          id: 'test-hostile',
          kind: 'vuln',
          product: '<img src=x onerror=alert(1)>',
          vendor: '',
          title: '<script>alert(1)</script>見本の脆弱性',
          publishedAt: '2026-01-03T00:00:00Z',
          url: 'javascript:alert(1)',
          severity: 'high',
          status: '',
        },
      ],
    }
    await renderLab(hostile)
    await user.click(screen.getByRole('button', { name: '案4 ニュースアプリ型' }))
    await user.click(screen.getByRole('tab', { name: '脆弱性' }))
    const frame = screen.getByRole('region', { name: /脆弱性の公式情報/ })
    expect(within(frame).queryAllByRole('link')).toHaveLength(0)
    expect(frame.querySelector('script, img')).toBeNull()
    expect(within(frame).getByText('<script>alert(1)</script>見本の脆弱性')).toBeInTheDocument()
    expect(within(frame).getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
    expect(within(frame).getByText('javascript:alert(1)')).toBeInTheDocument()
  })

  it('https: の出典はリンクになり、新しいタブで安全に開く', async () => {
    const user = await renderNews()
    await user.click(screen.getByRole('button', { name: 'ネタの詳細' }))
    const article = screen.getByRole('article')
    const link = within(article).getByRole('link', { name: /サンプル商事のお知らせ/ })
    expect(link).toHaveAttribute('href', 'https://example.com/incident-a')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
