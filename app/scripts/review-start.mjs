import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appDirectory = fileURLToPath(new URL('../', import.meta.url));
const pnpmVersion = '11.25.0';
process.chdir(appDirectory);

if (process.argv.includes('--help')) {
  console.log('ПОТОК — запуск локальной демонстрации');
  console.log('Start-POTOK.cmd              Установка зависимостей, сборка и запуск');
  console.log('Start-POTOK.cmd --port 5174  Использовать другой порт');
  console.log('Start-POTOK.cmd --prepare    Подготовить приложение без запуска сервера');
  console.log('Требуется Node.js 24+. При первой установке нужен интернет.');
  process.exit(0);
}

function tool(command, options = {}) {
  // All shell commands below are fixed literals. User arguments are forwarded
  // separately to Node, never interpolated into a shell command.
  return process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], { windowsHide: true, ...options })
    : spawnSync('/bin/sh', ['-c', command], options);
}

try {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Нужен Node.js 24 или новее. Установите его с https://nodejs.org/en/download и повторите запуск.');
  const fingerprint = createHash('sha256').update(readFileSync('package.json')).update(readFileSync('pnpm-lock.yaml')).digest('hex');
  const stamp = 'node_modules/.potok-dependencies';
  const ready = existsSync('node_modules/vinext/dist/cli.js') && existsSync('node_modules/wrangler/bin/wrangler.js') && existsSync(stamp) && readFileSync(stamp, 'utf8') === fingerprint;
  if (!ready) {
    console.log('\nПодготовка зависимостей ПОТОК. При первом запуске потребуется интернет.\n');
    const installed = tool('pnpm --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const hasPinnedPnpm = installed.status === 0 && installed.stdout.trim() === pnpmVersion;
    if (!hasPinnedPnpm && tool('npx --version', { stdio: 'ignore' }).status !== 0) throw new Error('Не найден npx. Установите полную версию Node.js с npm либо pnpm 11.25.0 и повторите запуск.');
    const command = hasPinnedPnpm ? 'pnpm install --frozen-lockfile' : 'npx --yes pnpm@11.25.0 install --frozen-lockfile';
    const install = tool(command, { stdio: 'inherit' });
    if (install.status !== 0) throw new Error('Не удалось установить зависимости. Проверьте подключение к интернету и повторите запуск.');
    writeFileSync(stamp, fingerprint);
  }
  console.log('\nПОТОК: после сообщения Ready откройте указанный в нём адрес');
  console.log('Вход: analyst / Potok-2026!\n');
  const run = spawnSync(process.execPath, ['scripts/local.mjs', ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
  if (run.error) throw run.error;
  process.exit(run.status ?? 1);
} catch (error) {
  console.error(`\nНе удалось запустить ПОТОК: ${error.message}\n`);
  process.exit(1);
}
