// 試験からリポジトリの中のファイル(public/ の画像・CSS)を node:fs で読む。
// 型の定義(@types/node)は入れていない(依存を増やさない)ため、使う関数の形だけをここで書く。
// 試験はリポジトリの直下で動かす(npm test)ので、場所は作業ディレクトリからの相対で決める
interface Fs {
  existsSync(path: string): boolean
  statSync(path: string): { size: number }
  readFileSync(path: string): Uint8Array
}

const NODE_FS = 'node:fs'

function root(): string {
  return (globalThis as unknown as { process: { cwd(): string } }).process.cwd()
}

export async function repoFs(): Promise<{ fs: Fs; path: (relative: string) => string }> {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as Fs
  return { fs, path: (relative) => `${root()}/${relative}` }
}

/** リポジトリの中の文字のファイル(CSS など)を読む */
export async function readRepoText(relative: string): Promise<string> {
  const { fs, path } = await repoFs()
  return new TextDecoder().decode(fs.readFileSync(path(relative)))
}
