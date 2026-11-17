import { describe, expect, it } from 'vitest'
import sampleItems from '../../fixtures/sample-items.json'
import { parseItems } from './parse.ts'
import { itemSourceName, sourceNameOf } from './sourceName.ts'

const [first] = parseItems(sampleItems)

describe('出典の媒体名(URL のホスト名から)', () => {
  it('表にあるホストは表示名にする。先頭の www. は外す', () => {
    expect(sourceNameOf('https://zenn.dev/someone/articles/x')).toBe('Zenn')
    expect(sourceNameOf('https://qiita.com/x/items/1')).toBe('Qiita')
    expect(sourceNameOf('https://github.com/o/r')).toBe('GitHub')
    expect(sourceNameOf('https://www.github.com/o/r')).toBe('GitHub')
    expect(sourceNameOf('https://gigazine.net/news/x/')).toBe('GIGAZINE')
    expect(sourceNameOf('https://news.ycombinator.com/item?id=1')).toBe('Hacker News')
    expect(sourceNameOf('https://note.com/x/n/1')).toBe('note')
    // ホスト名は URL の解釈で小文字になる
    expect(sourceNameOf('https://WWW.Zenn.Dev/x')).toBe('Zenn')
  })

  it('表に無いホストは、ホスト名をそのまま(www. だけ外す)。表のホストのサブドメインは表に当てない', () => {
    expect(sourceNameOf('https://example.com/a')).toBe('example.com')
    expect(sourceNameOf('https://www.example.com/a')).toBe('example.com')
    expect(sourceNameOf('https://docs.github.com/x')).toBe('docs.github.com')
    expect(sourceNameOf('https://wwwexample.com/')).toBe('wwwexample.com')
  })

  it('リンクにできない URL(空、http:、javascript:、相対、ユーザー名入り)からは作らない', () => {
    expect(sourceNameOf('')).toBeNull()
    expect(sourceNameOf('http://zenn.dev/x')).toBeNull()
    expect(sourceNameOf('javascript:alert(1)')).toBeNull()
    expect(sourceNameOf('zenn.dev/x')).toBeNull()
    expect(sourceNameOf('https://zenn.dev@evil.example/')).toBeNull()
  })

  it('オブジェクトの仕組みの名前がホストでも、表の外の値を拾わない', () => {
    expect(sourceNameOf('https://constructor/')).toBe('constructor')
    expect(sourceNameOf('https://__proto__/')).toBe('__proto__')
  })

  it('画面に出す名前:URL から作れなければジャンル名', () => {
    if (first === undefined) throw new Error('見本のネタがありません')
    const item = { ...first, sourceUrl: 'https://zenn.dev/x' }
    expect(itemSourceName(item, '仕事・自動化')).toBe('Zenn')
    expect(itemSourceName({ ...item, sourceUrl: '' }, '仕事・自動化')).toBe('仕事・自動化')
    expect(itemSourceName({ ...item, sourceUrl: 'javascript:alert(1)' }, '未分類')).toBe('未分類')
  })
})
