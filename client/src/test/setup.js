import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Sem globals do Vitest, a limpeza do DOM entre os testes é feita aqui
afterEach(() => {
  cleanup()
  localStorage.clear()
})

// O jsdom não implementa canvas; o axe-core consulta getContext e só precisa de um null
HTMLCanvasElement.prototype.getContext = () => null

// O index.html real declara o idioma; o jsdom começa sem ele
document.documentElement.lang = 'pt-BR'
