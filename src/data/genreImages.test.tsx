import { describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import type * as GenreImages from './genreImages.ts'
import { genreImageOf } from './genreImages.ts'
import type { LoadedData } from './source.ts'
import { renderApp, waitForHeading } from '../test/renderApp.tsx'
import { baseSample } from '../test/sampleData.ts'

// 試験の中でジャンルの画像の表を差し替える。仕事・自動化(work)だけ画像がある
// (vi.mock は import より先に動くため、表も vi.hoisted で先に作る)
const { TABLE } = vi.hoisted(() => ({ TABLE: { work: 'fixtures/genre-work.jpg' } }))
vi.mock('./genreImages.ts', async () => {
  const actual = await vi.importActual<typeof GenreImages>('./genreImages.ts')
  return { GENRE_IMAGES: TABLE, genreImageOf: (genre: string | null) => actual.genreImageOf(genre, TABLE) }
})

const TOP = '2026-01-02-01'

/** トップの記事(仕事・自動化)の画像を変えた見本(架空) */
function sampleWith(patch: { imageUrl?: string; genre?: string | null }): LoadedData {
  return { ...baseSample, items: baseSample.items.map((item) => (item.id === TOP ? { ...item, imageUrl: undefined, ...patch } : item)) }
}

function feature(): HTMLElement {
  const title = document.getElementById('feature-title')
  const found = title?.closest('article')
  if (found === null || found === undefined) throw new Error('トップの枠がありません')
  return found
}

describe('ジャンルの画像(依頼 15-1、詳細設計 5.7.4)', () => {
  it('表からだけパスを作る。null・表に無い・オブジェクトの仕組みの名前は null', async () => {
    const actual = await vi.importActual<typeof GenreImages>('./genreImages.ts')
    expect(actual.genreImageOf('work', TABLE)).toBe('fixtures/genre-work.jpg')
    expect(actual.genreImageOf('agent', TABLE)).toBeNull()
    expect(actual.genreImageOf(null, TABLE)).toBeNull()
    expect(actual.genreImageOf('constructor', TABLE)).toBeNull()
    expect(actual.genreImageOf('__proto__', TABLE)).toBeNull()
    // 本物の表は8ジャンルすべて(ファイルは public/genres/。TST-GIMG-02)
    expect(Object.keys(actual.GENRE_IMAGES)).toHaveLength(8)
    expect(actual.genreImageOf('work')).toBe('genres/work.jpg')
    expect(genreImageOf('work')).toBe('fixtures/genre-work.jpg')
  })

  it('TST-GIMG-01 トップ:元記事の画像が無いとき、トップの枠にジャンルの画像(札「イメージ」は付けない)。一覧の行には出さない', async () => {
    renderApp('#/home', sampleWith({}))
    await waitForHeading('今日のニュース')
    const img = feature().querySelector('img')
    expect(img?.getAttribute('src')).toMatch(/\/fixtures\/genre-work\.jpg$/)
    expect(img).toHaveAttribute('alt', '')
    expect(within(feature()).queryByText('イメージ')).not.toBeInTheDocument()
    // 画像を出しているので、出典の横の札は出さない
    expect(within(feature()).queryByText('E')).not.toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'ニュース一覧' })
    expect(list.querySelector('img[src*="genre-work"]')).toBeNull()
    expect(within(list).queryByText('イメージ')).not.toBeInTheDocument()
    window.location.hash = ''
  })

  it('TST-GIMG-01 詳細:元記事の画像が無いとき、ジャンルの画像(札「イメージ」は付けない)', async () => {
    renderApp(`#/item/${TOP}`, sampleWith({}))
    const article = await screen.findByRole('article')
    const img = article.querySelector('img')
    expect(img?.getAttribute('src')).toMatch(/\/fixtures\/genre-work\.jpg$/)
    expect(within(article).queryByText('イメージ')).not.toBeInTheDocument()
    window.location.hash = ''
  })

  it('TST-GIMG-01 元記事の画像があるときはそれを出し、読み込みに失敗したらジャンルの画像、それも失敗したら札', async () => {
    renderApp(`#/item/${TOP}`, sampleWith({ imageUrl: 'fixtures/images/desk.svg' }))
    const article = await screen.findByRole('article')
    const first = article.querySelector('img')
    if (first === null) throw new Error('画像がありません')
    expect(first.getAttribute('src')).toMatch(/desk\.svg$/)
    expect(within(article).queryByText('イメージ')).not.toBeInTheDocument()
    fireEvent.error(first)
    const second = article.querySelector('img')
    if (second === null) throw new Error('ジャンルの画像がありません')
    expect(second.getAttribute('src')).toMatch(/genre-work\.jpg$/)
    expect(within(article).queryByText('イメージ')).not.toBeInTheDocument()
    fireEvent.error(second)
    expect(article.querySelector('img')).toBeNull()
    expect(within(article).queryByText('イメージ')).not.toBeInTheDocument()
    expect(within(article).getByText('E')).toHaveAttribute('aria-hidden', 'true')
    window.location.hash = ''
  })

  it('TST-GIMG-01 表に無いジャンル・ジャンルが null のときは今のまま(画像の場所を取らず札)', async () => {
    renderApp(`#/item/${TOP}`, sampleWith({ genre: 'agent' }))
    let article = await screen.findByRole('article')
    expect(article.querySelector('img')).toBeNull()
    expect(within(article).queryByText('イメージ')).not.toBeInTheDocument()
    expect(within(article).getByText('E')).toHaveAttribute('aria-hidden', 'true')

    cleanup()
    window.location.hash = ''
    renderApp('#/home', sampleWith({ genre: null }))
    await waitForHeading('今日のニュース')
    expect(feature().querySelector('img')).toBeNull()
    expect(within(feature()).queryByText('イメージ')).not.toBeInTheDocument()

    window.location.hash = `#/item/${TOP}`
    article = await screen.findByRole('article')
    expect(article.querySelector('img')).toBeNull()
    window.location.hash = ''
  })
})
