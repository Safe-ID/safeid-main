import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Testes de componente (Vitest + React Testing Library) em jsdom
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
})
