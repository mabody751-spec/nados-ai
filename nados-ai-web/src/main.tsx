import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './AppV2'
import './styles.css'
import { initNativeShell } from './nativeBridge'

initNativeShell()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
