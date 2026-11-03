import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ResetPassword from '../ResetPassword'
import { resetPassword } from '../../lib/api'

vi.mock('../../lib/api', () => ({ resetPassword: vi.fn() }))

async function fill(user, password, confirm = password) {
  await user.type(screen.getByLabelText('NOVA SENHA'), password)
  await user.type(screen.getByLabelText('CONFIRMAR SENHA'), confirm)
  await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }))
}

describe('ResetPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('envia o token com a nova senha e volta para o login', async () => {
    resetPassword.mockResolvedValue({ message: 'ok' })
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<ResetPassword token="tok" onDone={onDone} />)

    await fill(user, 'NovaSenha123')

    expect(resetPassword).toHaveBeenCalledWith('tok', 'NovaSenha123')
    expect(onDone).toHaveBeenCalledWith('Senha alterada. Entre com a nova senha.')
  })

  it('valida a senha antes de chamar a API', async () => {
    const user = userEvent.setup()
    render(<ResetPassword token="tok" onDone={vi.fn()} />)

    await fill(user, 'curta')
    expect(screen.getByRole('alert')).toHaveTextContent('pelo menos 8 caracteres')

    await user.clear(screen.getByLabelText('NOVA SENHA'))
    await user.clear(screen.getByLabelText('CONFIRMAR SENHA'))
    await fill(user, 'NovaSenha123', 'OutraSenha123')
    expect(screen.getByRole('alert')).toHaveTextContent('não coincidem')

    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('explica o que fazer quando o link expirou', async () => {
    resetPassword.mockRejectedValue(Object.assign(new Error('expirado'), { code: 'TOKEN_EXPIRED' }))
    const onDone = vi.fn()
    const user = userEvent.setup()
    render(<ResetPassword token="tok" onDone={onDone} />)

    await fill(user, 'NovaSenha123')

    expect(await screen.findByRole('alert')).toHaveTextContent('Esqueci minha senha')
    expect(onDone).not.toHaveBeenCalled()
  })
})
