import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import BreachCard from '../BreachCard'
import BreachDescription from '../BreachDescription'
import { violacoesDeAcessibilidade } from '../../test/axe'

const traduzida = {
  lang: 'pt',
  segments: [
    { text: 'Em 2013, 153 milhões de contas foram vazadas com senhas ' },
    { text: 'criptografadas', em: true },
    { text: '. As dicas ' },
    { text: 'revelaram muito', href: 'https://example.com/post' },
    { text: '.' },
  ],
}

describe('BreachDescription', () => {
  it('monta a tradução com ênfase, link seguro e a atribuição da HIBP', () => {
    render(<BreachDescription name="Adobe" description={traduzida} />)

    expect(screen.getByText('O que aconteceu')).toBeInTheDocument()
    expect(screen.getByText('criptografadas').tagName).toBe('EM')
    const link = screen.getByRole('link', { name: /revelaram muito/ })
    expect(link).toHaveAttribute('href', 'https://example.com/post')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow')
    expect(link).toHaveAttribute('target', '_blank')

    expect(screen.getByText(/Tradução automática do texto do/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Have I Been Pwned/ })).toHaveAttribute('href', 'https://haveibeenpwned.com/')
    expect(screen.getByRole('link', { name: /ver original/ })).toHaveAttribute('href', 'https://haveibeenpwned.com/Breach/Adobe')
    expect(screen.getByText(/Em 2013/).closest('p')).toHaveAttribute('lang', 'pt-BR')
  })

  it('no original em inglês, marca o idioma e não oferece "ver original"', () => {
    render(<BreachDescription name="Sensivel" description={{ lang: 'en', segments: [{ text: 'Only in English.' }] }} />)

    expect(screen.getByText('Only in English.')).toHaveAttribute('lang', 'en')
    expect(screen.getByText(/Texto original, em inglês, do/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /ver original/ })).not.toBeInTheDocument()
  })

  it('nunca interpreta HTML nem aceita link perigoso', () => {
    const { container } = render(
      <BreachDescription
        name="X"
        description={{
          lang: 'en',
          segments: [
            { text: '<img src=x onerror="alert(1)">' },
            { text: 'clique', href: 'javascript:alert(1)' },
          ],
        }}
      />,
    )

    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'clique' })).not.toBeInTheDocument()
  })

  it('sem descrição, não mostra nada', () => {
    const { container } = render(<BreachDescription name="X" description={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('BreachCard com descrição', () => {
  const item = { Name: 'Adobe', Title: 'Adobe', BreachDate: '2013-10-04', PwnCount: 152445165, DataClasses: ['Passwords'], IsVerified: true }

  it('o cabeçalho é um botão que abre a área com a descrição, e os links não ficam dentro dele', async () => {
    const user = userEvent.setup()
    // Como no app: dentro do <main> de uma página com título
    document.title = 'Painel · SafeID'
    render(<main><BreachCard item={item} idx={0} description={traduzida} /></main>)

    const botao = screen.getByRole('button', { name: /Adobe/ })
    expect(botao).toHaveAttribute('aria-expanded', 'false')
    await user.click(botao)
    expect(botao).toHaveAttribute('aria-expanded', 'true')

    const link = screen.getByRole('link', { name: /revelaram muito/ })
    expect(botao.contains(link)).toBe(false)
    expect(document.getElementById(botao.getAttribute('aria-controls'))).toContainElement(link)

    // Clicar no link não fecha o cartão
    link.addEventListener('click', (e) => e.preventDefault())
    await user.click(link)
    expect(botao).toHaveAttribute('aria-expanded', 'true')

    expect(await violacoesDeAcessibilidade()).toEqual([])
  })
})
