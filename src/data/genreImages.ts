// ジャンルの画像(詳細設計 5.7.4、design_spec 5 章)。ジャンルの id → アプリに同梱した画像のパス(public/ からの相対)。
// ファイルがあるジャンルだけを載せる(画像のファイルは設計のチャットが public/genres/ に足し、そのときにこの表へ行を足す)。
// パスはこの表の値だけを使う。データ(ネタの genre)の値をつないでパスを作らない(表に無い値は null)
export const GENRE_IMAGES: Readonly<Record<string, string>> = {}

/** ジャンルの画像のパス。ジャンルが null・表に無いときは null。table は試験で表を差し替えるため */
export function genreImageOf(genre: string | null, table: Readonly<Record<string, string>> = GENRE_IMAGES): string | null {
  // Object.hasOwn:'constructor' など、オブジェクトの仕組みの名前を表の行と取り違えない
  if (genre === null || !Object.hasOwn(table, genre)) return null
  return table[genre] ?? null
}
