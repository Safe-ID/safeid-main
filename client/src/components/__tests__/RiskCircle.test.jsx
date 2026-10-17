import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import RiskCircle from '../RiskCircle'

describe('RiskCircle', () => {
  // Mesmas faixas do RiskEngine do backend: LOW < 26 ≤ MODERATE < 51 ≤ HIGH < 76 ≤ CRITICAL.
  // Antes do PR #76 o medidor usava 35/65 e um score 60 aparecia como "MÉDIO".
  it.each([
    [0, 'seguro'],
    [10, 'baixo'],
    [25, 'baixo'],
    [26, 'médio'],
    [50, 'médio'],
    [51, 'alto'],
    [60, 'alto'],
    [75, 'alto'],
    [76, 'crítico'],
    [100, 'crítico'],
  ])('labels a score of %i as "%s"', (score, label) => {
    render(<RiskCircle val={score} />)

    expect(screen.getByRole('img', { name: `Score de risco: ${score} de 100 (${label})` })).toBeInTheDocument()
    expect(screen.getByText(label.toUpperCase())).toBeInTheDocument()
  })

  it('shows the custom label while there is no verified result', () => {
    render(<RiskCircle val={0} label="PENDENTE" />)

    expect(screen.getByRole('img', { name: 'Score de risco: 0 de 100 (pendente)' })).toBeInTheDocument()
    expect(screen.getByText('PENDENTE')).toBeInTheDocument()
  })
})
