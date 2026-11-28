// public/ に同梱するファイルの検査(依頼 15-1、詳細設計 5.7.4・5.7.5)。node:fs で実物のファイルを読む
import { describe, expect, it } from 'vitest'
import { GENRE_IMAGES } from '../data/genreImages.ts'
import { repoFs } from '../test/repoFiles.ts'

/** node:fs と、public/ の中のファイルの場所 */
async function loadFs() {
  const { fs, path } = await repoFs()
  return { fs, publicFile: (file: string) => path(`public/${file}`) }
}

/** ジャンルの id(fixtures/genres.json と同じ8つ) */
const GENRE_IDS = ['work', 'agent', 'local-llm', 'security-news', 'product', 'creative', 'tools', 'idea']
const MAX_BYTES = 300 * 1024

/** PNG の IHDR から幅と高さを読む(8 バイトの印のあと、長さ・種類の 8 バイトに続く) */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  expect(Array.from(bytes.slice(0, 8))).toEqual(signature)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

describe('同梱のファイル', () => {
  it('TST-GIMG-02 ジャンルの画像の表のパスのファイルがすべてあり、300KB 以下。表の行は知っているジャンルで、パスは genres/<id>.jpg', async () => {
    const { fs, publicFile } = await loadFs()
    for (const [id, path] of Object.entries(GENRE_IMAGES)) {
      expect(GENRE_IDS).toContain(id)
      expect(path).toBe(`genres/${id}.jpg`)
      expect(fs.existsSync(publicFile(path)), path).toBe(true)
      expect(fs.statSync(publicFile(path)).size, path).toBeLessThanOrEqual(MAX_BYTES)
    }
  })

  it('TST-ICON-01 manifest のアイコンがすべてあり、PNG の大きさが sizes どおり。apple-touch-icon は 180×180', async () => {
    const { fs, publicFile } = await loadFs()
    const manifest = JSON.parse(new TextDecoder().decode(fs.readFileSync(publicFile('manifest.webmanifest')))) as {
      icons: { src: string; sizes: string; type: string }[]
    }
    expect(manifest.icons.length).toBeGreaterThan(0)
    for (const icon of manifest.icons) {
      expect(fs.existsSync(publicFile(icon.src)), icon.src).toBe(true)
      if (icon.type !== 'image/png') continue
      const [width, height] = icon.sizes.split('x').map(Number)
      expect(pngSize(fs.readFileSync(publicFile(icon.src))), icon.src).toEqual({ width, height })
    }
    expect(pngSize(fs.readFileSync(publicFile('icons/apple-touch-icon.png')))).toEqual({ width: 180, height: 180 })
  })
})
