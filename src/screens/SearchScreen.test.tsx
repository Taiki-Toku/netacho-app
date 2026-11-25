import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { goHistory, renderApp, waitForHeading } from '../test/renderApp.tsx'
import { fullSample as sample } from '../test/sampleData.ts'
import tokensCss from '../styles/tokens.css?raw'
import progressCss from '../components/ReadingProgress.module.css?raw'
import topBarCss from '../components/TopBar.module.css?raw'
import globalCss from '../styles/global.css?raw'

describe('さがす', () => {
  it('上の欄に入れて送ると、検索語が URL に入り、ニュース・公式のお知らせ・脆弱性・ジャンルを分けて出す', async () => {
    renderApp('', sample)
    await waitForHeading('今日のニュース')
    const form = screen.getByRole('search')
    const input = within(form).getByRole('combobox', { name: '検索語' })
    fireEvent.change(input, { target: { value: ' サンプルOS ' } })
    fireEvent.submit(form)
    expect(window.location.hash).toBe('#/search?q=%E3%82%B5%E3%83%B3%E3%83%97%E3%83%ABOS')
    expect(await waitForHeading('「サンプルOS」の結果')).toBeInTheDocument()
    expect(input).toHaveValue('サンプルOS')

    expect(screen.getByText('一致するニュースがありません')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '一致するお知らせ' }).querySelectorAll('li')).toHaveLength(2)
    const vulns = screen.getByRole('list', { name: '一致する脆弱性' })
    expect(within(vulns).getByRole('link', { name: 'CVE-2026-90002' })).toBeInTheDocument()
    window.location.hash = ''
  })

  it('ネタは見出し・リード・要約・タグ・出典名・ジャンル名で探せる。語は空白で区切って全部含むものだけ', async () => {
    renderApp('#/search?q=手順書', sample)
    expect(await waitForHeading('「手順書」の結果')).toBeInTheDocument()
    const items = screen.getByRole('list', { name: '一致するニュース' })
    expect([...items.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '#/item/2026-01-03-06',
      '#/item/2026-01-02-01',
      '#/item/2026-01-02-03',
    ])
    window.location.hash = '#/search?q=手順書 差分'
    await waitForHeading('「手順書 差分」の結果')
    expect(screen.getByRole('list', { name: '一致するニュース' }).querySelectorAll('li')).toHaveLength(1)
    window.location.hash = '#/search?q=CVE-2026-90005'
    await waitForHeading('「CVE-2026-90005」の結果')
    expect(screen.getByRole('link', { name: 'CVE-2026-90005' })).toBeInTheDocument()
    window.location.hash = ''
  })

  it('TST-TRUI-04 公式のお知らせ・脆弱性は見出しの訳の語でも当たり、結果にも訳の行を出す', async () => {
    const data = {
      ...sample,
      feed: sample.feed.map((entry) =>
        entry.id === 'feed-011' ? { ...entry, titleJa: '架空のかやくご飯' } : entry.id === 'feed-007' ? { ...entry, titleJa: '架空のかやくご飯の脆弱性' } : entry,
      ),
    }
    renderApp('#/search?q=かやくご飯', data)
    expect(await waitForHeading('「かやくご飯」の結果')).toBeInTheDocument()
    const feed = screen.getByRole('list', { name: '一致するお知らせ' })
    expect(feed.querySelectorAll('li')).toHaveLength(1)
    expect(within(feed).getByText('架空のかやくご飯').closest('p')).toHaveAttribute('lang', 'ja')
    const vulns = screen.getByRole('list', { name: '一致する脆弱性' })
    expect(within(vulns).getByRole('link', { name: 'CVE-2026-90001' })).toBeInTheDocument()
    expect(within(vulns).getByText('架空のかやくご飯の脆弱性').closest('p')).toHaveTextContent('機械翻訳架空のかやくご飯の脆弱性')
    window.location.hash = ''
  })

  it('検索語が空なら案内を出す。検索語に HTML が入っていても文字のまま', async () => {
    renderApp('#/search', sample)
    expect(await waitForHeading('さがす')).toBeInTheDocument()
    expect(screen.getByText('上の欄に言葉を入れてください')).toBeInTheDocument()
    window.location.hash = '#/search?q=%3Cb%3Ex%3C%2Fb%3E'
    const heading = await waitForHeading('「<b>x</b>」の結果')
    expect(heading.querySelector('b')).toBeNull()
    window.location.hash = ''
  })

  it('スマホ用の虫めがねのボタンで欄を開閉できる', async () => {
    renderApp('', sample)
    await waitForHeading('今日のニュース')
    const toggle = screen.getByRole('button', { name: '検索欄を開く' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '検索欄を閉じる' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('combobox', { name: '検索語' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '検索を閉じる' }))
    expect(screen.getByRole('button', { name: '検索欄を開く' })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('さがす:入力中の候補', () => {
  async function typeInSearch(text: string) {
    renderApp('', sample)
    await waitForHeading('今日のニュース')
    const input = screen.getByRole('combobox', { name: '検索語' })
    const user = userEvent.setup()
    await user.click(input)
    await user.type(input, text)
    return { input, user }
  }

  it('入力すると分類ごとに見出しを付けて候補を出す。0件の分類は出さない', async () => {
    const { input } = await typeInSearch('エージェント')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    const listbox = screen.getByRole('listbox', { name: '候補' })
    expect(input).toHaveAttribute('aria-controls', listbox.id)
    const groups = within(listbox).getAllByRole('group')
    expect(groups.map((group) => group.getAttribute('aria-labelledby')).map((id) => document.getElementById(id ?? '')?.textContent)).toEqual([
      'ニュース',
      'ジャンル',
    ])
    const [news, genre] = groups
    if (news === undefined || genre === undefined) throw new Error('分類が足りません')
    expect(within(news).getAllByRole('option')).toHaveLength(2)
    expect(within(genre).getByRole('option', { name: 'エージェント' })).toBeInTheDocument()
    expect(within(screen.getByRole('search')).getByRole('status')).toHaveTextContent('候補 3件')
    // キーボードの案内は読み上げに出さない(PC だけに見せる。CSS の media query で隠すので、ここでは確かめられない)
    expect(screen.getByText('↑↓ で選ぶ / Enter で開く / Esc で閉じる')).toHaveAttribute('aria-hidden', 'true')
    window.location.hash = ''
  })

  it('↑↓で移り(端で折り返す)、Enter でその候補を開く。「戻る」で元の画面に戻る', async () => {
    const { input, user } = await typeInSearch('エージェント')
    const options = screen.getAllByRole('option')
    await user.keyboard('{ArrowDown}')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id)
    await user.keyboard('{ArrowUp}')
    expect(options[2]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
    await user.keyboard('{Enter}')
    expect(window.location.hash).toBe('#/item/2026-01-02-05')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveValue('')
    await goHistory(-1)
    expect(window.location.hash).toBe('')
    expect(await waitForHeading('今日のニュース')).toBeInTheDocument()
    window.location.hash = ''
  })

  it('ジャンルの候補を押すとジャンルの画面へ。公式のお知らせの候補は結果の画面へ(外部リンクにしない)', async () => {
    const { user } = await typeInSearch('エージェント')
    await user.click(screen.getByRole('option', { name: 'エージェント' }))
    expect(window.location.hash).toBe('#/genre/agent')
    await waitForHeading('エージェント')
    const input = screen.getByRole('combobox', { name: '検索語' })
    await user.click(input)
    await user.type(input, 'サンプルOS')
    await user.click(screen.getByRole('option', { name: /サンプルOS Server 10\.2 を公開/ }))
    expect(window.location.hash).toBe('#/search?q=%E3%82%B5%E3%83%B3%E3%83%97%E3%83%ABOS')
    expect(await waitForHeading('「サンプルOS」の結果')).toBeInTheDocument()
    expect(input).toHaveValue('サンプルOS')
    window.location.hash = ''
  })

  it('Esc で候補を閉じ、欄の中身は残す。候補を選ばずに Enter なら結果の画面へ', async () => {
    const { input, user } = await typeInSearch('エージェント')
    await user.keyboard('{ArrowDown}{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).not.toHaveAttribute('aria-activedescendant')
    expect(screen.getByRole('listbox', { hidden: true })).not.toBeVisible()
    expect(input).toHaveValue('エージェント')
    await user.keyboard('{Enter}')
    expect(window.location.hash).toBe('#/search?q=%E3%82%A8%E3%83%BC%E3%82%B8%E3%82%A7%E3%83%B3%E3%83%88')
    expect(await waitForHeading('「エージェント」の結果')).toBeInTheDocument()
    window.location.hash = ''
  })

  it('日本語の変換中の ↑↓・Enter・Esc は候補の操作にしない(IME に任せる)', async () => {
    const { input } = await typeInSearch('エージェント')
    fireEvent.keyDown(input, { key: 'ArrowDown', isComposing: true })
    expect(input).not.toHaveAttribute('aria-activedescendant')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(input).toHaveAttribute('aria-activedescendant')
    // Safari の確定の Enter(isComposing が false でも keyCode 229)
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true })
    expect(window.location.hash).toBe('')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    window.location.hash = ''
  })

  it('候補が0件なら一覧を開かず、「候補はありません」と読み上げる', async () => {
    const { input, user } = await typeInSearch('zzzz')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(within(screen.getByRole('search')).getByRole('status')).toHaveTextContent('候補はありません')
    await user.keyboard('{ArrowDown}')
    expect(input).not.toHaveAttribute('aria-activedescendant')
    window.location.hash = ''
  })

  it('スマホで開いた欄は、Esc・送信で閉じ、虫めがねのボタンにフォーカスを返す。記事の候補を開いたら記事の見出しへ', async () => {
    renderApp('', sample)
    await waitForHeading('今日のニュース')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '検索欄を開く' }))
    expect(screen.getByRole('combobox', { name: '検索語' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: '検索欄を開く' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: '検索欄を開く' }))
    await user.keyboard('エージェント{Enter}')
    expect(await waitForHeading('「エージェント」の結果')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '検索欄を開く' })).toHaveFocus()
    // 記事の画面は、開いたときに見出しへフォーカスを移す(ItemScreen の決まり)
    await user.click(screen.getByRole('button', { name: '検索欄を開く' }))
    await user.keyboard('{ArrowDown}{Enter}')
    expect(window.location.hash).toBe('#/item/2026-01-02-03')
    expect(await waitForHeading(/やらないこと/)).toHaveFocus()
    window.location.hash = ''
  })
})

describe('さがす:結果の画面', () => {
  it('ジャンルも分けて出す(4分類)。一致しなければ0件の案内', async () => {
    renderApp('#/search?q=エージェント', sample)
    expect(await waitForHeading('「エージェント」の結果')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'ニュース',
      '公式のお知らせ',
      '脆弱性',
      'ジャンル',
    ])
    const genres = screen.getByRole('list', { name: '一致するジャンル' })
    expect(within(genres).getByRole('link', { name: 'エージェント' })).toHaveAttribute('href', '#/genre/agent')
    window.location.hash = '#/search?q=zzzz'
    await waitForHeading('「zzzz」の結果')
    expect(screen.getByText('一致するジャンルがありません')).toBeInTheDocument()
    window.location.hash = ''
  })
})

describe('重なる順(z-index)', () => {
  function zOf(name: string): number {
    const found = new RegExp(`--z-${name}:\\s*(\\d+);`).exec(tokensCss)
    if (found?.[1] === undefined) throw new Error(`--z-${name} がありません`)
    return Number(found[1])
  }

  it('候補が開いている間の上のバーは、下のメニュー・先頭へ戻るより上。読了バーはそれよりさらに上(上のバーが上がっても隠れない)', () => {
    expect(zOf('suggest')).toBeGreaterThan(zOf('topbar'))
    expect(zOf('suggest')).toBeGreaterThan(zOf('mobile-nav'))
    expect(zOf('suggest')).toBeGreaterThan(zOf('to-top'))
    expect(zOf('progress')).toBeGreaterThan(zOf('suggest'))
    expect(zOf('progress')).toBeLessThan(zOf('toast'))
    expect(progressCss).toContain('z-index: var(--z-progress);')
    expect(topBarCss).toMatch(/\.topbar:has\(\[role='combobox'\]\[aria-expanded='true'\]\)\s*\{\s*z-index: var\(--z-suggest\);/)
  })

  it('候補が開いている間、上のバーの中の combobox が aria-expanded="true" になる(上の :has が当たる条件)', async () => {
    renderApp('#/item/2026-01-02-05', sample)
    await screen.findByRole('link', { name: /に戻る$/ })
    const input = screen.getByRole('combobox', { name: '検索語' })
    const user = userEvent.setup()
    await user.click(input)
    await user.type(input, 'CVE')
    expect(input.closest('header')).not.toBeNull()
    expect(input).toHaveAttribute('aria-expanded', 'true')
    window.location.hash = ''
  })
})

describe('入力してもページがスクロールしない(依頼 5-4b)', () => {
  it('上の余白は html の scroll-padding ではなく要素の scroll-margin で持ち、上のバーの中は 0', () => {
    // html に scroll-padding-top があると、上のバーの中の欄が「余白に隠れている」扱いになり、入力のたびにページが上へ送られる
    expect(globalCss).not.toMatch(/scroll-padding-top\s*:/)
    expect(globalCss).toMatch(/\*\s*\{\s*scroll-margin-top: var\(--scroll-top\);/)
    expect(topBarCss).toMatch(/\.topbar,\s*\.topbar \*\s*\{\s*scroll-margin-top: 0;/)
  })

  it('詳細の画面で入力・↑↓しても、ページをスクロールさせない。選んだ候補は一覧の中だけで見える所へ送る', async () => {
    renderApp('#/item/2026-01-02-05', sample)
    await screen.findByRole('link', { name: /に戻る$/ })
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true })
    const input = screen.getByRole('combobox', { name: '検索語' })
    const user = userEvent.setup()
    await user.click(input)
    // 画面を開いたときの先頭への移動(App)は数えず、入力と ↑↓ のあいだだけを見る
    // (window.scrollTo は試験の準備で既に vi.fn。spyOn は同じものを返し、前の呼び出しが残っているので消す)
    const scrollTo = vi.spyOn(window, 'scrollTo')
    scrollTo.mockClear()
    await user.type(input, 'サンプル')
    // 候補ごとに高さ 40px、一覧の見える高さ 80px として測る(jsdom は配置を計算しないため)
    const list = screen.getByRole('listbox', { name: '候補' })
    Object.defineProperty(list, 'clientHeight', { value: 80, configurable: true })
    Object.defineProperty(list, 'scrollTop', { value: 0, writable: true, configurable: true })
    screen.getAllByRole('option').forEach((option, at) => {
      Object.defineProperty(option, 'offsetTop', { value: at * 40, configurable: true })
      Object.defineProperty(option, 'offsetHeight', { value: 40, configurable: true })
    })
    try {
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
      expect(list.scrollTop).toBe(40)
      // 2つ目の分類の最初の候補へ:分類の見出しごと見せる
      const groups = within(list).getAllByRole('group')
      const second = groups[1]
      if (second === undefined) throw new Error('分類が足りません')
      Object.defineProperty(second, 'offsetTop', { value: 100, configurable: true })
      await user.keyboard('{ArrowDown}')
      // 下にはみ出す → 4つ目の候補(120〜160)の下端を一覧の下端(見える高さ 80)にそろえる
      expect(list.scrollTop).toBe(160 - 80)
      // 上へ戻って見出しが隠れているとき:分類の見出し(group の上端 100)から見せる
      list.scrollTop = 200
      await user.keyboard('{ArrowDown}{ArrowUp}')
      expect(list.scrollTop).toBe(100)
      await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}')
      expect(list.scrollTop).toBe(0)
      expect(scrollIntoView).not.toHaveBeenCalled()
      expect(scrollTo).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
      window.location.hash = ''
    }
  })
})
