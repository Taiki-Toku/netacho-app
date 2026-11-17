// 設定(仕様 4 章の 8):アカウント(ログアウト)、この端末のデータ(件数と削除)、このアプリについて(版と最後に読み込んだ時刻)
import { useState, type ReactNode } from 'react'
import { hrefFor } from '../app/router.ts'
import { useAccount } from '../app/session.ts'
import { BrandMark } from '../components/BrandMark.tsx'
import { Icon } from '../components/Icon.tsx'
import type { LoadedData } from '../data/source.ts'
import { countUserData, useUserState, useUserStore } from '../data/userStore.ts'
import { formatLoadedAt } from '../lib/format.ts'
import pageStyles from '../components/page.module.css'
import styles from './SettingsScreen.module.css'

const CONFIRM_TEXT = 'この端末の保存・評価・メモをすべて削除します。元に戻せません。'

interface PartProps {
  id: string
  eyebrow: string
  title: string
  badge?: string
  children: ReactNode
}

/** 区分:英大文字の小見出し+番号、日本語の見出し、右に小さな札(あれば) */
function Part({ id, eyebrow, title, badge, children }: PartProps) {
  return (
    <section className={styles.part} aria-labelledby={id}>
      <div className={styles.partHead}>
        <div>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h2 id={id} className={styles.partTitle}>
            {title}
          </h2>
        </div>
        {badge !== undefined ? <span className={styles.badge}>{badge}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Rows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className={styles.rows}>
      {rows.map((row) => (
        <div key={row.label} className={styles.row}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

interface SettingsScreenProps {
  data: LoadedData
  /** ニュースの読み込みに成功した時刻 */
  loadedAt: Date
}

export function SettingsScreen({ data, loadedAt }: SettingsScreenProps) {
  const account = useAccount()
  const store = useUserStore()
  const counts = countUserData(useUserState())
  // 削除のあとの知らせ(aria-live の欄は最初から置き、文言だけを入れる。後から欄を足すと読み上げられないことがある)
  const [notice, setNotice] = useState('')

  function clearDeviceData() {
    if (!window.confirm(CONFIRM_TEXT)) return
    store.clear()
    setNotice('この端末のデータを削除しました')
  }

  return (
    <section aria-labelledby="settings-title">
      <a className={styles.back} href={hrefFor({ name: 'home' })}>
        <Icon name="back" />
        戻る
      </a>
      <h1 id="settings-title" className={pageStyles.heading} tabIndex={-1}>
        設定
      </h1>
      <div className={styles.card}>
        <Part id="settings-account" eyebrow="ACCOUNT / 01" title="アカウント">
          {account === null ? (
            <p className={styles.text}>ログインなし(見本のデータ)</p>
          ) : (
            <>
              <Rows rows={[{ label: 'メールアドレス', value: account.email ?? '—' }]} />
              <button type="button" className={pageStyles.textLink} onClick={account.signOut}>
                ログアウト
              </button>
            </>
          )}
        </Part>
        <Part id="settings-device" eyebrow="THIS DEVICE / 02" title="この端末のデータ" badge="DEVICE ONLY">
          <Rows
            rows={[
              { label: '保存', value: `${counts.saved}件` },
              { label: '評価', value: `${counts.ratings}件` },
              { label: 'メモ', value: `${counts.memos}件` },
              { label: 'ニュースの読み込み元', value: data.source === 'supabase' ? 'Supabase' : '見本' },
            ]}
          />
          <button type="button" className={styles.danger} onClick={clearDeviceData}>
            この端末の NODAL データをすべて削除
          </button>
          <p className={styles.status} aria-live="polite">
            {notice}
          </p>
          <p className={styles.note}>ログアウトしても、このデータは消えません。この端末にだけあります。</p>
        </Part>
        <Part id="settings-about" eyebrow="ABOUT / 03" title="このアプリについて">
          <div className={styles.brand}>
            <BrandMark />
            <span className={styles.brandName}>NODAL</span>
            <span className={styles.tagline}>Clarity in the Network.</span>
          </div>
          <p className={styles.text}>毎朝の AI のニュースと公式情報を読むためのアプリです。</p>
          <Rows
            rows={[
              { label: '版', value: `${__APP_VERSION__}(${__APP_COMMIT__})` },
              { label: '最後に読み込んだ時刻', value: formatLoadedAt(loadedAt) },
            ]}
          />
        </Part>
      </div>
    </section>
  )
}
