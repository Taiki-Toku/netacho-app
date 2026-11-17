// ログイン(Supabase モードで、セッションが無いときだけ出す)。メールに届く6桁のコードでログインする。
// 1. メールアドレスを入れて「コードを送る」 2. 届いたコードを入れて「ログイン」。送り直しは送ってから 60 秒は押せない
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BrandMark } from '../components/BrandMark.tsx'
import type { AuthApi, AuthResult } from '../data/backend.ts'
import pageStyles from '../components/page.module.css'
import styles from './LoginScreen.module.css'

export const RESEND_WAIT_SECONDS = 60
const CODE_LENGTH = 6

function failureMessage(result: AuthResult & { ok: false }): string {
  switch (result.reason) {
    case 'invalid-code':
      return 'コードが違うか、期限が切れています。'
    case 'rate-limit':
      return 'コードを送る回数の上限に達しました。しばらく待ってから、もう一度試してください。'
    case 'not-allowed':
      return 'このメールアドレスでは使えません。'
    case 'network':
      return '通信に失敗しました。電波の状態を確かめて、もう一度試してください。'
    case 'unknown':
      return result.code === undefined ? 'ログインできませんでした。' : `ログインできませんでした(${result.code})。`
  }
}

interface LoginScreenProps {
  auth: AuthApi
  onSignedIn: () => void
}

export function LoginScreen({ auth, onSignedIn }: LoginScreenProps) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  // 送り直せるようになる時刻と、今の時刻(1秒ごとに進める)。
  // 残りは時刻の差から出す(iPhone で裏に回ってタイマーが止まっても、戻ったときに正しい残りになる)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000))
  const emailRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const firstStep = useRef(true)

  // 欄が切り替わったら、新しい欄に入力の位置を移す(iPhone はすぐにキーボードとコードの候補を出す)。最初の表示では動かさない
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false
      return
    }
    const target = step === 'code' ? codeRef.current : emailRef.current
    target?.focus()
  }, [step])

  useEffect(() => {
    if (resendAt <= Date.now()) return
    const timer = window.setInterval(() => {
      const time = Date.now()
      setNow(time)
      if (time >= resendAt) window.clearInterval(timer)
    }, 1000)
    return () => {
      window.clearInterval(timer)
    }
  }, [resendAt])

  async function send() {
    setBusy(true)
    setMessage('コードを送っています…')
    const result = await auth.sendCode(email.trim())
    setBusy(false)
    if (result.ok) {
      setStep('code')
      setCode('')
      const time = Date.now()
      setNow(time)
      setResendAt(time + RESEND_WAIT_SECONDS * 1000)
      setMessage('コードを送りました。メールに届いた6桁の数字を入れてください。')
    } else {
      setMessage(failureMessage(result))
    }
  }

  async function verify() {
    setBusy(true)
    setMessage('確かめています…')
    const result = await auth.verifyCode(email.trim(), code)
    if (result.ok) {
      onSignedIn()
      return
    }
    setBusy(false)
    setMessage(failureMessage(result))
  }

  function onSubmitEmail(event: FormEvent) {
    event.preventDefault()
    if (!busy) void send()
  }

  function onSubmitCode(event: FormEvent) {
    event.preventDefault()
    if (!busy && code.length === CODE_LENGTH) void verify()
  }

  function changeEmail() {
    setStep('email')
    setCode('')
    setMessage('')
  }

  return (
    <main id="main" className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.brand}>
          <BrandMark />
          <span className={styles.brandName}>NODAL</span>
        </div>
        <h1 className={pageStyles.heading}>ログイン</h1>
        {step === 'email' ? (
          <form className={styles.form} onSubmit={onSubmitEmail}>
            <label className={styles.label} htmlFor="login-email">
              メールアドレス
            </label>
            <input
              ref={emailRef}
              id="login-email"
              className={styles.input}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
              }}
            />
            <button type="submit" className={styles.primary} disabled={busy}>
              コードを送る
            </button>
          </form>
        ) : (
          <form className={styles.form} onSubmit={onSubmitCode}>
            <p className={styles.sentTo}>
              送り先:<span className={styles.email}>{email.trim()}</span>
            </p>
            <label className={styles.label} htmlFor="login-code">
              6桁のコード
            </label>
            <input
              ref={codeRef}
              id="login-code"
              className={styles.input}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={CODE_LENGTH}
              required
              value={code}
              onChange={(event) => {
                // 数字以外は入れない(全角の数字・空白・ハイフンを貼り付けても、半角の数字だけが残る)
                setCode(event.target.value.normalize('NFKC').replace(/\D/g, '').slice(0, CODE_LENGTH))
              }}
            />
            <button type="submit" className={styles.primary} disabled={busy || code.length !== CODE_LENGTH}>
              ログイン
            </button>
            <div className={styles.actions}>
              <button type="button" className={pageStyles.textLink} disabled={busy || wait > 0} onClick={() => void send()}>
                コードを送り直す
              </button>
              {wait > 0 ? <span className={styles.wait}>あと{wait}秒</span> : null}
              <button type="button" className={pageStyles.textLink} disabled={busy} onClick={changeEmail}>
                メールアドレスを変える
              </button>
            </div>
          </form>
        )}
        <p className={styles.status} role="status" aria-live="polite">
          {message}
        </p>
      </div>
    </main>
  )
}
