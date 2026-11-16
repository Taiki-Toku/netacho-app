// 深刻度の札。色だけに頼らず、必ず文字のラベルを添える(仕様 1 章)
import { SEVERITY_LABELS } from '../data/labels.ts'
import type { Severity } from '../data/types.ts'
import styles from './SeverityPill.module.css'

const CLASS: Record<Severity, string> = {
  critical: styles.critical ?? '',
  high: styles.high ?? '',
  medium: styles.medium ?? '',
  low: styles.low ?? '',
  '': styles.plain ?? '',
}

export function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={CLASS[severity]}>{SEVERITY_LABELS[severity]}</span>
}

/** 種類などの、色を持たない札 */
export function PlainPill({ children }: { children: string }) {
  return <span className={styles.plain}>{children}</span>
}
