import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SafeID from '../../Safe_ID'
import { clearToken, deleteAccount, fetchMe, getToken } from '../../lib/api'
import { violacoesDeAcessibilidade } from '../../test/axe'

// Menu do avatar na barra e a página Editar cadastro (com a exclusão da conta)
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getToken: vi.fn(),
  clearToken: vi.fn(),
  fetchMe: vi.fn(),
  deleteAccount: vi.fn(),
  fetchScanHistory: vi.fn(async () => []),
  fetchMonitoringStatus: vi.fn(async () => ({ enabled: true, lastMonitoredAt: null })),
  fetchUnreadCount: vi.fn(async () => ({ count: 0 })),
}))

const perfil = {
  id: 1,
  email: 'breached@example.com',
  emailVerified: true,
  hasPassword: true,
  monitoringEnabled: true,
  scanSnapshot: {
    riskScore: 60,
    classification: 'HIGH',
    breachesFound: 2,
    breachData: [
      { Name: 'Equifax', Title: 'Equifax', BreachDate: '2017-07-29', DataClasses: ['Email addresses'] },
      { Name: 'LinkedIn', Title: 'LinkedIn', BreachDate: '2021-06-22', DataClasses: ['Phone numbers'] },
    ],
    isVerified: true,
  },
  scanSnapshotUpdatedAt: '2026-11-07T12:00:00.000Z',
}

async function abrirMenu(user) {
  await screen.findByText(/2 vazamentos encontrados para/)
  const avatar = screen.getByRole('button', { name: /Menu da conta/ })
  await user.click(avatar)
  return { avatar, menu: await screen.findByRole('menu', { name: 'Conta' }) }
}

describe('menu da conta e Editar cadastro', () => {
  beforeEach(() => {
    vi.mocked(getToken).mockReturnValue('token')
    vi.mocked(fetchMe).mockResolvedValue(perfil)
    vi.mocked(deleteAccount).mockReset()
  })
  afterEach(() => window.history.replaceState({}, '', '/'))

  it('o card de boas-vindas não tem mais o selo de vazamentos nem o botão de excluir', async () => {
    render(<SafeID />)
    expect(await screen.findByText(/2 vazamentos encontrados para/)).toBeInTheDocument()
    expect(screen.queryByText('2 vazamentos detectados')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir conta' })).not.toBeInTheDocument()
  })

  it('o avatar abre o menu com o foco no primeiro item, e o Esc fecha e devolve o foco', async () => {
    const user = userEvent.setup()
    render(<SafeID />)
    const { avatar, menu } = await abrirMenu(user)

    expect(avatar).toHaveAttribute('aria-expanded', 'true')
    const itens = within(menu).getAllByRole('menuitem')
    expect(itens.map((item) => item.textContent)).toEqual(['Editar cadastro', 'Excluir conta'])
    expect(itens[0]).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(itens[1]).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(avatar).toHaveFocus()
  })

  it('Editar cadastro abre a página com a barra lateral e troca de seção', async () => {
    const user = userEvent.setup()
    render(<SafeID />)
    const { menu } = await abrirMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Editar cadastro' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Editar cadastro' })).toBeInTheDocument()
    expect(document.title).toBe('Editar cadastro · SafeID')
    const nav = screen.getByRole('navigation', { name: 'Seções do cadastro' })
    expect(within(nav).getByRole('button', { name: 'Perfil' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Email e senha')).toBeInTheDocument()

    await user.click(within(nav).getByRole('button', { name: 'Senha e segurança' }))
    expect(screen.getByRole('button', { name: 'Trocar senha' })).toBeInTheDocument()

    await user.click(within(nav).getByRole('button', { name: 'Seus dados' }))
    expect(screen.getByRole('button', { name: 'Baixar meus dados' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Voltar ao painel' }))
    expect(await screen.findByRole('heading', { level: 1, name: /Olá, breached/ })).toBeInTheDocument()
  })

  it('exclui a conta só depois de digitar EXCLUIR e volta à página inicial com o aviso', async () => {
    vi.mocked(deleteAccount).mockResolvedValue({ message: 'Conta deletada com sucesso' })
    const user = userEvent.setup()
    render(<SafeID />)
    const { menu } = await abrirMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Excluir conta' }))

    expect(await screen.findByRole('heading', { level: 2, name: 'Excluir conta' })).toBeInTheDocument()
    const confirmar = screen.getByRole('button', { name: 'Excluir minha conta' })
    expect(confirmar).toBeDisabled()

    await user.type(screen.getByLabelText(/Para confirmar, digite/), 'excluir')
    expect(confirmar).toBeEnabled()
    await user.click(confirmar)

    expect(deleteAccount).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/Sua conta foi excluída/)).toBeInTheDocument()
    expect(clearToken).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Menu da conta/ })).not.toBeInTheDocument()
  })

  it('se a exclusão falhar, avisa e continua na página', async () => {
    vi.mocked(deleteAccount).mockRejectedValue(new Error('Serviço indisponível'))
    const user = userEvent.setup()
    render(<SafeID />)
    const { menu } = await abrirMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Excluir conta' }))

    await user.type(await screen.findByLabelText(/Para confirmar, digite/), 'EXCLUIR')
    await user.click(screen.getByRole('button', { name: 'Excluir minha conta' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Serviço indisponível')
    expect(screen.getByRole('heading', { level: 1, name: 'Editar cadastro' })).toBeInTheDocument()
  })

  it('a página Editar cadastro passa na auditoria de acessibilidade', async () => {
    const user = userEvent.setup()
    render(<SafeID />)
    const { menu } = await abrirMenu(user)
    await user.click(within(menu).getByRole('menuitem', { name: 'Editar cadastro' }))
    await screen.findByRole('heading', { level: 1, name: 'Editar cadastro' })
    await waitFor(() => expect(screen.getByText('Email e senha')).toBeInTheDocument())

    const violacoes = await violacoesDeAcessibilidade()
    if (violacoes.length) console.log(JSON.stringify(violacoes, null, 1))
    expect(violacoes).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Excluir conta' }))
    expect(await violacoesDeAcessibilidade()).toEqual([])
  })
})
