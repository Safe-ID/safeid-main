import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    expect(await screen.findByText('Médio')).toBeInTheDocument()
    // Um vazamento com 0 contas não pode deixar um "0" solto na linha do tempo
    expect(screen.queryByText(/contas$/)).not.toBeInTheDocument()

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.className).toContain('[overflow-wrap:anywhere]')
  })
})

describe('painel sem verificação manual', () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue('token')
  })

  it('não oferece botão para refazer o scan', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ ...profile, monitoringEnabled: true })
    render(<SafeID />)

    expect(await screen.findByText('1 vazamento detectado')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /verificar novamente/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/alertas estão desligados/i)).not.toBeInTheDocument()
  })

  it('avisa que o resultado não se atualiza quando os alertas estão desligados', async () => {
    vi.mocked(fetchMe).mockResolvedValue({ ...profile, monitoringEnabled: false })
    render(<SafeID />)

    expect(await screen.findByText('Seus alertas estão desligados.')).toBeInTheDocument()
    expect(screen.getByText(/resultado de 23\/10\/2026/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ligar alertas' })).toHaveAttribute('href', '#alertas')
  })

  it('explica que o scan que falhou é refeito sozinho', async () => {
    vi.mocked(fetchMe).mockResolvedValue({
      ...profile,
      monitoringEnabled: false,
      scanSnapshot: { riskScore: 0, classification: 'LOW', breachesFound: 0, breachData: null, isVerified: false },
    })
    render(<SafeID />)

    expect(await screen.findByText('Não conseguimos verificar o seu email agora')).toBeInTheDocument()
    expect(screen.getByText(/tenta de novo sozinho a cada hora/)).toBeInTheDocument()
    // O aviso de alertas desligados só faz sentido com um resultado válido
    expect(screen.queryByText('Seus alertas estão desligados.')).not.toBeInTheDocument()
  })
})

describe('textos legais', () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue(null)
    vi.mocked(fetchMe).mockResolvedValue({ ...profile, monitoringEnabled: true })
    window.history.replaceState({}, '', '/')
    window.scrollTo = vi.fn()
  })

  it('abre os Termos direto pelo endereço e volta para a página inicial', async () => {
    window.history.replaceState({}, '', '/termos')
    const user = userEvent.setup()
    render(<SafeID />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Termos de Uso' })).toBeInTheDocument()
    expect(screen.getByText(/Lucas Vieira de Souza/)).toBeInTheDocument()
    expect(screen.getByText(/safeidifsp@gmail\.com/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Voltar/ }))

    expect(window.location.pathname).toBe('/')
    expect(screen.getByRole('button', { name: 'Criar conta grátis' })).toBeInTheDocument()
  })

  it('logado, continua na política aberta pelo endereço e volta para o painel', async () => {
    vi.mocked(getToken).mockReturnValue('token')
    window.history.replaceState({}, '', '/privacidade')
    const user = userEvent.setup()
    render(<SafeID />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1, name: 'Política de Privacidade' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Voltar/ }))

    expect(window.location.pathname).toBe('/')
    expect(await screen.findByRole('heading', { level: 1, name: /Olá, w+/ })).toBeInTheDocument()
  })

  it('o rodapé leva aos textos, muda o endereço e credita a HIBP', async () => {
    const user = userEvent.setup()
    render(<SafeID />)

    await user.click(await screen.findByRole('link', { name: 'Termos de Uso' }))
    expect(window.location.pathname).toBe('/termos')
    expect(screen.getByRole('heading', { level: 1, name: 'Termos de Uso' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Privacidade' }))
    expect(window.location.pathname).toBe('/privacidade')
    expect(screen.getByRole('heading', { level: 1, name: 'Política de Privacidade' })).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /Have I Been Pwned/ })).toHaveAttribute('href', 'https://haveibeenpwned.com')
  })

  it('os botões do navegador navegam entre os textos', async () => {
    const user = userEvent.setup()
    render(<SafeID />)

    await user.click(await screen.findByRole('link', { name: 'Termos de Uso' }))
    window.history.replaceState({}, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(await screen.findByRole('button', { name: 'Criar conta grátis' })).toBeInTheDocument()
  })
})

describe('endereço inexistente', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/pagina-que-nao-existe')
    vi.mocked(getToken).mockReturnValue(null)
  })

  afterEach(() => {
    window.history.replaceState({}, '', '/')
  })

  it('mostra a página não encontrada e volta para o início', async () => {
    const user = userEvent.setup()
    render(<SafeID />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Voltar para o início' }))

    expect(window.location.pathname).toBe('/')
    expect(screen.queryByRole('heading', { name: 'Página não encontrada' })).not.toBeInTheDocument()
  })

  it('logado, continua na página não encontrada e o botão leva ao painel', async () => {
    vi.mocked(getToken).mockReturnValue('token')
    vi.mocked(fetchMe).mockResolvedValue(profile)
    const user = userEvent.setup()
    render(<SafeID />)

    await user.click(await screen.findByRole('button', { name: 'Voltar para o início' }))

    expect(await screen.findByRole('heading', { level: 1, name: /Olá, w+/ })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/')
  })

  it('abrir um texto legal e voltar não prende a pessoa na página não encontrada', async () => {
    const user = userEvent.setup()
    render(<SafeID />)

    await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' })
    await user.click(screen.getByRole('link', { name: 'Termos de Uso' }))
    expect(window.location.pathname).toBe('/termos')

    await user.click(screen.getAllByRole('button', { name: /Voltar/ })[0])

    expect(window.location.pathname).toBe('/')
    expect(screen.queryByRole('heading', { name: 'Página não encontrada' })).not.toBeInTheDocument()
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
