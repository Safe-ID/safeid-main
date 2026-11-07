import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SafeID from '../../Safe_ID'
import { fetchMe, getToken } from '../../lib/api'
import { violacoesDeAcessibilidade } from '../../test/axe'

// Verificação automática de acessibilidade (axe-core) das telas da aplicação.
// A API é simulada: o painel recebe um perfil com vazamentos, histórico e notificações.
vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal()),
  getToken: vi.fn(),
  fetchMe: vi.fn(),
  fetchScanHistory: vi.fn(async () => [
    { jobId: 'a', riskScore: 22, classification: 'LOW', source: 'SIGNUP', createdAt: '2026-10-01T12:00:00.000Z', breachesFound: 1 },
    { jobId: 'b', riskScore: 48, classification: 'MODERATE', source: 'MONITORING', createdAt: '2026-10-20T12:00:00.000Z', breachesFound: 2 },
  ]),
  fetchMonitoringStatus: vi.fn(async () => ({ enabled: true, lastMonitoredAt: '2026-11-01T12:00:00.000Z' })),
  fetchUnreadCount: vi.fn(async () => ({ count: 1 })),
  fetchNotifications: vi.fn(async () => ({
    items: [{ id: 1, type: 'NEW_BREACH', title: 'Novo vazamento', message: 'Seu e-mail apareceu em Adobe.', read: false, createdAt: '2026-11-01T12:00:00.000Z', breachName: 'Adobe' }],
    nextCursor: null,
  })),
}))

const perfil = {
  id: 1,
  email: 'pessoa@example.com',
  emailVerified: true,
  monitoringEnabled: true,
  scanSnapshot: {
    riskScore: 48,
    classification: 'MODERATE',
    breachesFound: 2,
    breachData: [
      { Name: 'Adobe', Title: 'Adobe', Domain: 'adobe.com', LogoPath: 'https://example.com/adobe.png', BreachDate: '2013-10-04', PwnCount: 152445165, DataClasses: ['Email addresses', 'Passwords'] },
      { Name: 'Canva', Title: 'Canva', Domain: 'canva.com', BreachDate: '2019-05-24', PwnCount: 137272116, DataClasses: ['Email addresses', 'Names'] },
    ],
    recommendation: 'Troque as senhas reutilizadas.',
    mitigationSteps: ['Troque a senha do Adobe.', 'Use um gerenciador de senhas.'],
    urgencyLevel: 'MEDIUM',
    isVerified: true,
  },
  scanSnapshotUpdatedAt: '2026-10-20T12:00:00.000Z',
}

function irPara(caminho) {
  window.history.replaceState({}, '', caminho)
}

async function auditar(nome) {
  const violacoes = await violacoesDeAcessibilidade()
  if (violacoes.length) console.log(`\n### ${nome}\n` + JSON.stringify(violacoes, null, 1))
  return violacoes
}

describe('acessibilidade (axe-core)', () => {
  afterEach(() => irPara('/'))

  describe('sem sessão', () => {
    beforeEach(() => vi.mocked(getToken).mockReturnValue(null))

    it('página inicial', async () => {
      render(<SafeID />)
      await screen.findByRole('heading', { level: 1 })
      expect(await auditar('página inicial')).toEqual([])
    })

    it('cadastro e login', async () => {
      const user = userEvent.setup()
      render(<SafeID />)
      await user.click((await screen.findAllByRole('button', { name: /criar conta/i }))[0])
      await screen.findByLabelText('EMAIL')
      expect(await auditar('cadastro')).toEqual([])

      await user.click(screen.getAllByRole('button', { name: /^Entrar$/ }).at(-1))
      await screen.findByLabelText('SENHA')
      expect(await auditar('login')).toEqual([])
    })

    it('troca de tela atualiza o título da aba e leva o foco ao conteúdo', async () => {
      const user = userEvent.setup()
      render(<SafeID />)
      await screen.findByRole('heading', { level: 1 })
      expect(document.title).toBe('SafeID: seu email apareceu em algum vazamento?')

      await user.click(screen.getAllByRole('button', { name: /^Entrar$/ })[0])
      await screen.findByLabelText('SENHA')
      expect(document.title).toBe('Entrar · SafeID')
      expect(document.getElementById('conteudo')).toHaveFocus()
    })

    it('oferece o atalho para pular ao conteúdo', async () => {
      render(<SafeID />)
      await screen.findByRole('heading', { level: 1 })
      expect(screen.getByRole('link', { name: 'Pular para o conteúdo' })).toHaveAttribute('href', '#conteudo')
    })

    it('textos legais e página não encontrada', async () => {
      for (const [caminho, nome] of [['/privacidade', 'privacidade'], ['/termos', 'termos'], ['/nao-existe', '404']]) {
        irPara(caminho)
        const { unmount } = render(<SafeID />)
        await screen.findByRole('heading', { level: 1 })
        expect(await auditar(nome)).toEqual([])
        unmount()
      }
    })
  })

  describe('com sessão', () => {
    beforeEach(() => {
      vi.mocked(getToken).mockReturnValue('token')
      vi.mocked(fetchMe).mockResolvedValue(perfil)
    })

    it('painel: visão geral, vazamentos e plano', async () => {
      const user = userEvent.setup()
      render(<SafeID />)
      await screen.findByText(/2 vazamentos encontrados para/)
      await screen.findByText(/2 análises/)
      expect(await auditar('painel - visão geral')).toEqual([])

      const abas = await screen.findByRole('tablist')
      await user.click(within(abas).getByRole('tab', { name: /Vazamentos/ }))
      expect(await auditar('painel - vazamentos')).toEqual([])

      await user.click(within(abas).getByRole('tab', { name: /Plano/ }))
      expect(await auditar('painel - plano')).toEqual([])
    })

    it('abas do painel seguem o padrão do teclado (setas, Home e End)', async () => {
      const user = userEvent.setup()
      render(<SafeID />)
      await screen.findByText(/2 vazamentos encontrados para/)

      const visao = await screen.findByRole('tab', { name: 'Visão Geral' })
      expect(visao).toHaveAttribute('aria-controls', 'painel-overview')
      expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'aba-overview')
      // Só a aba ativa entra no Tab
      expect(screen.getByRole('tab', { name: /Vazamentos/ })).toHaveAttribute('tabindex', '-1')

      visao.focus()
      await user.keyboard('{ArrowRight}')
      const vazamentos = screen.getByRole('tab', { name: /Vazamentos/ })
      expect(vazamentos).toHaveFocus()
      expect(vazamentos).toHaveAttribute('aria-selected', 'true')

      await user.keyboard('{End}')
      expect(screen.getByRole('tab', { name: /Plano/ })).toHaveFocus()
      await user.keyboard('{ArrowRight}')
      expect(screen.getByRole('tab', { name: 'Visão Geral' })).toHaveFocus()
    })

    it('gravidade dos dados expostos aparece em texto, não só na cor', async () => {
      render(<SafeID />)
      await screen.findByText(/2 vazamentos encontrados para/)
      // Senhas pesam 10 no motor de risco: gravidade alta
      expect((await screen.findAllByText('alta')).length).toBeGreaterThan(0)
    })

    it('o painel de notificações recebe o foco e o Esc devolve ao sino', async () => {
      const user = userEvent.setup()
      render(<SafeID />)
      await screen.findByText(/2 vazamentos encontrados para/)
      const sino = screen.getByRole('button', { name: /notifica/i })

      await user.click(sino)
      expect(await screen.findByRole('dialog', { name: 'Notificações' })).toHaveFocus()

      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(sino).toHaveFocus()
    })

    it('notificações abertas', async () => {
      const user = userEvent.setup()
      render(<SafeID />)
      await screen.findByText(/2 vazamentos encontrados para/)
      await user.click(screen.getByRole('button', { name: /notifica/i }))
      await screen.findByText('Novo vazamento')
      expect(await auditar('notificações')).toEqual([])
    })
  })
})
