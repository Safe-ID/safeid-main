import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountSettings from '../AccountSettings'
import { changePassword, exportAccountData } from '../../lib/api'

vi.mock('../../lib/api', () => ({ changePassword: vi.fn(), exportAccountData: vi.fn() }))

async function submitChange(user, { current = 'SenhaAtual123', next = 'NovaSenha123', confirm = next } = {}) {
  await user.click(screen.getByRole('button', { name: 'Trocar senha' }))
  await user.type(screen.getByLabelText('SENHA ATUAL'), current)
  await user.type(screen.getByLabelText('NOVA SENHA'), next)
  await user.type(screen.getByLabelText('CONFIRMAR NOVA SENHA'), confirm)
  await user.click(screen.getByRole('button', { name: 'Salvar nova senha' }))
}

describe('AccountSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('troca a senha e avisa que as outras sessões caíram', async () => {
    changePassword.mockResolvedValue({})
    const user = userEvent.setup()
    render(<AccountSettings hasPassword />)

    await submitChange(user)

    expect(changePassword).toHaveBeenCalledWith('SenhaAtual123', 'NovaSenha123')
    expect(await screen.findByRole('status')).toHaveTextContent('outras sessões')
    expect(screen.queryByLabelText('SENHA ATUAL')).not.toBeInTheDocument()
  })

  it('não chama a API quando a confirmação não bate', async () => {
    const user = userEvent.setup()
    render(<AccountSettings hasPassword />)

    await submitChange(user, { confirm: 'OutraSenha123' })

    expect(screen.getByRole('alert')).toHaveTextContent('não coincidem')
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('traduz a senha atual incorreta e mantém o formulário aberto', async () => {
    changePassword.mockRejectedValue(Object.assign(new Error('x'), { code: 'INVALID_CURRENT_PASSWORD' }))
    const user = userEvent.setup()
    render(<AccountSettings hasPassword />)

    await submitChange(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('A senha atual está incorreta.')
    expect(screen.getByLabelText('SENHA ATUAL')).toBeInTheDocument()
  })

  it('conta só com Google não vê o formulário de troca', () => {
    render(<AccountSettings hasPassword={false} />)

    expect(screen.queryByRole('button', { name: 'Trocar senha' })).not.toBeInTheDocument()
    expect(screen.getByText(/entra pelo Google/)).toBeInTheDocument()
  })

  it('baixa a cópia dos dados em JSON', async () => {
    exportAccountData.mockResolvedValue({ conta: { email: 'a@example.com' } })
    const createObjectURL = vi.fn(() => 'blob:safeid')
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const user = userEvent.setup()
    render(<AccountSettings hasPassword />)

    await user.click(screen.getByRole('button', { name: 'Baixar meus dados' }))

    expect(exportAccountData).toHaveBeenCalled()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
    click.mockRestore()
  })

  it('mostra o erro quando a cópia falha', async () => {
    exportAccountData.mockRejectedValue(new Error('Muitas tentativas.'))
    const user = userEvent.setup()
    render(<AccountSettings hasPassword />)

    await user.click(screen.getByRole('button', { name: 'Baixar meus dados' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Muitas tentativas.')
  })
})
