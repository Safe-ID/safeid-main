// @ts-check
const fs = require('fs');
const { test, expect } = require('@playwright/test');

const LOG = process.env.E2E_API_LOG;
// E-mail com vazamentos no simulador da HIBP (server/src/infra/http/hibp.mock.ts)
const EMAIL = 'breached@example.com';
const SENHA_1 = 'SenhaDeTeste1';
const SENHA_2 = 'SenhaDeTeste2';
const SENHA_3 = 'SenhaDeTeste3';

/** Espera um link novo no log do ConsoleEmailSender da API, que recebe o job pela fila real */
async function novoLink(parametro, depoisDe) {
  for (let i = 0; i < 60; i++) {
    const log = fs.readFileSync(LOG, 'utf8');
    const achados = [...log.slice(depoisDe).matchAll(new RegExp(`${parametro}=([A-Za-z0-9_%-]+)`, 'g'))];
    if (achados.length) return achados[achados.length - 1][1];
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`O link ${parametro} não chegou ao log`);
}

const tamanhoDoLog = () => fs.statSync(LOG).size;

async function entrar(page, senha) {
  await page.locator('#auth-email').fill(EMAIL);
  await page.locator('#auth-password').fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).last().click();
  await expect(page.getByRole('heading', { level: 1, name: /Olá/ })).toBeVisible();
}

/** Abre um item do menu do avatar (barra de navegação): "Editar cadastro" ou "Excluir conta" */
async function menuDaConta(page, item) {
  await page.getByRole('button', { name: /Menu da conta/ }).click();
  await page.getByRole('menu', { name: 'Conta' }).getByRole('menuitem', { name: item }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Editar cadastro' })).toBeVisible();
}

/** Troca de seção pela barra lateral de Editar cadastro */
async function secaoDoCadastro(page, secao) {
  await page.getByRole('navigation', { name: 'Seções do cadastro' }).getByRole('button', { name: secao }).click();
}

test('jornada completa da conta, do cadastro à exclusão', async ({ page }) => {
  test.skip(!LOG, 'Defina E2E_API_LOG com o caminho do log da API');
  test.setTimeout(240_000);

  await test.step('cadastro pede a confirmação do e-mail', async () => {
    const inicio = tamanhoDoLog();
    await page.goto('/');
    await page.getByRole('button', { name: 'Criar conta', exact: true }).first().click();
    await page.locator('#auth-email').fill(EMAIL);
    await page.locator('#auth-password').fill(SENHA_1);
    await page.locator('#auth-password-confirm').fill(SENHA_1);
    await page.getByRole('checkbox').first().check();
    await page.locator('form, div').getByRole('button', { name: /Criar conta/ }).last().click();
    await expect(page.getByRole('heading', { name: 'Confirme seu email' })).toBeVisible();
    test.info().annotations.push({ type: 'token', description: 'verificação' });

    await test.step('o link do e-mail abre o painel', async () => {
      const token = await novoLink('verify_token', inicio);
      await page.goto(`/?verify_token=${token}`);
      await expect(page.getByRole('heading', { level: 1, name: /Olá/ })).toBeVisible();
      await expect(page).not.toHaveURL(/verify_token/);
    });
  });

  await test.step('o painel mostra o risco, os vazamentos e o plano', async () => {
    await expect(page.getByText(/\d+\/100/).first()).toBeVisible({ timeout: 45_000 });
    await page.getByRole('tab', { name: /Vazamentos/ }).click();
    await expect(page.getByText('Equifax').first()).toBeVisible();
    // O cartão abre a descrição do vazamento, com a atribuição exigida pela licença da HIBP
    const cartao = page.getByRole('button', { name: /Equifax/ }).first();
    await cartao.click();
    await expect(cartao).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('O que aconteceu').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Have I Been Pwned/ }).first()).toHaveAttribute('href', 'https://haveibeenpwned.com/');
    await page.getByRole('tab', { name: /Plano IA/ }).click();
    await expect(page.getByRole('button', { name: 'Exportar PDF' })).toBeVisible();
  });

  await test.step('exportar PDF abre a impressão do navegador', async () => {
    await page.evaluate(() => {
      window.__impressoes = 0;
      window.print = () => { window.__impressoes += 1; };
    });
    await page.getByRole('button', { name: 'Exportar PDF' }).click();
    await expect.poll(() => page.evaluate(() => window.__impressoes)).toBe(1);
  });

  await test.step('o menu do avatar abre Editar cadastro', async () => {
    await menuDaConta(page, 'Editar cadastro');
    await expect(page.getByText('Email e senha')).toBeVisible();
  });

  await test.step('baixar os dados entrega o JSON da conta', async () => {
    await secaoDoCadastro(page, 'Seus dados');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Baixar meus dados' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^safeid-meus-dados-.*\.json$/);
    const dados = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(dados.conta.email).toBe(EMAIL);
    expect(JSON.stringify(dados)).not.toContain('passwordHash');
  });

  await test.step('trocar a senha mantém a sessão', async () => {
    await secaoDoCadastro(page, 'Senha e segurança');
    await page.getByRole('button', { name: 'Trocar senha' }).click();
    await page.getByLabel('SENHA ATUAL').fill(SENHA_1);
    await page.getByLabel('NOVA SENHA', { exact: true }).fill(SENHA_2);
    await page.getByLabel('CONFIRMAR NOVA SENHA').fill(SENHA_2);
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'outras sessões' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: /Olá/ })).toBeVisible();
  });

  await test.step('sair e recuperar a senha pelo link do e-mail', async () => {
    await page.getByRole('button', { name: 'Sair' }).click();
    await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
    const inicio = tamanhoDoLog();
    await page.locator('#auth-email').fill(EMAIL);
    await page.getByRole('button', { name: 'Esqueci minha senha' }).click();
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page.getByRole('status')).toContainText('Se houver uma conta');
    const token = await novoLink('reset_token', inicio);
    await page.goto(`/?reset_token=${token}`);
    await expect(page).not.toHaveURL(/reset_token/);
    await page.getByLabel('NOVA SENHA').fill(SENHA_3);
    await page.getByLabel('CONFIRMAR SENHA').fill(SENHA_3);
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();
  });

  await test.step('só a senha nova entra', async () => {
    await page.locator('#auth-email').fill(EMAIL);
    await page.locator('#auth-password').fill(SENHA_2);
    await page.getByRole('button', { name: 'Entrar', exact: true }).last().click();
    await expect(page.getByRole('alert')).toBeVisible();
    await entrar(page, SENHA_3);
  });

  await test.step('excluir a conta pede a confirmação e apaga o acesso', async () => {
    await menuDaConta(page, 'Excluir conta');
    const excluir = page.getByRole('button', { name: 'Excluir minha conta' });
    await expect(excluir).toBeDisabled();
    await page.getByLabel(/Para confirmar, digite/).fill('EXCLUIR');
    await excluir.click();
    await expect(page.getByText(/Sua conta foi excluída/)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /Olá/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
    await page.locator('#auth-email').fill(EMAIL);
    await page.locator('#auth-password').fill(SENHA_3);
    await page.getByRole('button', { name: 'Entrar', exact: true }).last().click();
    await expect(page.getByRole('alert')).toBeVisible();
  });
});
