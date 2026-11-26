// 日付の整形。決め打ちの書式ではなく Intl.DateTimeFormat('ja-JP', …) を使う(仕様 7 章)
export interface DateParts {
  year: string
  month: string
  day: string
  weekday: string
}

/** "YYYY-MM-DD" を端末のタイムゾーンに依らない日付(その日の正午)にする */
export function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day, 12)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

const partsFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
})

const longFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
})

export function dateParts(value: string): DateParts | null {
  const date = parseIsoDate(value)
  if (date === null) return null
  const parts = partsFormatter.formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return { year: pick('year'), month: pick('month'), day: pick('day'), weekday: pick('weekday') }
}

/** 「2026年1月2日(金)」の形。読めない日付は元の文字列のまま */
export function formatDateLong(value: string): string {
  const date = parseIsoDate(value)
  return date === null ? value : longFormatter.format(date)
}

const shortFormatter = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' })

/** 「1/2」の形(一覧の添え書き用)。読めない日付は元の文字列のまま */
export function formatDateShort(value: string): string {
  const date = parseIsoDate(value)
  return date === null ? value : shortFormatter.format(date)
}

const headerFormatter = new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' })

/** 「1月2日 金曜日」の形(上のバーと「今朝のネタ」の添え書き用)。読めない日付は元の文字列のまま */
export function formatDateHeader(value: string): string {
  const date = parseIsoDate(value)
  if (date === null) return value
  const parts = headerFormatter.formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('month')}月${pick('day')}日 ${pick('weekday')}`
}

/**
 * "YYYY-MM-DD" の形で、暦に実在する日付か(2月30日などは false)。
 * Date に変えずに文字列だけで確かめる(端末のタイムゾーンに左右されない。依頼 13-1)
 */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
  return day <= daysInMonth
}

/**
 * 記事の公開日(日付だけの値)を「公開 11月17日」の形にする。空・形の違う値は「公開日不明」。
 * Date に変えず、文字列から月と日を取り出す(タイムゾーンで前後の日にずらさない。design_spec v3.9 の 3-1)
 */
export function formatPublishedDate(value: string): string {
  if (!isCalendarDate(value)) return '公開日不明'
  const [, month = '', day = ''] = value.split('-')
  return `公開 ${Number(month)}月${Number(day)}日`
}

// 日付だけの値の「2026年11月24日(火)」。その日の UTC の正午を作り、UTC のまま書式に通す(端末のタイムゾーンを一切使わない)
const dateOnlyLongFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
})

/**
 * 配信日など日付だけの値を「2026年11月24日(火)」の形にする(バックナンバーの日付の一覧と見出し)。
 * 暦に無い・形の違う値は元の文字列のまま。端末のタイムゾーンが変わっても前後の日にずれない
 */
export function formatDateOnlyLong(value: string): string {
  if (!isCalendarDate(value)) return value
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
  return dateOnlyLongFormatter.format(new Date(Date.UTC(year, month - 1, day, 12)))
}

const tokyoDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** その時刻の、日本時間での日付("YYYY-MM-DD")。バックナンバーの「今日より前」を決めるのに使う */
export function tokyoToday(now: Date): string {
  const parts = tokyoDayFormatter.formatToParts(now)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

// 公式フィードの公開日時(UTC の ISO 8601)を、端末の設定に依らず日本時間で出す
const jstFormatter = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** 「1/3 11:00」の形(日本時間)。読めない日時は空文字 */
export function formatJstDateTime(iso: string): string {
  const time = Date.parse(iso)
  return Number.isNaN(time) ? '' : jstFormatter.format(new Date(time))
}

const jstDateFormatter = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric' })

/** 「1月3日」の形(日本時間。脆弱性の公開日用)。読めない日時は空文字 */
export function formatJstDate(iso: string): string {
  const time = Date.parse(iso)
  return Number.isNaN(time) ? '' : jstDateFormatter.format(new Date(time))
}

const loadedAtFormatter = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** ニュースを最後に読み込んだ時刻(設定の画面)。「11/17 08:05」の形、端末の時刻で */
export function formatLoadedAt(date: Date): string {
  return loadedAtFormatter.format(date)
}

/** CVSS の点数。「9.8」のように小数第1位まで。無ければ「－」 */
export function formatCvss(value: number | null): string {
  return value === null ? '－' : value.toFixed(1)
}
