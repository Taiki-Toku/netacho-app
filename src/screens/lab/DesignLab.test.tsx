import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../App.tsx'
import type { LoadedData } from '../../data/source.ts'
import { parseGenres, parseItems } from '../../data/parse.ts'
import sampleItems from '../../../fixtures/sample-items.json'
import genresJson from '../../../fixtures/genres.json'

const sample: LoadedData = {
  items: parseItems(sampleItems),
  genres: parseGenres(genresJson),
  source: 'fixtures',
}

async function renderLab() {
  window.location.hash = '#/design-lab'
  render(<App load={() => Promise.resolve(sample)} />)
  await screen.findByRole('heading', { level: 1, name: 'デザイン案の見比べ' })
}

describe('デザイン案の見比べ(仮の画面)', () => {
  it('3案を切り替えられ、各案で今日の放送と詳細が出る', async () => {
    const user = userEvent.setup()
    await renderLab()
    for (const name of ['案1 生放送', '案2 朝刊フリップ', '案3 スタジオの時計']) {
      await user.click(screen.getByRole('button', { name }))
      await user.click(screen.getByRole('button', { name: '今日の放送' }))
      expect(screen.getByRole('list', { name: /進行表|この後のネタ/ })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'ネタの詳細' }))
      expect(screen.getByRole('article')).toBeInTheDocument()
    }
  })

  it('3案とも、https 以外の出典はリンクにせず、HTML 入りの見出しは文字のまま出す', async () => {
    const user = userEvent.setup()
    await renderLab()
    for (const name of ['案1 生放送', '案2 朝刊フリップ', '案3 スタジオの時計']) {
      await user.click(screen.getByRole('button', { name }))
      await user.click(screen.getByRole('button', { name: 'ネタの詳細' }))
      await user.click(screen.getByRole('button', { name: /次の/ }))
      // 7本目まで進む
      for (let step = 0; step < 5; step += 1) {
        await user.click(screen.getByRole('button', { name: /次の/ }))
      }
      const article = screen.getByRole('article')
      expect(within(article).getByRole('heading', { level: 2 })).toHaveTextContent('<script>alert(1)</script>')
      expect(article.querySelector('script')).toBeNull()
      expect(article.querySelector('a[href^="javascript:"]')).toBeNull()
      expect(within(article).getByText('javascript:alert(1)')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: '今日の放送' }))
    }
  })
})
