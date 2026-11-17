// Supabase モード(Backend を渡したとき)の画面の試験。Backend はモックで、通信はしない
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from './App.tsx'
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
  it('読み込みに失敗したら、見本のネタを出さずに失敗の文言と再読み込みのボタンを出す', async () => {
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

  it('0件のときは、許可ユーザーでない可能性を出す。「保存」の画面は出る(ログアウトできる)', async () => {
    renderSupabase(mockBackend({ signedIn: true }))
    expect(await screen.findByText('表示できるニュースがありません')).toBeInTheDocument()
    expect(screen.getByText('(許可ユーザーに登録されていない可能性があります)')).toBeInTheDocument()
    window.location.hash = '#/saved'
    expect(await waitForHeading('保存したニュース')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ログアウト' })).toBeInTheDocument()
  })

  it('ジャンルは genres.json のまま、公式フィードは空', async () => {
    renderSupabase(mockBackend({ signedIn: true, loadItems: () => Promise.resolve(fullSample.items) }))
    await waitForHeading('今日のニュース')
    expect(screen.getByText('公式情報はまだありません')).toBeInTheDocument()
    expect(genresJson.map((genre) => genre.id)).not.toContain('vuln')
  })
})

describe('Supabase モード:ログアウト', () => {
  it('「保存」の一番下のログアウトで、ネタを手放してログイン画面に戻る', async () => {
    const backend = mockBackend({ signedIn: true, loadItems: () => Promise.resolve(fullSample.items) })
    renderSupabase(backend, '#/saved')
    await waitForHeading('保存したニュース')
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

  it('Supabase モードでないときは、ログアウトのボタンを出さない', async () => {
    window.location.hash = '#/saved'
    render(<App load={() => Promise.resolve(fullSample)} userStore={freshUserStore()} />)
    await waitForHeading('保存したニュース')
    expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument()
  })
})
