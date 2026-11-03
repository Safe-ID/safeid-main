// Converte os HTML de docs/testes/html em PDF. Rodar dentro de e2e/: node ../tests/relatorios/pdf.js
const fs = require('fs');
const path = require('path');
const { chromium } = require(require.resolve('@playwright/test', { paths: [path.resolve(__dirname, '..', '..', 'e2e')] }));

(async () => {
  const raiz = path.resolve(__dirname, '..', '..', 'docs', 'testes');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const arquivo of fs.readdirSync(path.join(raiz, 'html')).filter(f => f.endsWith('.html'))) {
    await page.goto('file:///' + path.join(raiz, 'html', arquivo).replace(/\\/g, '/'));
    await page.pdf({
      path: path.join(raiz, arquivo.replace('.html', '.pdf')),
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#64748b">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>',
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
    console.log('gerado', arquivo.replace('.html', '.pdf'));
  }
  await browser.close();
  fs.rmSync(path.join(raiz, 'html'), { recursive: true, force: true });
})();
