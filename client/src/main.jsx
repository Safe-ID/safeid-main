import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Safe_ID from './Safe_ID.jsx'

// Fontes servidas pelo próprio site: a CSP do CloudFront só aceita font-src 'self'
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
import '@fontsource-variable/fraunces/index.css';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource/jetbrains-mono/500.css';
import './main.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Safe_ID />
  </StrictMode>,
)
