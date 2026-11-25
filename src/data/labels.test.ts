import { describe, expect, it } from 'vitest'
import { SEVERITY_LABELS, SEVERITY_ORDER } from './labels.ts'

describe('深刻度のラベル', () => {
  it('表示は Critical/High/Medium/Low(仕様 v3.1 1章)。内部の値と並びは変えない', () => {
    expect(SEVERITY_ORDER.map((level) => SEVERITY_LABELS[level])).toEqual(['Critical', 'High', 'Medium', 'Low'])
    expect(SEVERITY_ORDER).toEqual(['critical', 'high', 'medium', 'low'])
    expect(SEVERITY_LABELS['']).toBe('未評価')
  })
})
