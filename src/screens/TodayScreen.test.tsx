import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { App } from '../App.tsx'
import type { LoadedData } from '../data/source.ts'
import { parseGenres, parseItems } from '../data/parse.ts'
import sampleItems from '../../fixtures/sample-items.json'
import genresJson from '../../fixtures/genres.json'

const sample: LoadedData = {
  items: parseItems(sampleItems),
  genres: parseGenres(genresJson),
  source: 'fixtures',
}

async function renderToday() {
  window.location.hash = ''
  render(<App load={() => Promise.resolve(sample)} />)
  await screen.findByRole('heading', { level: 1, name: '今日の放送' })
  return screen.getByRole('list', { name: '進行表' })
}

describe('今日の放送', () => {
  it('最新日(2026-01-02)の7本だけを、順番どおりに出す', async () => {
    const list = await renderToday()
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(7)
    const links = within(list).getAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '#/item/2026-01-02-01',
      '#/item/2026-01-02-02',
      '#/item/2026-01-02-03',
      '#/item/2026-01-02-04',
      '#/item/2026-01-02-05',
      '#/item/2026-01-02-06',
      '#/item/2026-01-02-07',
    ])
    expect(screen.queryByText('架空:前の日の放送の1本目')).not.toBeInTheDocument()
    expect(screen.getByText('7本')).toBeInTheDocument()
  })

  it('評価済みの行に「済」の検印が付き、未評価には付かない', async () => {
    const list = await renderToday()
    const rows = within(list).getAllByRole('listitem')
    const stamps = within(list).getAllByRole('img', { name: '評価済み' })
    // 見本では rating が入っているのは 01, 02, 04, 06 の4本
    expect(stamps).toHaveLength(4)
    expect(within(rows[2]!).queryByRole('img', { name: '評価済み' })).not.toBeInTheDocument()
    expect(screen.getByText('済 4')).toBeInTheDocument()
  })

  it('コーナー名・情報の確かさ・ジャンルの名前を出す。ジャンルの一覧は fixtures から引く', async () => {
    const list = await renderToday()
    const rows = within(list).getAllByRole('listitem')
    expect(within(rows[0]!).getByText('取り組みに効く')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('公式')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('仕事・自動化')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('ツール・業界')).toBeInTheDocument()
  })

  it('見出しの中の HTML は文字のまま出て、要素にならない', async () => {
    const list = await renderToday()
    expect(within(list).getByText('架空:表示の安全確認 <script>alert(1)</script> <b>太字</b> &amp;')).toBeInTheDocument()
    expect(list.querySelector('script')).toBeNull()
    expect(list.querySelector('b')).toBeNull()
    expect(list.querySelector('img')).toBeNull()
  })

  it('1本目にはリード文も出す(トップニュース)', async () => {
    const list = await renderToday()
    const rows = within(list).getAllByRole('listitem')
    expect(within(rows[0]!).getByText('見本のリード文です。')).toBeInTheDocument()
    expect(within(rows[1]!).queryByText('何が変わったのかを1行で。')).not.toBeInTheDocument()
  })

  it('ネタが1本も無いときは、その旨を出す', async () => {
    window.location.hash = ''
    render(<App load={() => Promise.resolve({ items: [], genres: [], source: 'fixtures' })} />)
    expect(await screen.findByText('今日の放送はまだありません。')).toBeInTheDocument()
  })
})
