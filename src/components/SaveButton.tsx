// 「保存」の付け外し。記事の行ではアイコンだけ(aria-label 付き)、詳細では文字付きのボタンにする。リンクの外に置く(仕様 7 章)
import { useToast } from './Toast.tsx'
import { Icon } from './Icon.tsx'
import { useUserState, useUserStore } from '../data/userStore.ts'
import styles from './SaveButton.module.css'

interface SaveButtonProps {
  id: string
  /** 文字も出す(詳細の画面) */
  labelled?: boolean
}

export function SaveButton({ id, labelled = false }: SaveButtonProps) {
  const store = useUserStore()
  const saved = useUserState().saved.includes(id)
  const toast = useToast()

  function toggle() {
    const nowSaved = store.toggleSaved(id)
    toast.show(nowSaved ? '保存しました' : '保存から外しました')
  }

  if (labelled) {
    return (
      <button type="button" className={saved ? styles.actionOn : styles.action} aria-pressed={saved} onClick={toggle}>
        <Icon name="bookmark" filled={saved} />
        {saved ? '保存済み' : '保存する'}
      </button>
    )
  }
  return (
    <button
      type="button"
      className={saved ? styles.iconOn : styles.icon}
      aria-label={saved ? '保存から外す' : '保存する'}
      aria-pressed={saved}
      onClick={toggle}
    >
      <Icon name="bookmark" filled={saved} />
    </button>
  )
}
