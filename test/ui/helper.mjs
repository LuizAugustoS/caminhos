// Launcher compartilhado dos testes de navegador (Playwright).
// BASE_URL e o caminho do Chromium são parametrizáveis por ambiente, para
// rodar tanto localmente quanto no CI.
import { chromium } from 'playwright';

export const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// No CI usamos o Chromium instalado pelo Playwright (PLAYWRIGHT_CHROMIUM);
// localmente aceita o caminho do ambiente de dev.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM || undefined;

export async function launch() {
  return chromium.launch({ executablePath, args: ['--no-sandbox'] });
}

export async function login(page, email, password) {
  await page.goto(BASE_URL + '/');
  await page.fill('#f-email', email);
  await page.fill('#f-password', password);
  await page.click('#auth-submit');
}

// Pequeno runner: agrega OK/FALHA e encerra com código de saída adequado.
export function runner() {
  const results = [];
  return {
    check: (name, ok) => results.push(`${ok ? 'OK ' : 'FAIL'} ${name}`),
    finish(browser) {
      console.log(results.join('\n'));
      browser.close();
      process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
    },
  };
}
