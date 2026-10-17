import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Sem globals do Vitest, a limpeza do DOM entre os testes é feita aqui
afterEach(() => {
  cleanup()
  localStorage.clear()
})
