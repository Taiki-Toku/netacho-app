import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from './App.tsx'
import { fullSample as sample } from './test/sampleData.ts'

describe('App(骨組み)', () => {
  it('読み込みが終わると、番組ヘッダーに放送日(見本の最新日 2026-01-03)、下に4つの切り替えが出る', async () => {
    window.location.hash = ''
    render(<App load={() => Promise.resolve(sample)} />)
    expect(await screen.findByRole('heading', { level: 1, name: '今日の放送' })).toBeInTheDocument()
    expect(screen.getByText('AIネタ帳')).toBeInTheDocument()
    expect(screen.getByText('見本データ')).toBeInTheDocument()
    expect(screen.getByText('放送日 2026年1月3日(土)')).toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: '画面の切り替え' })
    const links = nav.querySelectorAll('a')
    expect([...links].map((a) => a.textContent)).toEqual(['今日', 'バックナンバー', '探す', '設定'])
    expect(screen.getByRole('link', { name: '今日', current: 'page' })).toBeInTheDocument()
  })

  it('ハッシュを変えると画面が切り替わる', async () => {
    window.location.hash = '#/settings'
    render(<App load={() => Promise.resolve(sample)} />)
    expect(await screen.findByRole('heading', { level: 1, name: '設定' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '設定', current: 'page' })).toBeInTheDocument()
    window.location.hash = ''
  })

  it('読み込みに失敗したら、その旨を表示する', async () => {
    window.location.hash = ''
    render(<App load={() => Promise.reject(new Error('壊れています'))} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('データを読み込めませんでした')
  })
})
