// デザイン案の見比べ(仮の画面。案が決まったら消す)。
// 3つの案を、「今日の放送」「ネタの詳細」× ライト/ダーク × 390px/PC の幅 で切り替えて見られる。
// 既存の画面のコードには触れず、案ごとに部品とスタイルを別に持つ。
import { useState } from 'react'
import { useData } from '../../data/DataProvider.tsx'
import { buildModel, type LabModel, type LabScreen, type LabTheme } from './labData.ts'
import { ProposalLive } from './ProposalLive.tsx'
import { ProposalFlip } from './ProposalFlip.tsx'
import { ProposalClock } from './ProposalClock.tsx'
import styles from './DesignLab.module.css'

type ProposalId = 'live' | 'flip' | 'clock'
type Width = 'phone' | 'desktop'

const PROPOSALS: { id: ProposalId; name: string; aim: string; look: string[] }[] = [
  {
    id: 'live',
    name: '案1 生放送',
    aim: '放送の画面そのものを作る。縁取りの白抜きテロップ、L字の帯、チャンネル番号のボタン。朝空の明るい青と、テロップの黄。',
    look: [
      'トップの1本は、縁取りの大きなテロップ。開いたとき1回だけ横からワイプで入る',
      '2本目からは「この後」の一覧。番号は黄色の札',
      'PC の幅では、左に進行表、右に詳細のL字になる(390px では縦に並ぶ)',
      '下は 1〜4 のチャンネル番号。線のアイコンは使わない',
    ],
  },
  {
    id: 'flip',
    name: '案2 朝刊フリップ',
    aim: '出演者が持つフリップボード。新聞の切り抜きのような明朝の見出し、縦書きの短冊、赤いマーカー、判子。',
    look: [
      '見出しは端末の明朝(iPhone はヒラギノ明朝、Windows は游明朝)。本文はゴシック',
      'コーナー名は縦書きの短冊。切り抜きは少し傾けて積み、上にテープ',
      'ネタを切り替えると、フリップがめくれる(動きを減らす設定では止まる)',
      'ダークは黒板。下は色つきの付箋のタブ',
    ],
  },
  {
    id: 'clock',
    name: '案3 スタジオの時計',
    aim: '画面の隅の時計と「この後」の横の予定表。時刻が主役で、色は白・墨・放送の赤・時刻の青だけ。',
    look: [
      '上に本物の時計(秒ごとに動く)。放送日と本数をその横に',
      '進行表は横にスナップする帯。1本が1枚で、親指で横に送る',
      '詳細は、PC の幅で本文と指標の2列になる',
      '下は文字だけの帯。選んだ所に赤い下線が滑る',
    ],
  },
]

export function DesignLab() {
  const state = useData()
  const [proposal, setProposal] = useState<ProposalId>('live')
  const [screen, setScreen] = useState<LabScreen>('today')
  const [theme, setTheme] = useState<LabTheme>('light')
  const [width, setWidth] = useState<Width>('phone')
  const [itemId, setItemId] = useState<string | null>(null)

  if (state.status !== 'ready') {
    return (
      <p className={styles.status} role="status">
        {state.status === 'loading' ? '読み込み中…' : 'データを読み込めませんでした'}
      </p>
    )
  }

  const model: LabModel | null = buildModel(state.data.items, state.data.genres, itemId)
  if (model === null) {
    return (
      <p className={styles.status} role="status">
        見本のデータがありません
      </p>
    )
  }

  const info = PROPOSALS.find((candidate) => candidate.id === proposal)!
  const props = {
    screen,
    theme,
    itemId,
    model,
    onOpen: (id: string) => {
      setItemId(id)
      setScreen('item')
    },
    onBack: () => {
      setScreen('today')
    },
  }

  return (
    <div className={styles.lab}>
      <header className={styles.controls}>
        <h1 className={styles.title}>デザイン案の見比べ</h1>
        <Choice<ProposalId>
          label="案"
          value={proposal}
          onChange={setProposal}
          options={PROPOSALS.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
        />
        <Choice<LabScreen>
          label="画面"
          value={screen}
          onChange={setScreen}
          options={[
            { value: 'today', label: '今日の放送' },
            { value: 'item', label: 'ネタの詳細' },
          ]}
        />
        <Choice<LabTheme>
          label="配色"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: 'ライト' },
            { value: 'dark', label: 'ダーク' },
          ]}
        />
        <Choice<Width>
          label="幅"
          value={width}
          onChange={setWidth}
          options={[
            { value: 'phone', label: '390px' },
            { value: 'desktop', label: 'PC' },
          ]}
        />
      </header>

      <div className={styles.body}>
        <div className={width === 'phone' ? styles.framePhone : styles.frameDesktop}>
          <div className={styles.frame} data-theme={theme}>
            {proposal === 'live' ? <ProposalLive {...props} /> : null}
            {proposal === 'flip' ? <ProposalFlip {...props} /> : null}
            {proposal === 'clock' ? <ProposalClock {...props} /> : null}
          </div>
        </div>
        <aside className={styles.notes} aria-labelledby="lab-notes-title">
          <h2 id="lab-notes-title" className={styles.notesTitle}>
            {info.name}のねらい
          </h2>
          <p>{info.aim}</p>
          <h3 className={styles.notesSub}>見てほしい点</h3>
          <ul className={styles.notesList}>
            {info.look.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className={styles.notesFoot}>
            どの案も、機能と安全性(出典のリンクの判定、文字のままの表示)は既存の画面と同じ関数を使っています。
          </p>
        </aside>
      </div>
    </div>
  )
}

interface ChoiceProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}

function Choice<T extends string>({ label, value, options, onChange }: ChoiceProps<T>) {
  return (
    <fieldset className={styles.choice}>
      <legend className={styles.choiceLegend}>{label}</legend>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.choiceButton}
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value)
          }}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  )
}
