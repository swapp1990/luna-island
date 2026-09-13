import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './lineage.css'

const root = document.getElementById('lineage-root')
if (!root) throw new Error('missing #lineage-root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
