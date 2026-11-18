import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App.tsx'
import { follow, goHistory, renderApp, waitForHeading } from './test/renderApp.tsx'
import { fullSample as sample } from './test/sampleData.ts'
import scrollTopCss from './components/ScrollTopButton.module.css?raw'
import tokensCss from './styles/tokens.css?raw'

describe('App(骨組み)', () => {
  it('読み込みが終わると、上のバーに NODAL と放送日(見本の最新日 2026-01-03)、左メニューと下のメニューが出る', async () => {
    renderApp('', sample)
    expect(await waitForHeading('今日のニュース')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'NODAL ホーム' })).toHaveAttribute('href', '#/home')
    expect(screen.getByText('1月3日 土曜日')).toBeInTheDocument()

    // 左メニュー:ジャンルは fixtures から。「脆弱性」ジャンルは出さず、公式情報の「脆弱性」に一本化する
    const genres = screen.getByRole('navigation', { name: 'GENRES' })
    expect(within(genres).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'トップ',
      '仕事・自動化',
      'エージェント',
      'ローカルLLM',
      'セキュリティニュース',
      'プロダクト',
      'VTuber・創作',
      'ツール・業界',
      'アイデアラボ',
    ])
    expect(within(genres).getByRole('link', { name: 'トップ', current: 'page' })).toBeInTheDocument()
    const official = screen.getByRole('navigation', { name: 'OFFICIAL' })
    expect(within(official).getByRole('link', { name: '公式のお知らせ' })).toHaveAttribute('href', '#/feed')
    // 脆弱性の件数(見本は 5 件)
    expect(within(official).getByRole('link', { name: /^脆弱性\s*5$/ })).toHaveAttribute('href', '#/vuln')
    const mine = screen.getByRole('navigation', { name: 'LIBRARY' })
    expect(within(mine).getByRole('link', { name: /^保存\s*0$/ })).toHaveAttribute('href', '#/saved')

    // 下のメニュー(スマホ):ホーム / 公式情報 / 脆弱性 / 保存
    const nav = screen.getByRole('navigation', { name: '画面の切り替え' })
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual(['ホーム', '公式情報', '脆弱性', '保存'])
    expect(within(nav).getByRole('link', { name: 'ホーム', current: 'page' })).toBeInTheDocument()
  })

  it('ハッシュを変えると画面が切り替わり、メニューの選択も追う', async () => {
    renderApp('#/feed', sample)
    expect(await waitForHeading('公式のお知らせ')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: '画面の切り替え' })
    expect(within(nav).getByRole('link', { name: '公式情報', current: 'page' })).toBeInTheDocument()

    window.location.hash = '#/saved'
    expect(await waitForHeading('保存したニュース')).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: '保存', current: 'page' })).toBeInTheDocument()
    window.location.hash = ''
  })

  it('知らないハッシュ(#/preferences など)はトップに落ちる', async () => {
    renderApp('#/preferences', sample)
    expect(await waitForHeading('今日のニュース')).toBeInTheDocument()
    window.location.hash = ''
  })

  it('旧アドレス #/today は #/home に置き換えて転送し、履歴に #/today を残さない', async () => {
    window.location.hash = '#/saved'
    const before = window.history.length
    renderApp('#/today', sample)
    expect(await waitForHeading('今日のニュース')).toBeInTheDocument()
    await waitFor(() => {
      expect(window.location.hash).toBe('#/home')
    })
    // #/saved → #/today(ここで 1 つ積まれ、転送では積まない)
    expect(window.history.length).toBe(before + 1)

    // 表示の途中で #/today に来たときも転送する
    window.location.hash = '#/feed'
    await waitForHeading('公式のお知らせ')
    window.location.hash = '#/today'
    expect(await waitForHeading('今日のニュース')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/home')
    // 戻ると #/today を飛ばして #/feed に戻る
    await goHistory(-1)
    expect(window.location.hash).toBe('#/feed')
    expect(await waitForHeading('公式のお知らせ')).toBeInTheDocument()
    window.location.hash = ''
  })

  it('ジャンル・絞り込み・詳細・検索語の移動は履歴に積まれ、戻る/進むで 1 つずつ前後の表示に戻る', async () => {
    renderApp('#/home', sample)
    await waitForHeading('今日のニュース')

    follow(within(screen.getByRole('navigation', { name: 'GENRES' })).getByRole('link', { name: 'プロダクト' }))
    expect(await waitForHeading('プロダクト')).toBeInTheDocument()
    follow(within(screen.getByRole('navigation', { name: 'お知らせの種類' })).getByRole('link', { name: 'リリース' }))
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'リリース', current: true })).toBeInTheDocument()
    })
    const [firstItem] = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('#/item/'))
    if (firstItem === undefined) throw new Error('ネタへのリンクがありません')
    follow(firstItem)
    const itemHash = window.location.hash
    await screen.findByRole('link', { name: /に戻る$/ })
    const user = userEvent.setup()
    await user.type(screen.getByRole('combobox', { name: '検索語' }), 'CVE{Enter}')
    expect(await waitForHeading(/CVE/)).toBeInTheDocument()

    const steps: [string, () => Promise<unknown>][] = [
      [itemHash, () => screen.findByRole('link', { name: /に戻る$/ })],
      ['#/genre/product?kind=release', () => screen.findByRole('link', { name: 'リリース', current: true })],
      ['#/genre/product', () => screen.findByRole('link', { name: 'すべて', current: true })],
      ['#/home', () => waitForHeading('今日のニュース')],
    ]
    for (const [hash, check] of steps) {
      await goHistory(-1)
      expect(window.location.hash).toBe(hash)
      await check()
    }
    // 進むで同じ順にたどり直す
    for (const [hash, check] of [...steps].reverse().slice(1)) {
      await goHistory(1)
      expect(window.location.hash).toBe(hash)
      await check()
    }
    await goHistory(1)
    expect(window.location.hash).toBe('#/search?q=CVE')
    expect(await waitForHeading(/CVE/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '検索語' })).toHaveValue('CVE')
    window.location.hash = ''
  })

  it('0件のときは、何が無いかと次にすることを出す(トップ・保存・公式のお知らせ)', async () => {
    renderApp('#/home', { ...sample, items: [], feed: [] })
    expect(await waitForHeading('今日のニュース')).toBeInTheDocument()
    expect(screen.getByText('今日のニュースはまだありません')).toBeInTheDocument()
    window.location.hash = '#/saved'
    expect(await screen.findByText('まだ何も入っていません')).toBeInTheDocument()
    window.location.hash = '#/feed'
    expect(await screen.findByText('該当するお知らせがありません')).toBeInTheDocument()
    window.location.hash = ''
  })

  it('読み込み中はスケルトンを出し、「読み込み中」とだけ読み上げる', () => {
    window.location.hash = ''
    render(<App load={() => new Promise(() => undefined)} />)
    const status = screen.getByText('読み込み中').closest('[role="status"]')
    expect(status).toHaveTextContent(/^読み込み中$/)
    expect(status?.querySelector('[aria-hidden="true"] li') ?? null).not.toBeNull()
  })

  it('通信エラーのときは知らせ、「もう一度読み込む」で読み直せる', async () => {
    window.location.hash = ''
    let calls = 0
    const load = () => {
      calls += 1
      return calls === 1 ? Promise.reject(new Error('Failed to fetch')) : Promise.resolve(sample)
    }
    render(<App load={load} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('データを読み込めませんでした')
    expect(alert).toHaveTextContent('Failed to fetch')
    // ボタンは知らせ(alert)の外に置き、読み上げは文だけにする
    expect(within(alert).queryByRole('button')).toBeNull()
    await userEvent.setup().click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    expect(await waitForHeading('今日のニュース')).toBeInTheDocument()
    expect(calls).toBe(2)
  })

  it('「先頭へ戻る」は 1 画面分スクロールしてから出る', async () => {
    renderApp('#/home', sample)
    await waitForHeading('今日のニュース')
    expect(screen.queryByRole('button', { name: '先頭へ戻る' })).toBeNull()

    setScrollY(window.innerHeight)
    expect(screen.queryByRole('button', { name: '先頭へ戻る' })).toBeNull()
    setScrollY(window.innerHeight + 1)
    const button = await screen.findByRole('button', { name: '先頭へ戻る' })

    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    // jsdom には matchMedia が無い。動きを減らす設定のときは、なめらかに動かさない
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }))
    await userEvent.setup().click(button)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'auto' })
    // ボタンは消えるので、その画面の最初の h1(トップは読み上げ用の見出し)に焦点を移す
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: '今日のニュース' }))
    expect(document.activeElement).toHaveAttribute('tabindex', '-1')
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    await userEvent.setup().click(button)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
    vi.unstubAllGlobals()
    setScrollY(0)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '先頭へ戻る' })).toBeNull()
    })
    scrollTo.mockRestore()
  })

  it('「先頭へ戻る」は条件を満たさない間も DOM にあるが、見えず・押せず・Tab で当たらない。満たすと見えて押せる', async () => {
    renderApp('#/home', sample)
    await waitForHeading('今日のニュース')
    // 見えない要素は読み上げの名前も空になるため、役割ではなく属性で探す
    const button = document.querySelector('button[aria-label="先頭へ戻る"]')
    if (!(button instanceof HTMLButtonElement)) throw new Error('「先頭へ戻る」が DOM に無い')
    expect(getComputedStyle(button).visibility).toBe('hidden')
    expect(getComputedStyle(button).pointerEvents).toBe('none')
    expect(getComputedStyle(button).opacity).toBe('0')
    // 読み上げ(アクセシビリティツリー)にも出ない
    expect(screen.queryByRole('button', { name: '先頭へ戻る' })).toBeNull()

    // Tab で一周しても当たらない(一周したら body か最初の要素に戻る)
    const user = userEvent.setup()
    const reached = new Set<Element | null>()
    for (let i = 0; i < 200; i += 1) {
      await user.tab()
      if (reached.has(document.activeElement)) break
      reached.add(document.activeElement)
    }
    expect(reached.has(button)).toBe(false)

    setScrollY(window.innerHeight + 1)
    expect(screen.getByRole('button', { name: '先頭へ戻る' })).toBe(button)
    expect(getComputedStyle(button).visibility).toBe('visible')
    expect(getComputedStyle(button).pointerEvents).not.toBe('none')
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    try {
      // pointer-events: none のままなら user-event のクリックは失敗する
      await user.click(button)
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
    } finally {
      vi.unstubAllGlobals()
      scrollTo.mockRestore()
      setScrollY(0)
    }
  })

  it('「先頭へ戻る」は不透明度だけをフェードし、動きを減らす設定では transition が無い', () => {
    // jsdom は @media を当てないため、CSS の中身で確かめる
    expect(scrollTopCss).not.toMatch(/transition:\s*all/)
    // 出るときは visibility をすぐ切り替え、消えるときはフェードの後に切り替える
    expect(scrollTopCss).toMatch(/\.button\s*\{[^}]*visibility 0s linear 0s;/)
    expect(scrollTopCss).toMatch(/\.hidden\s*\{[^}]*visibility 0s linear var\(--duration-fade\);/)
    // フェードは約 300ms(このボタンだけ。ほかの動きの --duration は 200ms のまま)
    expect(scrollTopCss).toMatch(/\.button\s*\{[^}]*opacity var\(--duration-fade\) var\(--ease\),/)
    expect(scrollTopCss).not.toMatch(/var\(--duration\)/)
    expect(tokensCss).toMatch(/--duration-fade: 300ms;/)
    expect(tokensCss).toMatch(/--duration: 200ms;/)
    expect(scrollTopCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.button,\s*\.hidden\s*\{\s*transition: none;/)
  })

  it('「先頭へ戻る」は 767px 以下でも同じ条件で出る(縦 1280px では、一番下の 1276px まで送っても出ない)', async () => {
    const { innerWidth, innerHeight } = window
    setViewport(390, 1280)
    try {
      renderApp('#/home', sample)
      await waitForHeading('今日のニュース')
      // 原因の再現:ページの高さ 2556px − 画面の高さ 1280px = 1276px が一番下。1280px を超えないので出ない(仕様どおり)
      setScrollY(1276)
      expect(screen.queryByRole('button', { name: '先頭へ戻る' })).toBeNull()
      // 1画面分を超えれば、幅に関係なく出る
      setScrollY(1281)
      expect(await screen.findByRole('button', { name: '先頭へ戻る' })).toBeInTheDocument()
    } finally {
      setScrollY(0)
      setViewport(innerWidth, innerHeight)
    }
  })
})

function setViewport(width: number, height: number) {
  act(() => {
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true })
    window.dispatchEvent(new Event('resize'))
  })
}

function setScrollY(value: number) {
  act(() => {
    Object.defineProperty(window, 'scrollY', { value, configurable: true })
    window.dispatchEvent(new Event('scroll'))
  })
}
