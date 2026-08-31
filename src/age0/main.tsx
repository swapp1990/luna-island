import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AgeZeroExperience } from './AgeZeroExperience'
import './foundation.css'
import './townbuilder.css'

const root = document.getElementById('age-zero-root')

if (!root) throw new Error('Age 0 root element is missing')

createRoot(root).render(
  <StrictMode>
    <AgeZeroExperience />
  </StrictMode>,
)
