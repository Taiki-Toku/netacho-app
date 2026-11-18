// 左メニューの選択中の見た目(依頼 7-2):選択中と非選択で文字の大きさと太さが同じ(太字で英字の幅が広がり、大きく見えないように)
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import '../styles/tokens.css'
import { Sidebar } from './Sidebar.tsx'
import genresJson from '../../fixtures/genres.json'
import sidebarCss from './Sidebar.module.css?raw'

describe('左メニューの選択中', () => {
  it('「VTuber・創作」を選んでも、非選択の項目と font-size・font-weight が同じ', () => {
    render(<Sidebar route={{ name: 'genre', id: 'creative', kind: 'all' }} genres={genresJson} vulnCount={0} savedCount={0} />)
    const current = screen.getByRole('link', { name: 'VTuber・創作', current: 'page' })
    const other = screen.getByRole('link', { name: 'エージェント' })
    expect(getComputedStyle(current).fontSize).toBe(getComputedStyle(other).fontSize)
    expect(getComputedStyle(current).fontSize).not.toBe('')
    expect(getComputedStyle(current).fontWeight).toBe(getComputedStyle(other).fontWeight)
  })

  // ジャンルのタブ・下のメニューの CSS は試験で読み込まない設定(vite.config.ts の css.include)のため、ここでは左メニューだけを見る
  it('選択中だけに当たる規則に、太さ・大きさの変更が無い。フォーカスの枠は :focus-visible だけ', () => {
    // 選択中だけに当たる規則(非選択と共通の「.link, .linkOn」は除く)に、文字の大きさ・太さが無い
    const onlyOn = [...sidebarCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, selectors = '']) => {
      const names = selectors.split(',').map((name) => name.trim())
      return names.includes('.linkOn') && !names.includes('.link')
    })
    expect(onlyOn.length).toBeGreaterThan(0)
    for (const [, , rule = ''] of onlyOn) expect(rule).not.toMatch(/font-(weight|size)/)
    // マウスで押しただけで枠が出る :focus の指定は置かない
    expect(sidebarCss).not.toMatch(/:focus(?![-\w])/)
  })
})
