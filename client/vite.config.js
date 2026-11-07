import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Fontes sempre como arquivo próprio: a CSP de produção (font-src 'self') bloqueia as que o
    // Vite embutiria no CSS como data: (as menores que 4 KB, como os subconjuntos cirílico e vietnamita).
    // Para o resto, undefined mantém o limite padrão do Vite
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf|eot)$/i.test(file) ? false : undefined),
  },
  server: {
    port: 3001,
    strictPort: true,
  },
  preview: {
    port: 3001,
    strictPort: true,
  },
})
