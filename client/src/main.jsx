import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Safe_ID from './Safe_ID.jsx'

import './main.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Safe_ID />
  </StrictMode>,
)
