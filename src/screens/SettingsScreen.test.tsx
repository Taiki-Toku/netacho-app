import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { follow, freshUserStore, renderApp, waitForHeading } from '../test/renderApp.tsx'
import { fullSample as sample } from '../test/sampleData.ts'

/** 行の一覧(dl)から、名前に対応する値を読む */
function rowValue(label: string): string {
  const term = screen.getByText(label, { selector: 'dt' })
  return term.nextElementSibling?.textContent ?? ''
}

afterEach(() => {
  vi.restoreAllMocks()
  window.location.hash = ''
})

describe('設定', () => {
  it('上のバーの歯車(aria-label="設定")で #/settings が出る。区分は ACCOUNT / THIS DEVICE / ABOUT', async () => {
    renderApp('#/home', sample)
    await waitForHeading('今日のニュース')
    const gear = screen.getByRole('link', { name: '設定' })
    expect(gear).toHaveAttribute('href', '#/settings')
    expect(gear.closest('header')).not.toBeNull()
    follow(gear)
    expect(await waitForHeading('設定')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '設定', current: 'page' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'アカウント',
      'この端末のデータ',
      'このアプリについて',
    ])
    expect(screen.getByText('ACCOUNT / 01')).toBeInTheDocument()
    expect(screen.getByText('THIS DEVICE / 02')).toBeInTheDocument()
    expect(screen.getByText('ABOUT / 03')).toBeInTheDocument()
    expect(screen.getByText('DEVICE ONLY')).toBeInTheDocument()
  })

  it('見本のデータのときは「ログインなし(見本のデータ)」で、ログアウトは出さない', async () => {
    renderApp('#/settings', sample)
    await waitForHeading('設定')
    expect(screen.getByText('ログインなし(見本のデータ)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument()
    expect(rowValue('ニュースの読み込み元')).toBe('見本')
  })

  it('件数は localStorage の中身と合う(外した評価・空のメモは数えない)', async () => {
    const store = freshUserStore()
    store.toggleSaved('2026-01-02-01')
    store.toggleSaved('2026-01-03-06')
    store.setRating('2026-01-02-01', 'good')
    store.setRating('2026-01-03-06', 'hot')
    store.setRating('2026-01-03-01', '')
    store.setMemo('2026-01-02-01', '試す')
    store.setMemo('2026-01-03-06', '  ')
    // 画面ではなく、端末に書かれた値から数え直して比べる
    const raw = JSON.parse(window.localStorage.getItem('nodal-user') ?? '{}') as {
      saved: string[]
      feedback: Record<string, { rating?: string; memo?: string }>
    }
    const entries = Object.values(raw.feedback)
    renderApp('#/settings', sample, store)
    await waitForHeading('設定')
    expect(rowValue('保存')).toBe(`${raw.saved.length}件`)
    expect(rowValue('評価')).toBe(`${entries.filter((entry) => entry.rating !== undefined && entry.rating !== '').length}件`)
    expect(rowValue('メモ')).toBe(`${entries.filter((entry) => (entry.memo ?? '').trim() !== '').length}件`)
    expect([rowValue('保存'), rowValue('評価'), rowValue('メモ')]).toEqual(['2件', '2件', '1件'])
  })

  it('削除:確認で「いいえ」なら何も消えない。「はい」なら保存・評価・メモが 0 になり、sb- のキーは残る', async () => {
    const store = freshUserStore()
    store.toggleSaved('2026-01-02-01')
    store.setRating('2026-01-02-01', 'good')
    store.setMemo('2026-01-02-01', '試す')
    // Supabase のセッション(supabase-js が置くキー)の代わり
    window.localStorage.setItem('sb-example-auth-token', 'session')
    window.localStorage.setItem('other-app', 'keep')
    renderApp('#/settings', sample, store)
    await waitForHeading('設定')
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'この端末の NODAL データをすべて削除' })

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    await user.click(button)
    expect(confirm).toHaveBeenCalledWith('この端末の保存・評価・メモをすべて削除します。元に戻せません。')
    expect(window.localStorage.getItem('nodal-user')).not.toBeNull()
    expect([rowValue('保存'), rowValue('評価'), rowValue('メモ')]).toEqual(['1件', '1件', '1件'])

    confirm.mockReturnValueOnce(true)
    await user.click(button)
    expect(window.localStorage.getItem('nodal-user')).toBeNull()
    expect([rowValue('保存'), rowValue('評価'), rowValue('メモ')]).toEqual(['0件', '0件', '0件'])
    expect(window.localStorage.getItem('sb-example-auth-token')).toBe('session')
    expect(window.localStorage.getItem('other-app')).toBe('keep')
    expect(screen.getByText('この端末のデータを削除しました')).toHaveAttribute('aria-live', 'polite')
    // 左メニューの保存の件数も 0 になる
    expect(within(screen.getByRole('navigation', { name: 'LIBRARY' })).getByRole('link', { name: /^保存\s*0$/ })).toBeInTheDocument()
  })

  it('ABOUT:版(package.json の版と、手元では local)と、最後に読み込んだ時刻', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 17, 8, 5))
    try {
      renderApp('#/settings', sample)
      await waitForHeading('設定')
    } finally {
      vi.useRealTimers()
    }
    expect(rowValue('版')).toBe('0.0.1(local)')
    expect(rowValue('最後に読み込んだ時刻')).toBe('11/17 08:05')
  })
})
