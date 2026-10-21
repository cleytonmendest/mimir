import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { createAuthGateway } from './lib/supabase/auth.ts'

const container = document.getElementById('root')
if (container === null) throw new Error('Elemento #root não encontrado')

createRoot(container).render(
  <StrictMode>
    <App auth={createAuthGateway()} />
  </StrictMode>,
)
