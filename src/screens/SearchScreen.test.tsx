import { describe, expect, it } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderApp, waitForHeading } from '../test/renderApp.tsx'
import { fullSample as sample } from '../test/sampleData.ts'

describe('さがす', () => {
  it('上の欄に入れて送ると、検索語が URL に入り、ネタ・公式のお知らせ・脆弱性を分けて出す', async () => {
    renderApp('', sample)
    await waitForHeading('今朝のネタ')
    const form = screen.getByRole('search')
    const input = within(form).getByRole('searchbox', { name: '検索語' })
    fireEvent.change(input, { target: { value: ' サンプルOS ' } })
    fireEvent.submit(form)
    expect(window.location.hash).toBe('#/search?q=%E3%82%B5%E3%83%B3%E3%83%97%E3%83%ABOS')
    expect(await waitForHeading('「サンプルOS」の結果')).toBeInTheDocument()
    expect(input).toHaveValue('サンプルOS')

    expect(screen.getByText('一致するネタがありません')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '一致するお知らせ' }).querySelectorAll('li')).toHaveLength(2)
    const vulns = screen.getByRole('list', { name: '一致する脆弱性' })
    expect(within(vulns).getByRole('link', { name: 'CVE-2026-90002' })).toBeInTheDocument()
    window.location.hash = ''
  })

  it('ネタは見出し・リード・要約・タグ・出典名・ジャンル名で探せる。語は空白で区切って全部含むものだけ', async () => {
    renderApp('#/search?q=手順書', sample)
    expect(await waitForHeading('「手順書」の結果')).toBeInTheDocument()
    const items = screen.getByRole('list', { name: '一致するネタ' })
    expect([...items.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '#/item/2026-01-03-06',
      '#/item/2026-01-02-01',
      '#/item/2026-01-02-03',
    ])
    window.location.hash = '#/search?q=手順書 差分'
    await waitForHeading('「手順書 差分」の結果')
    expect(screen.getByRole('list', { name: '一致するネタ' }).querySelectorAll('li')).toHaveLength(1)
    window.location.hash = '#/search?q=CVE-2026-90005'
    await waitForHeading('「CVE-2026-90005」の結果')
    expect(screen.getByRole('link', { name: 'CVE-2026-90005' })).toBeInTheDocument()
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
    await waitForHeading('今朝のネタ')
    const toggle = screen.getByRole('button', { name: '検索欄を開く' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: '検索欄を閉じる' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('searchbox', { name: '検索語' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '検索を閉じる' }))
    expect(screen.getByRole('button', { name: '検索欄を開く' })).toHaveAttribute('aria-expanded', 'false')
  })
})
