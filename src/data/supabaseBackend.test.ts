// supabaseBackend の試験。supabase-js の createClient を偽物に差し替え、通信はしない
import { beforeEach, describe, expect, it, vi } from 'vitest'

const signOut = vi.fn()

// 問い合わせの差し替え:呼ばれた順に [関数名, 引数] を残し、await すると result を返す
let queryCalls: [string, unknown[]][] = []
let queryResult: { data: unknown; error: unknown } = { data: [], error: null }
function queryBuilder() {
  const builder = {
    select: (...args: unknown[]) => record('select', args),
    gte: (...args: unknown[]) => record('gte', args),
    order: (...args: unknown[]) => record('order', args),
    limit: (...args: unknown[]) => record('limit', args),
    then: (resolve: (value: typeof queryResult) => unknown) => Promise.resolve(queryResult).then(resolve),
  }
  function record(name: string, args: unknown[]) {
    queryCalls.push([name, args])
    return builder
  }
  return builder
}
const from = vi.fn((table: string) => {
  queryCalls.push(['from', [table]])
  return queryBuilder()
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { signOut }, from }),
}))

const { createSupabaseBackend } = await import('./supabaseBackend.ts')
const { FeedLoadError } = await import('./backend.ts')

describe('公式フィードの読み込み', () => {
  const config = { url: 'https://example.supabase.co', publishableKey: 'k' }
  const now = () => new Date('2026-11-20T00:00:00.000Z')

  beforeEach(() => {
    queryCalls = []
    queryResult = { data: [], error: null }
  })

  it('TST-FEEDUI-02 feed_entries から決まった列を、90 日前以後・sort_at の新しい順・最大 1000 件で読む', async () => {
    await createSupabaseBackend(config, now).loadFeed()
    expect(queryCalls).toEqual([
      ['from', ['feed_entries']],
      ['select', ['id,kind,vendor,product,title,url,published_at,sort_at,severity,cvss,cve_ids,status']],
      ['gte', ['sort_at', '2026-08-22T00:00:00.000Z']],
      ['order', ['sort_at', { ascending: false }]],
      ['limit', [1000]],
    ])
  })

  it('TST-FEEDUI-02 90 日前の時刻は、呼ぶたびに今の時刻から作る', async () => {
    let current = new Date('2026-11-20T00:00:00.000Z')
    const backend = createSupabaseBackend(config, () => current)
    await backend.loadFeed()
    current = new Date('2026-11-21T12:00:00.000Z')
    await backend.loadFeed()
    expect(queryCalls.filter(([name]) => name === 'gte').map(([, args]) => args[1])).toEqual(['2026-08-22T00:00:00.000Z', '2026-08-23T12:00:00.000Z'])
  })

  it('TST-FEEDUI-02 行は FeedEntry に変え、形の崩れた行は捨てる', async () => {
    queryResult = {
      data: [
        { id: 'r1', kind: 'release', vendor: 'v', product: 'p', title: '架空', url: null, published_at: null, sort_at: '2026-11-19T00:00:00+00:00', severity: null, cvss: null, cve_ids: null, status: null },
        { id: '', kind: 'release', sort_at: '2026-11-19T00:00:00+00:00' },
      ],
      error: null,
    }
    const entries = await createSupabaseBackend(config, now).loadFeed()
    expect(entries.map((entry) => entry.id)).toEqual(['r1'])
  })

  it('失敗したら FeedLoadError を投げ、文言には code だけを添える(サーバーの文言は出さない)', async () => {
    queryResult = { data: null, error: { code: 'PGRST301', message: 'サーバーの詳しい文言' } }
    const failed = createSupabaseBackend(config, now).loadFeed()
    await expect(failed).rejects.toBeInstanceOf(FeedLoadError)
    await expect(failed).rejects.toHaveProperty('message', '公式フィードを読み込めませんでした(PGRST301)')

    // 形の合わない code は添えない
    queryResult = { data: null, error: { code: '<b>x</b>', message: 'サーバーの詳しい文言' } }
    await expect(createSupabaseBackend(config, now).loadFeed()).rejects.toHaveProperty('message', '公式フィードを読み込めませんでした')
  })
})

describe('ログアウト', () => {
  beforeEach(() => {
    signOut.mockReset()
  })

  it('ふつうは既定(global)の1回で終わる', async () => {
    signOut.mockResolvedValue({ error: null })
    await createSupabaseBackend({ url: 'https://example.supabase.co', publishableKey: 'k' }).auth.signOut()
    expect(signOut.mock.calls).toEqual([[]])
  })

  it('通信に失敗して error が返ったら、端末だけのログアウト(local)で端末のセッションを消す', async () => {
    signOut.mockResolvedValueOnce({ error: { name: 'AuthRetryableFetchError', status: 0 } }).mockResolvedValueOnce({ error: null })
    await createSupabaseBackend({ url: 'https://example.supabase.co', publishableKey: 'k' }).auth.signOut()
    expect(signOut.mock.calls).toEqual([[], [{ scope: 'local' }]])
  })

  it('例外が出ても local で消し、呼んだ側には例外を投げない', async () => {
    signOut.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ error: null })
    await expect(createSupabaseBackend({ url: 'https://example.supabase.co', publishableKey: 'k' }).auth.signOut()).resolves.toBeUndefined()
    expect(signOut.mock.calls).toEqual([[], [{ scope: 'local' }]])
  })
})
