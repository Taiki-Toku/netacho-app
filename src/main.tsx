import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/global.css'
import { App } from './App.tsx'

const rootElement = document.getElementById('root')
if (rootElement === null) {
  throw new Error('index.html に id="root" の要素がありません')
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
