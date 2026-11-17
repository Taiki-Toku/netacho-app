// データを読む所(1か所)。画面からは loadData() だけを使う。あとで Supabase に差し替える。
//
// 読み込み方(docs/beta_brief.md 2.1 と、オーナーの追加依頼 2026-11-16):
//   1. local-data/items.json(本物。git に入らない)を、実行時に fetch で取りに行く
//      - 開発サーバー(vite)はプロジェクト直下のファイルをそのまま配るので、開発中はこれが読める
//      - 本番のビルド(dist/)には含まれない(import していないため)。取りに行っても 404 で、2 に落ちる
//   2. 無ければ fixtures/sample-items.json + fixtures/sample-items-extra.json(架空の見本。ビルドに含まれる)
//   公式フィードも同じ作り:local-data/feed.json があればそれ、無ければ fixtures/sample-feed.json
import sampleItems from '../../fixtures/sample-items.json'
import sampleItemsExtra from '../../fixtures/sample-items-extra.json'
import sampleFeed from '../../fixtures/sample-feed.json'
import genresJson from '../../fixtures/genres.json'
import { parseFeed, parseGenres, parseItems } from './parse.ts'
import type { FeedEntry, Genre, Item } from './types.ts'

export type DataSource = 'local' | 'fixtures' | 'supabase'

export interface LoadedData {
  items: Item[]
  genres: Genre[]
  feed: FeedEntry[]
  source: DataSource
}

const LOCAL_ITEMS_PATH = 'local-data/items.json'
const LOCAL_FEED_PATH = 'local-data/feed.json'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

// 見本のネタが参照する画像(fixtures/images/*.svg)。ビルドに取り込み、配られる場所の URL に置き換える。
// 開発中は "/fixtures/images/desk.svg"、ビルド後は dist の中の assets/ の URL になる(どちらも同じオリジン)
const FIXTURE_IMAGE_PREFIX = 'fixtures/images/'
const fixtureImages = import.meta.glob<string>('../../fixtures/images/*.svg', { eager: true, query: '?url', import: 'default' })

function withBundledImage(item: Item): Item {
  if (!item.imageUrl?.startsWith(FIXTURE_IMAGE_PREFIX)) return item
  const bundled = fixtureImages[`../../${item.imageUrl}`]
  return bundled === undefined ? item : { ...item, imageUrl: bundled }
}

/** 見本のデータ一式(fixtures)。試験と、本物のデータが無いときの表示に使う */
export function fixtureData(): LoadedData {
  return {
    items: parseItems([...sampleItems, ...sampleItemsExtra]).map(withBundledImage),
    genres: parseGenres(genresJson),
    feed: parseFeed(sampleFeed),
    source: 'fixtures',
  }
}

/** Supabase モードのデータ一式:ネタは Supabase から、ジャンルは genres.json、公式フィードは空(表はまだ無い) */
export function supabaseData(items: Item[]): LoadedData {
  return { items, genres: parseGenres(genresJson), feed: [], source: 'supabase' }
}

export async function loadData(fetchFn: FetchLike = (input, init) => fetch(input, init)): Promise<LoadedData> {
  const fixtures = fixtureData()
  const localItems = parseItems(await tryLoadLocal(fetchFn, LOCAL_ITEMS_PATH))
  if (localItems.length === 0) return fixtures
  // 本物のネタがあるときは、フィードも本物だけを使う(見本のフィードを混ぜない)。無ければ空
  const localFeed = parseFeed(await tryLoadLocal(fetchFn, LOCAL_FEED_PATH))
  return { items: localItems, genres: fixtures.genres, feed: localFeed, source: 'local' }
}

/** local-data の JSON を取りに行く。無い・読めない・JSON でないときは null */
async function tryLoadLocal(fetchFn: FetchLike, path: string): Promise<unknown> {
  try {
    const url = new URL(path, document.baseURI).toString()
    const response = await fetchFn(url, { cache: 'no-store' })
    if (!response.ok) return null
    // 開発サーバーは無いパスにも index.html を 200 で返すため、JSON であることを確かめる
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) return null
    return (await response.json()) as unknown
  } catch {
    return null
  }
}
