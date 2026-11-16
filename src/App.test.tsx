import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { App } from './App.tsx'
import { renderApp, waitForHeading } from './test/renderApp.tsx'
import { fullSample as sample } from './test/sampleData.ts'

describe('App(骨組み)', () => {
  it('読み込みが終わると、上のバーに NODAL と放送日(見本の最新日 2026-01-03)、左メニューと下のメニューが出る', async () => {
    renderApp('', sample)
    expect(await waitForHeading('今朝のネタ')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'NODAL ホーム' })).toHaveAttribute('href', '#/today')
    expect(screen.getByText('1月3日 土曜日')).toBeInTheDocument()

    // 左メニュー:ジャンルは fixtures から。「脆弱性」ジャンルは出さず、公式情報の「脆弱性」に一本化する
    const genres = screen.getByRole('navigation', { name: 'ジャンル' })
    expect(within(genres).getAllByRole('link').map((a) => a.textContent)).toEqual([
      '今日',
      '仕事・自動化',
      'エージェント',
      'ローカルLLM',
      'セキュリティニュース',
      'プロダクト',
      'VTuber・創作',
      'ツール・業界',
    ])
    expect(within(genres).getByRole('link', { name: '今日', current: 'page' })).toBeInTheDocument()
    const official = screen.getByRole('navigation', { name: '公式情報' })
    expect(within(official).getByRole('link', { name: '公式のお知らせ' })).toHaveAttribute('href', '#/feed')
    // 脆弱性の件数(見本は 5 件)
    expect(within(official).getByRole('link', { name: /^脆弱性\s*5$/ })).toHaveAttribute('href', '#/vuln')
    const mine = screen.getByRole('navigation', { name: '自分用' })
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
    expect(await waitForHeading('保存したネタ')).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: '保存', current: 'page' })).toBeInTheDocument()
    window.location.hash = ''
  })

  it('知らないハッシュ(昔の #/settings など)は「今日」に落ちる', async () => {
    renderApp('#/settings', sample)
    expect(await waitForHeading('今朝のネタ')).toBeInTheDocument()
    window.location.hash = ''
  })

  it('読み込み中は「読み込み中…」、失敗したらその旨を表示する', async () => {
    window.location.hash = ''
    render(<App load={() => new Promise(() => undefined)} />)
    expect(screen.getByText('読み込み中…')).toHaveAttribute('role', 'status')
    render(<App load={() => Promise.reject(new Error('壊れています'))} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('データを読み込めませんでした')
  })
})
