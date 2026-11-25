import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { TranslationLine } from './TranslationLine.tsx'

describe('機械翻訳の1行', () => {
  it('TST-TRUI-03 印と訳を lang="ja" の1つの段落にまとめて出す。リンクにしない', () => {
    const { container } = render(<TranslationLine original="Fictional title" translation="架空の訳" />)
    const line = container.querySelector('p')
    expect(line).not.toBeNull()
    expect(line).toHaveAttribute('lang', 'ja')
    expect(line).toHaveTextContent('機械翻訳架空の訳')
    // 印と訳は同じ段落の中の span(印だけを別の段落・見出しにしない)
    expect([...line!.querySelectorAll('span')].map((span) => span.textContent)).toEqual(['機械翻訳', '架空の訳'])
    expect(container.querySelector('a')).toBeNull()
    // 省略しても全文は DOM にある。title 属性には頼らない
    expect(line).not.toHaveAttribute('title')
  })

  it('TST-TRUI-03 訳が無い・空、または原文が空なら、印・行・余白の要素を出さない', () => {
    for (const [original, translation] of [
      ['Fictional title', undefined],
      ['Fictional title', ''],
      ['', '架空の訳'],
    ] as const) {
      const { container, unmount } = render(<TranslationLine original={original} translation={translation} />)
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
  })

  it('TST-TRUI-05 訳の中の <script> などの文字は、要素にならずそのまま文字として出る', () => {
    const text = '<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>'
    const { container } = render(<TranslationLine original="Fictional title" translation={text} />)
    expect(container.querySelector('script, img, a')).toBeNull()
    expect(container.querySelector('p')).toHaveTextContent(text)
  })
})
