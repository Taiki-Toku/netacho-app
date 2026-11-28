import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createLocalUserStore } from '../data/userStore.ts'
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

  it('TST-DETAIL-03 件数の行は「保存」だけ。前の版の評価・メモが無ければ、その行は出ない', async () => {
    const store = freshUserStore()
    store.toggleSaved('2026-01-02-01')
    store.toggleSaved('2026-01-03-06')
    renderApp('#/settings', sample, store)
    await waitForHeading('設定')
    const device = screen.getByRole('region', { name: 'この端末のデータ' })
    expect(within(device).getAllByRole('term').map((term) => term.textContent)).toEqual(['保存', 'ニュースの読み込み元'])
    expect(rowValue('保存')).toBe('2件')
    expect(screen.queryByText('前の版の評価・メモ')).not.toBeInTheDocument()
  })

  it('TST-DETAIL-03 前の版の評価・メモが残っているときだけ「前の版の評価・メモ n件(画面では使っていません)」。削除で消える。sb- のキーは残る', async () => {
    // 前の版で付けた評価・メモが残っている端末(架空の値。外した評価と空白だけのメモは数えない)
    window.localStorage.clear()
    window.localStorage.setItem(
      'nodal-user',
      JSON.stringify({
        saved: ['2026-01-02-01'],
        feedback: { '2026-01-02-01': { rating: 'good', memo: '架空のめも' }, '2026-01-03-06': { rating: '', memo: '  ' } },
      }),
    )
    const store = createLocalUserStore(window.localStorage)
    // Supabase のセッション(supabase-js が置くキー)の代わり
    window.localStorage.setItem('sb-example-auth-token', 'session')
    window.localStorage.setItem('other-app', 'keep')
    renderApp('#/settings', sample, store)
    await waitForHeading('設定')
    const device = screen.getByRole('region', { name: 'この端末のデータ' })
    expect(within(device).getAllByRole('term').map((term) => term.textContent)).toEqual(['保存', '前の版の評価・メモ', 'ニュースの読み込み元'])
    expect(rowValue('保存')).toBe('1件')
    expect(rowValue('前の版の評価・メモ')).toBe('2件(画面では使っていません)')
    // メモの中身は画面に出さない
    expect(screen.queryByText(/架空のめも/)).not.toBeInTheDocument()
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'この端末の NODAL データをすべて削除' })

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    await user.click(button)
    expect(confirm).toHaveBeenCalledWith('この端末の NODAL のデータ(保存と、前の版の評価・メモ)をすべて削除します。元に戻せません。')
    expect(window.localStorage.getItem('nodal-user')).not.toBeNull()
    expect(rowValue('前の版の評価・メモ')).toBe('2件(画面では使っていません)')

    confirm.mockReturnValueOnce(true)
    await user.click(button)
    expect(window.localStorage.getItem('nodal-user')).toBeNull()
    expect(rowValue('保存')).toBe('0件')
    expect(screen.queryByText('前の版の評価・メモ')).not.toBeInTheDocument()
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
