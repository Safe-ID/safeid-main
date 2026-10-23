import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SafeID from '../../Safe_ID'
import { fetchMe, getToken } from '../../lib/api'
import { classificationLabel, plural } from '../safeidData'

// Sessão restaurada pelo token salvo; o resto do painel só precisa responder vazio
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getToken: vi.fn(),
  fetchMe: vi.fn(),
  fetchScanHistory: vi.fn(async () => []),
  fetchMonitoringStatus: vi.fn(async () => ({ enabled: true, lastMonitoredAt: null })),
  fetchUnreadCount: vi.fn(async () => ({ count: 0 })),
}))

const LONG_EMAIL = 'wwwwwwwwwwwwwwwwwwwwww@beta.pendulum.cyou'

const profile = {
  id: 1,
  email: LONG_EMAIL,
  emailVerified: true,
  scanSnapshot: {
    riskScore: 40,
    classification: 'MODERATE',
    breachesFound: 1,
    breachData: [{ Name: 'Adobe', Title: 'Adobe', BreachDate: '2013-10-04', PwnCount: 0, DataClasses: ['Passwords'] }],
    isVerified: true,
  },
  scanSnapshotUpdatedAt: '2026-10-23T12:00:00.000Z',
}

describe('SafeID logado', () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue('token')
    vi.mocked(fetchMe).mockResolvedValue(profile)
  })

  it('mantém a sessão e fica no painel ao clicar na logo', async () => {
    const user = userEvent.setup()
    render(<SafeID />)

    expect(await screen.findByRole('heading', { level: 1, name: /Olá, w+/ })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'SafeID, ir para o painel' }))

    // Antes, a logo levava à página inicial e apagava o usuário da tela
    expect(screen.getByRole('heading', { level: 1, name: /Olá, w+/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Criar conta' })).not.toBeInTheDocument()
  })

  it('mostra classificação e plural em português e quebra o email longo', async () => {
    render(<SafeID />)

    expect(await screen.findByText('1 vazamento detectado')).toBeInTheDocument()
    expect(screen.getByText('Médio')).toBeInTheDocument()
    // Um vazamento com 0 contas não pode deixar um "0" solto na linha do tempo
    expect(screen.queryByText(/contas$/)).not.toBeInTheDocument()

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.className).toContain('[overflow-wrap:anywhere]')
  })
})

describe('textos do painel', () => {
  it('traduz a classificação do RiskEngine', () => {
    expect(classificationLabel('LOW')).toBe('Baixo')
    expect(classificationLabel('CRITICAL')).toBe('Crítico')
    expect(classificationLabel('N/D')).toBe('N/D')
  })

  it('usa singular para 1 e plural para o resto', () => {
    expect(plural(1, 'vazamento')).toBe('1 vazamento')
    expect(plural(0, 'vazamento')).toBe('0 vazamentos')
    expect(plural(3, 'vazamento')).toBe('3 vazamentos')
  })
})
