// バックナンバーと公開日(依頼 13-1、詳細設計 5.4.5)。データはすべて架空
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { parseItems } from '../data/parse.ts'
import type { LoadedData } from '../data/source.ts'
import { freshUserStore, renderApp, waitForHeading } from '../test/renderApp.tsx'
import { fullSample } from '../test/sampleData.ts'

// 今日(日本時間)は 2026-11-25。UTC では 11-24 の 15:30(日付の変わり目の後)にして、UTC の日付で決めていないことも確かめる
const NOW = '2026-11-24T15:30:00Z'

const items = parseItems([
  // 今日の分(バックナンバーには出さない)
  { id: 'today-1', date: '2026-11-25', order: 1, genre: 'work', title: '架空:今日のニュース1' },
  { id: 'today-2', date: '2026-11-25', order: 2, genre: 'tools', title: '架空:今日のニュース2' },
  // 11-24 の3本。並びは order の順(配列の順ではない)。公開日は配信日と別の値
  { id: 'a-3', date: '2026-11-24', order: 3, genre: 'tools', title: '架空:三本目', lead: 'リード3', publishedAt: '2026-11-20' },
  { id: 'a-1', date: '2026-11-24', order: 1, genre: 'work', title: '架空:一本目', lead: 'リード1', publishedAt: '2026-11-17', sourceUrl: 'https://example.com/a' },
  { id: 'a-2', date: '2026-11-24', order: 2, genre: 'agent', title: '架空:二本目', lead: 'リード2' },
  { id: 'b-1', date: '2026-11-20', order: 1, genre: 'work', title: '架空:11月20日の一本' },
  { id: 'c-1', date: '2026-11-18', order: 1, genre: 'creative', title: '架空:11月18日の一本' },
])

const data: LoadedData = { ...fullSample, items }

function archiveSection() {
  return screen.getByRole('region', { name: 'バックナンバー' })
}

describe('バックナンバー', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(NOW))
  })
  afterEach(() => {
    vi.useRealTimers()
    window.location.hash = ''
  })

  it('TST-ARC-01 #/archive は、今日より前で記事がある最も新しい日の URL に置き換わる(履歴に積まない)', async () => {
    renderApp('#/archive', data)
    await waitForHeading('バックナンバー')
    const length = window.history.length
    await waitFor(() => {
      expect(window.location.hash).toBe('#/archive/2026-11-24')
    })
    expect(window.history.length).toBe(length)
    expect(await screen.findByRole('heading', { level: 2, name: '2026年11月24日(火)のニュース' })).toBeInTheDocument()
  })

  it('TST-ARC-01 #/archive/<日付> を読み、形の違う・暦に無い日付は空の状態(最も新しい日へのリンク)', async () => {
    renderApp('#/archive/2026-11-20', data)
    expect(await screen.findByRole('heading', { level: 2, name: '2026年11月20日(金)のニュース' })).toBeInTheDocument()

    window.location.hash = '#/archive/2026-02-30'
    expect(await screen.findByText('この日のニュースはありません')).toBeInTheDocument()
    expect(within(archiveSection()).getByRole('link', { name: '2026年11月24日(火)のニュースを見る' })).toHaveAttribute('href', '#/archive/2026-11-24')
    // 置き換えない(URL は開いたまま)
    expect(window.location.hash).toBe('#/archive/2026-02-30')

    window.location.hash = '#/archive/<script>'
    await waitFor(() => {
      expect(screen.getByText('この日のニュースはありません')).toBeInTheDocument()
    })
    expect(within(archiveSection()).queryByText('<script>')).not.toBeInTheDocument()
  })

  it('TST-ARC-02 その日のニュースを order の順に番号つきで出す。今日の分・公式フィードは出さない', async () => {
    renderApp('#/archive/2026-11-24', data)
    const list = await screen.findByRole('list', { name: '2026年11月24日(火)のニュース' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((row) => within(row).getByRole('heading', { level: 3 }).textContent)).toEqual(['架空:一本目', '架空:二本目', '架空:三本目'])
    // 番号(見える番号と読み上げの番号)は order
    expect(rows.map((row) => row.getAttribute('value'))).toEqual(['1', '2', '3'])
    // 詳細へのリンクに from=archive:<日付> が付く
    expect(within(rows[0]!).getByRole('link', { name: '架空:一本目' })).toHaveAttribute('href', '#/item/a-1?from=archive%3A2026-11-24')
    // リード・出典・ジャンル名
    expect(within(rows[0]!).getByText('リード1')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('example.com')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('仕事・自動化')).toBeInTheDocument()
    expect(within(rows[1]!).getAllByText('エージェント').length).toBeGreaterThan(0)
    expect(screen.getByText('全3本')).toBeInTheDocument()

    const section = archiveSection()
    expect(within(section).queryByText(/今日のニュース[12]/)).not.toBeInTheDocument()
    for (const entry of data.feed) {
      if (entry.title !== '') expect(within(section).queryByText(entry.title)).not.toBeInTheDocument()
    }
  })

  it('TST-PUB-02 バックナンバーの行に公開日。空なら「公開日不明」。配信日で代わりにしない', async () => {
    renderApp('#/archive/2026-11-24', data)
    const list = await screen.findByRole('list', { name: '2026年11月24日(火)のニュース' })
    const rows = within(list).getAllByRole('listitem')
    expect(within(rows[0]!).getByText('公開 11月17日')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('公開日不明')).toBeInTheDocument()
    expect(within(rows[1]!).queryByText('公開 11月24日')).not.toBeInTheDocument()
    expect(within(rows[2]!).getByText('公開 11月20日')).toBeInTheDocument()
  })

  it('TST-ARC-03 前の日・次の日は記事のある日だけを辿り、端では押せない文字。select で選ぶと URL が変わり履歴に積む', async () => {
    renderApp('#/archive/2026-11-24', data)
    await screen.findByRole('heading', { level: 2, name: '2026年11月24日(火)のニュース' })
    let picker = screen.getByRole('navigation', { name: '配信日を選ぶ' })
    // 最も新しい日:次の日は押せない(今日の分へは進まない)
    expect(within(picker).queryByRole('link', { name: /次の日/ })).not.toBeInTheDocument()
    expect(within(picker).getByText('次の日')).toBeInTheDocument()
    // 11-23〜11-21 は記事が無いので飛ばす
    expect(within(picker).getByRole('link', { name: /前の日/ })).toHaveAttribute('href', '#/archive/2026-11-20')

    window.location.hash = '#/archive/2026-11-20'
    await screen.findByRole('heading', { level: 2, name: '2026年11月20日(金)のニュース' })
    picker = screen.getByRole('navigation', { name: '配信日を選ぶ' })
    expect(within(picker).getByRole('link', { name: /前の日/ })).toHaveAttribute('href', '#/archive/2026-11-18')
    expect(within(picker).getByRole('link', { name: /次の日/ })).toHaveAttribute('href', '#/archive/2026-11-24')

    window.location.hash = '#/archive/2026-11-18'
    await screen.findByRole('heading', { level: 2, name: '2026年11月18日(水)のニュース' })
    picker = screen.getByRole('navigation', { name: '配信日を選ぶ' })
    expect(within(picker).queryByRole('link', { name: /前の日/ })).not.toBeInTheDocument()
    expect(within(picker).getByText('前の日')).toBeInTheDocument()

    // select:記事がある日だけを新しい順に、「2026年11月24日(火)」の形で
    const select = within(picker).getByRole('combobox', { name: '配信日' })
    const options = within(select).getAllByRole('option')
    expect(options.map((option) => option.getAttribute('value'))).toEqual(['2026-11-24', '2026-11-20', '2026-11-18'])
    expect(options.map((option) => option.textContent)).toEqual(['2026年11月24日(火)', '2026年11月20日(金)', '2026年11月18日(水)'])
    expect(select).toHaveValue('2026-11-18')

    const length = window.history.length
    fireEvent.change(select, { target: { value: '2026-11-24' } })
    expect(window.location.hash).toBe('#/archive/2026-11-24')
    await screen.findByRole('heading', { level: 2, name: '2026年11月24日(火)のニュース' })
    expect(window.history.length).toBe(length + 1)
  })

  it('TST-ARC-04 記事の無い日(今日を含む)は「この日のニュースはありません」と最も新しい日へのリンク', async () => {
    renderApp('#/archive/2026-11-22', data)
    expect(await screen.findByText('この日のニュースはありません')).toBeInTheDocument()
    const section = archiveSection()
    expect(within(section).getByRole('link', { name: '2026年11月24日(火)のニュースを見る' })).toHaveAttribute('href', '#/archive/2026-11-24')
    expect(within(section).queryByRole('list')).not.toBeInTheDocument()
    // 日付の選び方は残す(別の日へ移れる)。前後は近い日へ
    const picker = within(section).getByRole('navigation', { name: '配信日を選ぶ' })
    expect(within(picker).getByRole('link', { name: /前の日/ })).toHaveAttribute('href', '#/archive/2026-11-20')
    expect(within(picker).getByRole('link', { name: /次の日/ })).toHaveAttribute('href', '#/archive/2026-11-24')

    window.location.hash = '#/archive/2026-11-25'
    await waitFor(() => {
      expect(within(archiveSection()).queryByText('架空:今日のニュース1')).not.toBeInTheDocument()
    })
    expect(screen.getByText('この日のニュースはありません')).toBeInTheDocument()
  })

  it('TST-ARC-04 前の日の配信が1つも無ければ、その旨を出す(空の画面にしない)', async () => {
    renderApp('#/archive', { ...data, items: items.filter((item) => item.date === '2026-11-25') })
    await waitForHeading('バックナンバー')
    expect(screen.getByText('まだバックナンバーはありません')).toBeInTheDocument()
    expect(window.location.hash).toBe('#/archive')
  })

  it('TST-ARC-06 入口:左メニューの LIBRARY(保存の下)、トップの日付の導線、保存の画面のリンク。下のメニューは4つのまま', async () => {
    renderApp('#/home', data)
    await waitForHeading('今日のニュース')
    const library = screen.getByRole('navigation', { name: 'LIBRARY' })
    expect(within(library).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['#/saved', '#/archive'])
    expect(within(library).getByRole('link', { name: 'バックナンバー' })).toBeInTheDocument()

    // トップ:今日の日付(日本時間)とバックナンバーへのリンクを1行で、トップの枠より上に
    const guide = screen.getByRole('navigation', { name: '日付' })
    expect(guide).toHaveTextContent('11月25日 水曜日')
    expect(within(guide).getByRole('link', { name: 'バックナンバー' })).toHaveAttribute('href', '#/archive')
    const feature = screen.getByRole('article', { name: '架空:今日のニュース1' })
    expect(guide.compareDocumentPosition(feature) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const mobile = screen.getByRole('navigation', { name: '画面の切り替え' })
    expect(within(mobile).getAllByRole('link')).toHaveLength(4)
    expect(within(mobile).queryByRole('link', { name: /バックナンバー/ })).not.toBeInTheDocument()

    // 左メニューで、バックナンバーの画面にいる間は選択中
    window.location.hash = '#/archive/2026-11-20'
    await waitForHeading('バックナンバー')
    expect(within(screen.getByRole('navigation', { name: 'LIBRARY' })).getByRole('link', { name: 'バックナンバー' })).toHaveAttribute('aria-current', 'page')
  })

  it('TST-ARC-06 保存の画面の一覧の下に、バックナンバーへのリンク(0件のときも)', async () => {
    const store = freshUserStore()
    store.toggleSaved('a-1')
    renderApp('#/saved', data, store)
    const heading = await waitForHeading('保存したニュース')
    const section = heading.closest('section')
    if (section === null) throw new Error('保存の画面の section がありません')
    const link = within(section).getByRole('link', { name: 'バックナンバー' })
    expect(link).toHaveAttribute('href', '#/archive')
    const list = within(section).getByRole('list', { name: '保存したニュース' })
    expect(list.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 保存の行にも公開日
    expect(within(list).getByText('公開 11月17日')).toBeInTheDocument()

    // 外して0件になっても、リンクは残る
    fireEvent.click(within(list).getByRole('button', { name: '保存から外す' }))
    expect(within(section).getByText('まだ何も入っていません')).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'バックナンバー' })).toHaveAttribute('href', '#/archive')
  })

  it('TST-PUB-02 トップ・ジャンル・さがすの行にも公開日(無ければ「公開日不明」)', async () => {
    renderApp('#/genre/work', data)
    const genreList = await screen.findByRole('list', { name: '仕事・自動化のニュース' })
    const genreRow = within(genreList).getByRole('link', { name: '架空:一本目' }).closest('li')
    expect(genreRow).not.toBeNull()
    expect(within(genreRow!).getByText('公開 11月17日')).toBeInTheDocument()

    window.location.hash = '#/search?q=%E4%B8%80%E6%9C%AC%E7%9B%AE'
    const searchList = await screen.findByRole('list', { name: '一致するニュース' })
    const searchRow = within(searchList).getByRole('link', { name: '架空:一本目' }).closest('li')
    expect(searchRow).not.toBeNull()
    expect(within(searchRow!).getByText('公開 11月17日')).toBeInTheDocument()

    window.location.hash = '#/home'
    const homeList = await screen.findByRole('list', { name: 'ニュース一覧' })
    expect(within(homeList).getAllByText('公開日不明')).toHaveLength(2)
  })
})
