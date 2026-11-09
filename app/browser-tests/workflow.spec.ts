import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { BASE_SCENARIO, createDataset } from '../lib/engine/fixtures';
import { simulate } from '../lib/engine/simulation';
import { comparePaired, makeSeeds } from '../lib/engine/experiments';
import { runDemonstration, type DemoStep } from '../lib/demonstration';

async function login(page: Page, viewer = false) {
  await page.goto('/');
  if (viewer) await page.getByRole('button', { name: 'Наблюдатель', exact: false }).click();
  await page.getByRole('button', { name: 'Войти в систему', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Участок отгрузки', exact: true })).toBeVisible();
}
async function nav(page: Page, name: string) { await page.locator('.sidebar nav').getByRole('button', { name, exact: true }).click(); }
async function exported(page: Page, button: string) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  const file = await download;
  return JSON.parse(await readFile((await file.path())!, 'utf8'));
}
const number = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(n);

test('edit, calculate, compare, save, new login and replay preserve the shift', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await login(page); await nav(page, 'Сценарии');
  const name = `Приёмка ${Date.now()}`;
  await page.getByLabel('Название сценария', { exact: true }).fill(name);
  await page.getByLabel('Активные посты налива', { exact: false }).fill('4');
  await page.getByLabel('Seed расчёта', { exact: false }).fill('71');
  await page.getByRole('button', { name: 'Рассчитать смену', exact: true }).click();
  await expect(page.locator('.draft-banner')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('Смена рассчитана');
  await page.getByRole('button', { name: 'Сравнить 30 смен', exact: true }).click();
  const comparison = page.locator('.decision-comparison');
  await expect(comparison).toHaveAttribute('data-stale', 'false');
  const expected = comparePaired(createDataset(), BASE_SCENARIO, { ...BASE_SCENARIO, bayCount: 4 }, makeSeeds(71, 30));
  await expect(comparison.getByRole('row', { name: /Отгружено/ })).toContainText(number(expected.candidate.estimates.shippedTonnes.mean));
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/calculations' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click();
  const savedResponse = await response; expect(savedResponse.status()).toBe(201);
  const saved = await savedResponse.json();
  await expect(page.locator('.toast')).toContainText('сохранены');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.getByRole('button', { name: 'Войти в систему', exact: true }).click();
  await nav(page, 'История расчётов');
  const row = page.getByRole('row').filter({ hasText: saved.id.slice(0, 8) });
  await row.getByRole('button', { name: 'Воспроизвести', exact: false }).click();
  await expect(page.locator('.scenario-strip')).toContainText(name);
  const output = await exported(page, 'Экспорт');
  expect(output.result.seed).toBe(71);
  expect(output.result.metrics).toEqual(simulate(createDataset(), { ...BASE_SCENARIO, bayCount: 4 }, 71).metrics);
  expect(errors).toEqual([]);
});

test('changing parameters or seed marks the previous comparison stale and excludes it from current export', async ({ page }) => {
  await login(page); await nav(page, 'Сценарии');
  await page.getByRole('button', { name: '+ Один пост', exact: true }).click();
  await page.getByRole('button', { name: 'Сравнить 30 смен', exact: true }).click();
  const comparison = page.locator('.decision-comparison');
  await expect(comparison).toHaveAttribute('data-stale', 'false');
  await page.getByLabel('Активные посты налива', { exact: false }).fill('5');
  await expect(comparison).toHaveAttribute('data-stale', 'true');
  expect((await exported(page, 'Экспорт')).comparison).toBeNull();
  await page.getByRole('button', { name: 'Сравнить 30 смен', exact: true }).click();
  await expect(comparison).toHaveAttribute('data-stale', 'false');
  await page.getByLabel('Seed расчёта', { exact: false }).fill('72');
  await expect(comparison).toHaveAttribute('data-stale', 'true');
});

test('research finishes through the actual worker and retains the failed stress criterion', async ({ page }) => {
  await login(page); await nav(page, 'Исследование');
  await page.getByRole('button', { name: 'Исследовать варианты', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Кандидат для проверки', exact: true })).toBeVisible();
  await expect(page.locator('.recommendation-number')).toContainText('6');
  await expect(page.locator('.stress-grid')).toContainText('84,4');
  await expect(page.locator('.method-warning')).toContainText('ниже целевых 85%');
  const grid = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Сетка эксперимента', exact: true }) });
  await expect(grid.locator('tbody tr')).toHaveCount(48);
  await page.getByRole('button', { name: 'Применить и рассчитать', exact: false }).click();
  await expect(page.locator('.scenario-strip')).toContainText('Вариант из исследования');
  await expect(page.locator('.draft-banner')).toHaveCount(0);
});

test('four-step demonstration recalculates the scene, comparison and common outage', async ({ page }) => {
  await login(page);
  await page.getByRole('button', { name: 'Демонстрация', exact: true }).click();
  const route = page.getByRole('region', { name: 'Демонстрация решения', exact: true });
  for (const [step, label] of [['baseline', 'Базовая смена'], ['bottleneck', 'Причина очереди'], ['alternative', 'Изменение мощности'], ['outage', 'Проверка сбоя']] as Array<[DemoStep, string]>) {
    const button = route.getByRole('button', { name: new RegExp(label) });
    await button.click();
    await expect(button).toHaveAttribute('aria-current', 'step');
    const expected = runDemonstration(createDataset(), step);
    await expect.poll(async () => Number(await page.getByRole('slider', { name: 'Время смены' }).inputValue())).toBeCloseTo(expected.focusTime, 1);
    if (expected.comparison) {
      await expect(route.locator('.review-table').getByRole('row', { name: /Отгружено/ })).toContainText(number(expected.comparison.candidate.estimates.shippedTonnes.mean));
    }
  }
  await expect(route.locator('.review-scenarios')).toContainText('Базовая смена со сбоем');
  await expect(route.locator('.review-scenarios')).toContainText('Альтернатива со сбоем');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(route.getByRole('button', { name: /Проверка сбоя/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Демонстрация', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  await route.getByRole('button', { name: 'Закрыть демонстрацию', exact: true }).click();
  await expect(route).toHaveCount(0);
});

test('valid dataset round trip and rejected import preserve the selected data', async ({ page }) => {
  await login(page); await nav(page, 'Данные и модель');
  const data = await exported(page, 'Скачать JSON');
  expect(data).toEqual(createDataset());
  const name = `acceptance-${Date.now()}.json`;
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await expect(page.locator('.toast')).toContainText('Набор данных выбран');
  const select = page.getByLabel('Набор данных', { exact: false });
  const id = await select.inputValue(); expect(id).not.toBe(data.id);
  const imported = await exported(page, 'Скачать JSON'); expect(imported).toEqual({ ...data, id });
  const invalid = structuredClone(data); invalid.orders[0].tonnes = -1;
  await page.locator('input[type=file]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.locator('.toast.error')).toContainText('tonnes');
  await expect(select).toHaveValue(id);
  expect(await exported(page, 'Скачать JSON')).toEqual(imported);
});

test('viewer can compare but cannot save or import', async ({ page }) => {
  await login(page, true); await nav(page, 'Сценарии');
  await expect(page.getByRole('button', { name: 'Сохранить расчёт', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Сравнить 30 смен', exact: true }).click();
  await expect(page.locator('.decision-comparison')).toBeVisible();
  await nav(page, 'Данные и модель');
  await expect(page.getByRole('button', { name: 'Импорт JSON', exact: true })).toBeDisabled();
});

test('failed save leaves the calculated scenario available to retry', async ({ page }) => {
  await login(page); await nav(page, 'Сценарии');
  await page.route('**/api/calculations', route => route.abort('failed'));
  await page.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click();
  await expect(page.locator('.toast.error')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сохранить расчёт', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Название сценария', { exact: true })).toHaveValue(BASE_SCENARIO.name);
  await page.unroute('**/api/calculations');
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/calculations' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Сохранить расчёт', exact: true }).click();
  expect((await response).status()).toBe(201);
});
