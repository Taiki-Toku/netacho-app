import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from './App.tsx'

describe('App(ひな形)', () => {
  it('アプリ名の見出しを表示する', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1, name: 'AIネタ帳' })).toBeInTheDocument()
  })
})
