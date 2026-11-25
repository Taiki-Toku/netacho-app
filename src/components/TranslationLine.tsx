// 機械翻訳の1行:「機械翻訳」の印と訳文を、1つの段落(lang="ja")にまとめて出す(design_spec v3.9 の 3-3・7章、詳細設計 5.3)。
// 訳は外から来た信用しないデータ。React の標準の描画(文字として)だけで出し、リンクにしない。
// 原文の見出しが無いとき・訳が無いときは何も出さない(印・行・余白の要素を DOM に作らない)
import styles from './TranslationLine.module.css'

interface TranslationLineProps {
  /** 原文の見出し。空なら訳だけを見出しのように出さないため、何も出さない */
  original: string
  /** 見出しの訳(FeedEntry.titleJa)。無ければ何も出さない */
  translation: string | undefined
}

export function TranslationLine({ original, translation }: TranslationLineProps) {
  if (original === '' || translation === undefined || translation === '') return null
  return (
    <p className={styles.line} lang="ja">
      <span className={styles.label}>機械翻訳</span>
      <span className={styles.text}>{translation}</span>
    </p>
  )
}
