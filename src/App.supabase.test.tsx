// Supabase モード(Backend を渡したとき)の画面の試験。Backend はモックで、通信はしない
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App } from './App.tsx'
import { FeedLoadError } from './data/backend.ts'
import { rowsToFeed } from './data/feedRow.ts'
import type { FeedEntry } from './data/types.ts'
import genresJson from '../fixtures/genres.json'
import { mockBackend } from './test/mockBackend.ts'
import { freshUserStore, waitForHeading } from './test/renderApp.tsx'
import { fullSample } from './test/sampleData.ts'

function renderSupabase(backend: ReturnType<typeof mockBackend>, hash = '') {
  window.location.hash = hash
  render(<App backend={backend} userStore={freshUserStore()} />)
}

afterEach(() => {
  vi.useRealTimers()
  window.location.hash = ''
})

describe('Supabase モード:ログイン', () => {
  it('セッションが無いときはログインだけを出す(ほかの画面・メニューは出さない)', async () => {
    const backend = mockBackend()
    renderSupabase(backend)
    expect(await waitForHeading('ログイン')).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(screen.getByLabelText('メールアドレス')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('メールアドレス')).toHaveAttribute('autocomplete', 'email')
    expect(backend.loadItems).not.toHaveBeenCalled()
  })

  it('コードを送る → 6桁を入れる → ホームが出る', async () => {
    const backend = mockBackend({ loadItems: () => Promise.resolve(fullSample.items) })
    renderSupabase(backend, '#/saved')
    await waitForHeading('ログイン')
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: ' owner@example.com ' } })
    fireEvent.click(screen.getByRole('button', { name: 'コードを送る' }))

    const codeInput = await screen.findByLabelText('6桁のコード')
    expect(backend.auth.sendCode).toHaveBeenCalledWith('owner@example.com')
    expect(screen.getByText(/^コードを送りました/)).toHaveAttribute('aria-live', 'polite')
    expect(codeInput).toHaveAttribute('inputmode', 'numeric')
    expect(codeInput).toHaveAttribute('autocomplete', 'one-time-code')
    await waitFor(() => {
      expect(codeInput).toHaveFocus()
    })

    // 数字以外は入らず、6桁まで
    fireEvent.change(codeInput, { target: { value: '12a3-4５67' } })
    expect(codeInput).toHaveValue('123456')
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    // 前の画面(#/saved)ではなく、ホームから始まる
    expect(await waitForHeading('今日のニュース')).toBeInTheDocument()
    expect(backend.auth.verifyCode).toHaveBeenCalledWith('owner@example.com', '123456')
    expect(window.location.hash).toBe('#/home')
    // Supabase のネタには「見本の架空データ」の添え書きを出さない
    expect(screen.queryByText('表示しているのは、すべて見本用の架空データです。')).not.toBeInTheDocument()
  })

  it('コードが違うときは、その旨を aria-live の欄に出す', async () => {
    const backend = mockBackend({ verifyResult: { ok: false, reason: 'invalid-code', code: 'otp_expired' } })
    renderSupabase(backend)
    await waitForHeading('ログイン')
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'owner@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'コードを送る' }))
    fireEvent.change(await screen.findByLabelText('6桁のコード'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))
    expect(await screen.findByText('コードが違うか、期限が切れています。')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('heading', { level: 1, name: 'ログイン' })).toBeInTheDocument()
  })

  it('送れなかった理由ごとの文言。分からない失敗は code だけを添える', async () => {
    const backend = mockBackend()
    backend.auth.sendCode
      .mockResolvedValueOnce({ ok: false, reason: 'not-allowed', code: 'otp_disabled' })
      .mockResolvedValueOnce({ ok: false, reason: 'rate-limit' })
      .mockResolvedValueOnce({ ok: false, reason: 'network' })
      .mockResolvedValueOnce({ ok: false, reason: 'unknown', code: 'unexpected_failure' })
    renderSupabase(backend)
    await waitForHeading('ログイン')
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'someone@example.com' } })
    const send = screen.getByRole('button', { name: 'コードを送る' })
    for (const text of [
      'このメールアドレスでは使えません。',
      'コードを送る回数の上限に達しました。しばらく待ってから、もう一度試してください。',
      '通信に失敗しました。電波の状態を確かめて、もう一度試してください。',
      'ログインできませんでした(unexpected_failure)。',
    ]) {
      fireEvent.click(send)
      expect(await screen.findByText(text)).toHaveAttribute('aria-live', 'polite')
    }
  })

  it('送ってから 60 秒は送り直せず、残りの秒数を出す', async () => {
    vi.useFakeTimers()
    const backend = mockBackend()
    renderSupabase(backend)
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'owner@example.com' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'コードを送る' }))
      await Promise.resolve()
    })
    const resend = screen.getByRole('button', { name: 'コードを送り直す' })
    expect(resend).toBeDisabled()
    expect(screen.getByText('あと60秒')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000)
    })
    expect(resend).toBeDisabled()
    expect(screen.getByText('あと1秒')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(resend).toBeEnabled()
    expect(screen.queryByText(/^あと\d+秒$/)).not.toBeInTheDocument()
    await act(async () => {
      fireEvent.click(resend)
      await Promise.resolve()
    })
    expect(backend.auth.sendCode).toHaveBeenCalledTimes(2)
    expect(resend).toBeDisabled()
  })

  it('「メールアドレスを変える」で最初の欄に戻る', async () => {
    renderSupabase(mockBackend())
    await waitForHeading('ログイン')
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'owner@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'コードを送る' }))
    fireEvent.click(await screen.findByRole('button', { name: 'メールアドレスを変える' }))
    expect(screen.getByLabelText('メールアドレス')).toHaveValue('owner@example.com')
    expect(screen.queryByLabelText('6桁のコード')).not.toBeInTheDocument()
  })
})

describe('Supabase モード:ネタの読み込み', () => {
  it('TST-FEEDUI-04 読み込みに失敗したら、見本のネタを出さずに失敗の文言と再読み込みのボタンを出す', async () => {
    const backend = mockBackend({ signedIn: true, loadItems: () => Promise.reject(new Error('ニュースを読み込めませんでした(PGRST301)')) })
    renderSupabase(backend)
    expect(await screen.findByText('データを読み込めませんでした')).toBeInTheDocument()
    expect(screen.getByText('ニュースを読み込めませんでした(PGRST301)')).toBeInTheDocument()
    expect(screen.queryByText(fullSample.items[0]!.title)).not.toBeInTheDocument()

    backend.loadItems.mockResolvedValueOnce(fullSample.items)
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    expect(await waitForHeading('今日のニュース')).toBeInTheDocument()
    expect(backend.loadItems).toHaveBeenCalledTimes(2)
  })

  it('0件のときは、許可ユーザーでない可能性を出す。設定の画面は出る(ログアウトできる)', async () => {
    renderSupabase(mockBackend({ signedIn: true }))
    expect(await screen.findByText('表示できるニュースがありません')).toBeInTheDocument()
    expect(screen.getByText('(許可ユーザーに登録されていない可能性があります)')).toBeInTheDocument()
    window.location.hash = '#/settings'
    expect(await waitForHeading('設定')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument()
  })

  it('ジャンルは genres.json のまま、公式フィードは空', async () => {
    renderSupabase(mockBackend({ signedIn: true, loadItems: () => Promise.resolve(fullSample.items) }))
    await waitForHeading('今日のニュース')
    expect(screen.getByText('公式情報はまだありません')).toBeInTheDocument()
    expect(genresJson.map((genre) => genre.id)).not.toContain('vuln')
  })
})

describe('Supabase モード:公式フィードの読み込み', () => {
  // 架空の脆弱性(本物の feed_entries のデータではない)
  const vulnWithoutSeverity: FeedEntry = {
    id: 'vuln-no-severity',
    kind: 'vuln',
    product: '架空製品',
    vendor: '架空ベンダー',
    title: '深刻度の無い架空の脆弱性',
    publishedAt: '2026-11-19T00:00:00+00:00',
    sortAt: '2026-11-19T00:00:00+00:00',
    url: '',
    severity: '',
    status: '',
    cve: 'CVE-2099-0001',
    cvss: null,
  }

  it('ネタと公式フィードを両方読み、失敗の1行は出さない', async () => {
    const backend = mockBackend({ signedIn: true, loadItems: () => Promise.resolve(fullSample.items), loadFeed: () => Promise.resolve([vulnWithoutSeverity]) })
    renderSupabase(backend, '#/vuln')
    await waitForHeading('脆弱性')
    expect(screen.getByRole('heading', { name: 'CVE-2099-0001' })).toBeInTheDocument()
    expect(screen.queryByText(/^公式フィードを読み込めませんでした/)).not.toBeInTheDocument()
    expect(backend.loadItems).toHaveBeenCalledTimes(1)
    expect(backend.loadFeed).toHaveBeenCalledTimes(1)
  })

  it('TST-FEEDUI-03 公式フィードだけ失敗:ネタは出て、公式のお知らせ・脆弱性の画面に失敗の1行が出る。見本のフィードは出ない', async () => {
    const backend = mockBackend({
      signedIn: true,
      loadItems: () => Promise.resolve(fullSample.items),
      loadFeed: () => Promise.reject(new FeedLoadError('PGRST301')),
    })
    renderSupabase(backend)
    expect(await waitForHeading('今日のニュース')).toBeInTheDocument()
    expect(screen.queryByText('データを読み込めませんでした')).not.toBeInTheDocument()
    // ネタが実際に出ている(最新日の1本の見出し)
    const latest = fullSample.items.find((item) => item.date === '2026-01-03')
    if (latest === undefined) throw new Error('見本に最新日のネタがありません')
    expect(screen.getAllByText(latest.title).length).toBeGreaterThan(0)

    for (const [hash, heading] of [
      ['#/feed', '公式のお知らせ'],
      ['#/vuln', '脆弱性'],
    ] as const) {
      window.location.hash = hash
      await waitForHeading(heading)
      const line = screen.getByText('公式フィードを読み込めませんでした(PGRST301)')
      expect(line).toHaveAttribute('role', 'status')
      for (const entry of fullSample.feed) {
        expect(screen.queryByText(entry.title)).not.toBeInTheDocument()
      }
    }
  })

  it('TST-FEEDUI-03 FeedLoadError でない失敗(通信の例外など)は、中身を出さずに決まった文だけ', async () => {
    const backend = mockBackend({
      signedIn: true,
      loadItems: () => Promise.resolve(fullSample.items),
      loadFeed: () => Promise.reject(new TypeError('サーバーや通信の詳しい文言')),
    })
    renderSupabase(backend, '#/feed')
    await waitForHeading('公式のお知らせ')
    expect(screen.getByText('公式フィードを読み込めませんでした')).toHaveAttribute('role', 'status')
    expect(screen.queryByText(/詳しい文言/)).not.toBeInTheDocument()
  })

  it('TST-FEEDUI-05 severity が空の脆弱性は「未評価」', async () => {
    renderSupabase(
      mockBackend({ signedIn: true, loadItems: () => Promise.resolve(fullSample.items), loadFeed: () => Promise.resolve([vulnWithoutSeverity]) }),
      '#/vuln',
    )
    await waitForHeading('脆弱性')
    const card = screen.getByText('深刻度の無い架空の脆弱性').closest('li')
    if (card === null) throw new Error('脆弱性のカードがありません')
    expect(within(card).getByText('未評価')).toBeInTheDocument()
    expect(screen.queryByText('不明')).not.toBeInTheDocument()
  })
})

describe('Supabase モード:公開日不明', () => {
  // 架空の行(本物の feed_entries のデータではない)。行の変換(feedRow)を通して渡す
  const row = { vendor: '架空ベンダー', product: '架空製品', url: null, severity: null, cvss: null, cve_ids: null, status: null }
  const feed = rowsToFeed([
    { ...row, id: 'old-known', kind: 'release', title: '公開日のある古いお知らせ', published_at: '2026-11-10T00:00:00+00:00', sort_at: '2026-11-10T00:00:00+00:00' },
    { ...row, id: 'new-unknown', kind: 'release', title: '公開日の無い新しいお知らせ', published_at: null, sort_at: '2026-11-20T00:00:00+00:00' },
    { ...row, id: 'vuln-unknown', kind: 'vuln', title: '公開日の無い架空の脆弱性', cve_ids: ['CVE-2099-0002'], published_at: null, sort_at: '2026-11-20T00:00:00+00:00' },
  ])

  function renderWithFeed(hash: string) {
    renderSupabase(mockBackend({ signedIn: true, loadItems: () => Promise.resolve(fullSample.items), loadFeed: () => Promise.resolve(feed) }), hash)
  }

  it('TST-FEEDUI-08 published_at が null の行は「公開日不明」と出し、並びは sort_at の新しい順のまま', async () => {
    renderWithFeed('#/feed')
    await waitForHeading('公式のお知らせ')
    const rows = within(screen.getByRole('list', { name: '公式のお知らせ' })).getAllByRole('listitem')
    expect(rows.map((li) => li.textContent)).toEqual([expect.stringContaining('公開日の無い新しいお知らせ'), expect.stringContaining('公開日のある古いお知らせ')])
    const [first, second] = rows
    if (first === undefined || second === undefined) throw new Error('お知らせが2行ありません')
    expect(within(first).getByText('公開日不明')).toBeInTheDocument()
    // 公開日のある行は今までどおり日時(取った時刻を公開日として出さない)
    expect(within(second).queryByText('公開日不明')).not.toBeInTheDocument()
    expect(within(second).getByText('11/10 09:00')).toBeInTheDocument()
    // 右の欄も同じ
    const rail = screen.getByRole('heading', { level: 3, name: '公式のお知らせ' }).closest('section')
    if (rail === null) throw new Error('右の欄がありません')
    expect(within(rail).getByText('公開日不明')).toBeInTheDocument()
  })

  it('TST-FEEDUI-08 脆弱性のカードは「公開 」を付けずに「公開日不明」だけ。詳細の公開日も「公開日不明」', async () => {
    renderWithFeed('#/vuln')
    await waitForHeading('脆弱性')
    const card = screen.getByText('公開日の無い架空の脆弱性').closest('li')
    if (card === null) throw new Error('脆弱性のカードがありません')
    expect(within(card).getByText('公開日不明')).toBeInTheDocument()
    expect(within(card).queryByText(/公開 /)).not.toBeInTheDocument()

    window.location.hash = '#/vuln/vuln-unknown'
    await waitForHeading('CVE-2099-0002')
    expect(screen.getByText('公開日不明')).toBeInTheDocument()
  })

  it('TST-FEEDUI-08 見本(fixtures)のフィードは今までどおり日時を出し、「公開日不明」は出ない', async () => {
    expect(fullSample.feed.every((entry) => entry.sortAt === entry.publishedAt && entry.publishedAt !== '')).toBe(true)
    window.location.hash = '#/feed'
    render(<App load={() => Promise.resolve(fullSample)} userStore={freshUserStore()} />)
    await waitForHeading('公式のお知らせ')
    expect(screen.queryByText('公開日不明')).not.toBeInTheDocument()
    window.location.hash = '#/vuln'
    await waitForHeading('脆弱性')
    expect(screen.queryByText('公開日不明')).not.toBeInTheDocument()
    expect(screen.getAllByText(/^公開 \d+月\d+日$/).length).toBeGreaterThan(0)
  })
})

describe('Supabase モード:ログアウト', () => {
  it('「保存」の画面にはログアウトが無い', async () => {
    renderSupabase(mockBackend({ signedIn: true, loadItems: () => Promise.resolve(fullSample.items) }), '#/saved')
    await waitForHeading('保存したニュース')
    expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument()
  })

  it('設定の画面にメールアドレスと読み込み元を出し、ログアウトで、ネタを手放してログイン画面に戻る', async () => {
    const backend = mockBackend({ signedIn: true, loadItems: () => Promise.resolve(fullSample.items) })
    renderSupabase(backend, '#/settings')
    await waitForHeading('設定')
    expect(screen.getByText('owner@example.com')).toBeInTheDocument()
    expect(screen.getByText('Supabase')).toBeInTheDocument()
    expect(screen.queryByText('ログインなし(見本のデータ)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }))
    expect(await waitForHeading('ログイン')).toBeInTheDocument()
    expect(backend.auth.signOut).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()

    // 同じ人がもう一度ログインすると、ネタは読み直す(前に読んだものを持ち越さない)
    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'owner@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'コードを送る' }))
    fireEvent.change(await screen.findByLabelText('6桁のコード'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))
    await waitForHeading('今日のニュース')
    expect(backend.loadItems).toHaveBeenCalledTimes(2)
  })

  it('Supabase モードでないときは、設定の画面にログアウトのボタンを出さない', async () => {
    window.location.hash = '#/settings'
    render(<App load={() => Promise.resolve(fullSample)} userStore={freshUserStore()} />)
    await waitForHeading('設定')
    expect(screen.getByText('ログインなし(見本のデータ)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument()
  })
})
