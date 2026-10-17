import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Auth from '../Auth'
import { login, setAuthTokens, signup } from '../../lib/api'

vi.mock('../../lib/api', () => ({
  API_BASE_URL: 'http://localhost:3000',
  clearToken: vi.fn(),
  login: vi.fn(),
  resendVerification: vi.fn(),
  setAuthTokens: vi.fn(),
  signup: vi.fn(),
}))

const props = { onSuccess: vi.fn(), onSwitch: vi.fn(), onOpenPrivacy: vi.fn(), onGoToLogin: vi.fn() }

async function fillRegister(user, { email = 'Jane@Example.com', password = 'StrongPass123', confirm = password, terms = true } = {}) {
  await user.type(screen.getByLabelText('EMAIL'), email)
  await user.type(screen.getByLabelText('SENHA'), password)
  await user.type(screen.getByLabelText('CONFIRMAR SENHA'), confirm)
  if (terms) await user.click(screen.getByRole('checkbox', { name: /Li e aceito/ }))
}

describe('Auth (cadastro)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['a short password', { password: '1234567' }, 'Senha deve ter pelo menos 8 caracteres.'],
    ['different passwords', { confirm: 'OtherPass123' }, 'As senhas não coincidem.'],
    ['an unchecked privacy policy', { terms: false }, 'Para criar a conta, aceite a Política de Privacidade.'],
    ['an invalid e-mail', { email: 'sem-arroba' }, 'Email inválido.'],
  ])('blocks %s without calling the API', async (_label, values, message) => {
    const user = userEvent.setup()
    render(<Auth mode="register" {...props} />)

    await fillRegister(user, values)
    await user.click(screen.getByRole('button', { name: 'Criar conta e verificar' }))

    expect(screen.getByText(message)).toBeInTheDocument()
    expect(signup).not.toHaveBeenCalled()
  })

  it('signs up with the alerts on and asks to confirm the e-mail', async () => {
    signup.mockResolvedValue({ requiresEmailVerification: true, email: 'jane@example.com' })
    const user = userEvent.setup()
    render(<Auth mode="register" {...props} />)

    await fillRegister(user)
    await user.click(screen.getByRole('button', { name: 'Criar conta e verificar' }))

    expect(signup).toHaveBeenCalledWith('Jane@Example.com', 'StrongPass123', true, true)
    expect(await screen.findByRole('heading', { name: 'Confirme seu email' })).toBeInTheDocument()
    expect(screen.getByText('jane@example.com')).toBeInTheDocument()
    // O reenvio só libera depois do mesmo intervalo do backend
    expect(screen.getByRole('button', { name: /Reenviar link em \d+s/ })).toBeDisabled()
    expect(props.onSuccess).not.toHaveBeenCalled()
  })

  it('sends acceptMonitoring false when the alerts box is unchecked', async () => {
    signup.mockResolvedValue({ requiresEmailVerification: true, email: 'jane@example.com' })
    const user = userEvent.setup()
    render(<Auth mode="register" {...props} />)

    await fillRegister(user)
    await user.click(screen.getByRole('checkbox', { name: /Quero ser avisado/ }))
    await user.click(screen.getByRole('button', { name: 'Criar conta e verificar' }))

    expect(signup).toHaveBeenCalledWith('Jane@Example.com', 'StrongPass123', true, false)
  })
})

describe('Auth (login)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function submitLogin(user) {
    await user.type(screen.getByLabelText('EMAIL'), 'jane@example.com')
    await user.type(screen.getByLabelText('SENHA'), 'StrongPass123')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
  }

  it('stores the tokens and enters the dashboard', async () => {
    const session = { access_token: 'access', refresh_token: 'refresh', user: { id: 1, email: 'jane@example.com' } }
    login.mockResolvedValue(session)
    const user = userEvent.setup()
    render(<Auth mode="login" {...props} />)

    await submitLogin(user)

    expect(login).toHaveBeenCalledWith('jane@example.com', 'StrongPass123')
    expect(setAuthTokens).toHaveBeenCalledWith(session)
    expect(props.onSuccess).toHaveBeenCalledWith(session.user)
  })

  it('shows the confirmation screen for an unverified account', async () => {
    login.mockRejectedValue(Object.assign(new Error('Confirme seu email'), { status: 403, code: 'EMAIL_NOT_VERIFIED' }))
    const user = userEvent.setup()
    render(<Auth mode="login" {...props} />)

    await submitLogin(user)

    expect(await screen.findByRole('heading', { name: 'Confirme seu email' })).toBeInTheDocument()
    expect(props.onSuccess).not.toHaveBeenCalled()
  })

  it('shows the API message for wrong credentials', async () => {
    login.mockRejectedValue(Object.assign(new Error('Email ou senha inválidos'), { status: 401 }))
    const user = userEvent.setup()
    render(<Auth mode="login" {...props} />)

    await submitLogin(user)

    expect(await screen.findByText('Email ou senha inválidos')).toBeInTheDocument()
    expect(props.onSuccess).not.toHaveBeenCalled()
  })
})
