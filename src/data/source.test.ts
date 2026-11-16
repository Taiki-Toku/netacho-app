import { describe, expect, it } from 'vitest'
import { fixtureData, loadData, type FetchLike } from './source.ts'

function jsonResponse(body: unknown, init: { status?: number; contentType?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': init.contentType ?? 'application/json' },
  })
}

const localItems = [{ id: '2026-03-01-01', date: '2026-03-01', order: 1, title: 'ローカルの1本' }]
const localFeed = [{ id: 'local-feed-1', kind: 'vuln', publishedAt: '2026-03-01T00:00:00Z', title: 'ローカルのフィード' }]

describe('loadData(データを読む所)', () => {
  it('local-data/items.json と feed.json が読めれば、それを使う', async () => {
    const requested: string[] = []
    const fetchFn: FetchLike = (input) => {
      requested.push(input)
      if (input.endsWith('/local-data/items.json')) return Promise.resolve(jsonResponse(localItems))
      if (input.endsWith('/local-data/feed.json')) return Promise.resolve(jsonResponse(localFeed))
      return Promise.resolve(new Response('not found', { status: 404 }))
    }
    const data = await loadData(fetchFn)
    expect(requested).toEqual(['http://localhost:3000/local-data/items.json', 'http://localhost:3000/local-data/feed.json'])
    expect(data.source).toBe('local')
    expect(data.items).toHaveLength(1)
    expect(data.items[0]?.title).toBe('ローカルの1本')
    expect(data.feed).toHaveLength(1)
    expect(data.feed[0]?.title).toBe('ローカルのフィード')
    expect(data.genres.length).toBeGreaterThan(0)
  })

  it('本物のネタがあってフィードが無いときは、フィードは空(見本のフィードを混ぜない)', async () => {
    const fetchFn: FetchLike = (input) =>
      Promise.resolve(input.endsWith('/local-data/items.json') ? jsonResponse(localItems) : new Response('', { status: 404 }))
    const data = await loadData(fetchFn)
    expect(data.source).toBe('local')
    expect(data.feed).toEqual([])
  })

  it('404 なら見本データに落ちる(ネタ 9+6 本、フィード 13 本)', async () => {
    const data = await loadData(() => Promise.resolve(new Response('not found', { status: 404 })))
    expect(data.source).toBe('fixtures')
    expect(data.items).toHaveLength(15)
    expect(data.feed).toHaveLength(13)
    expect(data).toEqual(fixtureData())
  })

  it('開発サーバーが index.html を 200 で返しても(JSON でない)、見本データに落ちる', async () => {
    const data = await loadData(() =>
      Promise.resolve(new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } })),
    )
    expect(data.source).toBe('fixtures')
  })

  it('壊れた JSON や、形の合わない JSON でも見本データに落ちる', async () => {
    const broken = await loadData(() =>
      Promise.resolve(new Response('{oops', { status: 200, headers: { 'content-type': 'application/json' } })),
    )
    expect(broken.source).toBe('fixtures')
    const wrongShape = await loadData(() => Promise.resolve(jsonResponse({ items: 'x' })))
    expect(wrongShape.source).toBe('fixtures')
  })

  it('通信そのものが失敗しても見本データに落ちる', async () => {
    const data = await loadData(() => Promise.reject(new Error('offline')))
    expect(data.source).toBe('fixtures')
  })
})
