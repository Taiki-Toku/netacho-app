// データを読む所(1か所)。画面からは loadData() だけを使う。あとで Supabase に差し替える。
//
// 読み込み方(docs/beta_brief.md 2.1):
//   1. local-data/items.json(本物。git に入らない)を、実行時に fetch で取りに行く
//      - 開発サーバー(vite)はプロジェクト直下のファイルをそのまま配るので、開発中はこれが読める
//      - 本番のビルド(dist/)には含まれない(import していないため)。取りに行っても 404 で、2 に落ちる
//   2. 無ければ fixtures/sample-items.json(架空の見本。ビルドに含まれる)
import sampleItems from '../../fixtures/sample-items.json'
import genresJson from '../../fixtures/genres.json'
import { parseGenres, parseItems } from './parse.ts'
import type { Genre, Item } from './types.ts'

export type DataSource = 'local' | 'fixtures'

export interface LoadedData {
  items: Item[]
  genres: Genre[]
  source: DataSource
}

const LOCAL_DATA_PATH = 'local-data/items.json'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export async function loadData(fetchFn: FetchLike = (input, init) => fetch(input, init)): Promise<LoadedData> {
  const genres = parseGenres(genresJson)
  const local = await tryLoadLocal(fetchFn)
  if (local !== null) return { items: local, genres, source: 'local' }
  return { items: parseItems(sampleItems), genres, source: 'fixtures' }
}

async function tryLoadLocal(fetchFn: FetchLike): Promise<Item[] | null> {
  try {
    const url = new URL(LOCAL_DATA_PATH, document.baseURI).toString()
    const response = await fetchFn(url, { cache: 'no-store' })
    if (!response.ok) return null
    // 開発サーバーは無いパスにも index.html を 200 で返すため、JSON であることを確かめる
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('json')) return null
    const json: unknown = await response.json()
    const items = parseItems(json)
    return items.length > 0 ? items : null
  } catch {
    return null
  }
}
