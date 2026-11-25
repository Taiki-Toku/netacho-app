// 画面の試験が使う見本のデータ。
// - baseSample:基本の 9 本だけ(fixtures/sample-items.json)。最新日は 2026-01-02 の 7 本で、
//   HTML 入りの見出しや javascript: の出典を含む「表示の安全確認」のネタが最新日にある。
//   既存の画面(今日・詳細)の試験は、この組で安全性の確認を書く
// - fullSample:追加の 6 本と公式フィードを含む一式(loadData の見本と同じ)。最新日は 2026-01-03 の 6 本
import { parseGenres, parseItems } from '../data/parse.ts'
import { fixtureData, type LoadedData } from '../data/source.ts'
import sampleItems from '../../fixtures/sample-items.json'
import genresJson from '../../fixtures/genres.json'

export const baseSample: LoadedData = {
  items: parseItems(sampleItems),
  genres: parseGenres(genresJson),
  feed: [],
  feedError: null,
  source: 'fixtures',
}

export const fullSample: LoadedData = fixtureData()
