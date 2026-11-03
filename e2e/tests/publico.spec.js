// @ts-check
const { test, expect } = require('@playwright/test');

test('a página inicial leva ao cadastro e ao login', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();
  await page.getByRole('button', { name: 'Criar conta', exact: true }).first().click();
  await expect(page.getByLabel('CONFIRMAR SENHA')).toBeVisible();
});

test('os textos legais abrem pelo endereço', async ({ page }) => {
  await page.goto('/termos');
  await expect(page.getByRole('heading', { level: 1, name: 'Termos de Uso' })).toBeVisible();
  await page.goto('/privacidade');
  await expect(page.getByRole('heading', { level: 1, name: 'Política de Privacidade' })).toBeVisible();
});

test('endereço inexistente mostra a página não encontrada e volta ao início', async ({ page }) => {
  await page.goto('/pagina-que-nao-existe');
  await expect(page.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar para o início' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('o cadastro não envia sem aceitar os termos', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).first().click();
  await page.locator('#auth-email').fill('sem-aceite@example.com');
  await page.locator('#auth-password').fill('SenhaDeTeste1');
  await page.locator('#auth-password-confirm').fill('SenhaDeTeste1');
  await page.locator('form, div').getByRole('button', { name: /Criar conta/ }).last().click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Confirme seu email' })).toHaveCount(0);
});

test('login com senha errada mostra o erro e continua na tela', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Entrar', exact: true }).first().click();
  await page.locator('#auth-email').fill('ninguem@example.com');
  await page.locator('#auth-password').fill('SenhaErrada123');
  await page.getByRole('button', { name: 'Entrar', exact: true }).last().click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Esqueci minha senha' })).toBeVisible();
});

test('as páginas públicas não têm rolagem horizontal', async ({ page }) => {
  for (const path of ['/', '/termos', '/privacidade', '/nao-existe']) {
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(sobra, `rolagem horizontal em ${path}`).toBeLessThanOrEqual(0);
  }
});

test('não há erro de Content-Security-Policy nem exceção no console', async ({ page }) => {
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) erros.push(m.text());
  });
  await page.goto('/');
  await page.goto('/termos');
  await expect(page.locator('h1').first()).toBeVisible();
  expect(erros).toEqual([]);
});
