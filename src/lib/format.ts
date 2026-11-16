// 日付の整形。決め打ちの書式ではなく Intl を使う
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
