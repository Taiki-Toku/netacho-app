import { describe, expect, it } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { freshUserStore, renderApp, waitForHeading } from '../test/renderApp.tsx'
import { fullSample as sample } from '../test/sampleData.ts'

describe('保存', () => {
  it('何も保存していなければ案内を出す', async () => {
    renderApp('#/saved', sample)
    expect(await waitForHeading('保存したネタ')).toBeInTheDocument()
    expect(screen.getByText('まだ何も入っていません')).toBeInTheDocument()
    window.location.hash = ''
  })

  it('保存したネタを新しく保存した順に出し、端末に残った状態から再び開いても同じ', async () => {
    const store = freshUserStore()
    store.toggleSaved('2026-01-02-01')
    store.toggleSaved('2026-01-03-06')
    store.toggleSaved('nowhere')
    renderApp('#/saved', sample, store)
    await waitForHeading('保存したネタ')
    const list = screen.getByRole('list', { name: '保存したネタ' })
    expect([...list.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['#/item/2026-01-03-06', '#/item/2026-01-02-01'])

    // 一覧の保存ボタンで外すと、その場で消える
    fireEvent.click(within(list).getAllByRole('button', { name: '保存から外す' })[0]!)
    expect(list.querySelectorAll('li')).toHaveLength(1)
    expect(screen.getByText('保存から外しました')).toHaveAttribute('aria-live', 'polite')

    // 右の列にも並ぶ
    const rail = screen.getByRole('complementary', { name: '補助の情報' })
    expect(within(rail).getByRole('link', { name: /手順書の差分チェック/ })).toHaveAttribute('href', '#/item/2026-01-02-01')
    window.location.hash = ''
  })
})
