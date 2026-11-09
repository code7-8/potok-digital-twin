import { test, expect, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { simulate } from '../lib/engine/simulation';
import { BASE_SCENARIO, createDataset } from '../lib/engine/fixtures';
import { createPlayback, truckPose } from '../lib/terminal/playback';

async function openTour(page: Page, webgl = true) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Войти в систему', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Войти в систему', exact: true }).click();
  await page.getByRole('button', { name: '3D-тур', exact: true }).click();
  await expect(page.locator('.terminal-loading')).toHaveCount(0);
  if (webgl) {
    await expect(page.locator('.terminal-fallback')).toHaveCount(0);
    await expect(page.locator('.terminal-canvas canvas')).toBeVisible();
    await page.getByLabel('Качество графики').selectOption('economy');
  }
}

const slider = (page: Page) => page.getByRole('slider', { name: 'Время смены' });
const modelTime = async (page: Page) => Number(await slider(page).inputValue());
async function seek(page: Page, time: number) {
  await slider(page).evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, String(value));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, time);
  await expect(slider(page)).toHaveValue(String(time));
}

test('playback, event stepping, pause, final KPI and repeat share one model clock', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await openTour(page);
  await expect(slider(page)).toHaveValue('120');
  await expect(page.locator('.terminal-metrics')).toContainText('14');
  await page.getByLabel('Следующее событие', { exact: true }).click();
  expect(await modelTime(page)).toBeGreaterThan(120);
  await page.getByLabel('Предыдущее событие', { exact: true }).click();
  expect(await modelTime(page)).toBeLessThan(125);
  await seek(page, 120);
  await page.getByLabel('Скорость воспроизведения').selectOption('12');
  await page.getByRole('button', { name: 'Воспроизвести смену', exact: true }).click();
  await expect.poll(() => modelTime(page)).toBeGreaterThan(122);
  await page.getByRole('button', { name: 'Приостановить', exact: true }).click();
  const frozen = await modelTime(page);
  await page.waitForTimeout(250);
  expect(await modelTime(page)).toBe(frozen);
  await seek(page, 719.9);
  await page.getByLabel('Скорость воспроизведения').selectOption('30');
  await page.getByRole('button', { name: 'Воспроизвести смену', exact: true }).click();
  await expect(slider(page)).toHaveValue('720');
  await expect(page.getByRole('button', { name: 'Воспроизвести смену', exact: true })).toBeVisible();
  expect((await page.locator('.terminal-metrics').innerText()).replace(/\s/g, '')).toContain('1123');
  await page.getByLabel('Повторять смену').click();
  await seek(page, 719.9);
  await page.getByRole('button', { name: 'Воспроизвести смену', exact: true }).click();
  await expect.poll(() => modelTime(page)).toBeLessThan(600);
  await page.getByRole('button', { name: 'Приостановить', exact: true }).click();
  expect(errors).toEqual([]);
});

test('real worker recalculates outages and capacity, with paused progress and current stock', async ({ page }) => {
  await openTour(page);
  await page.getByRole('button', { name: 'Сбой поста № 1', exact: true }).click();
  await expect(slider(page)).toHaveValue('250');
  await expect(page.locator('.bay-paused')).toHaveCount(1);
  await page.getByLabel('Выбрать объект', { exact: true }).selectOption('loading-1');
  await expect(page.locator('.terminal-alert')).toContainText('недоступен');
  const progress = page.locator('.terminal-object-details dd').last();
  const frozen = await progress.innerText();
  await seek(page, 300); await expect(progress).toHaveText(frozen);
  await seek(page, 361); await expect(progress).not.toHaveText(frozen);
  await page.getByLabel('Выбрать объект', { exact: true }).selectOption('T-D1');
  await expect(page.locator('.terminal-object-details')).toContainText('Нераспределённый');
  await page.getByRole('button', { name: '6 постов + 2 оформления', exact: true }).click();
  await expect(slider(page)).toHaveValue('120');
  await expect(page.locator('.bay-closed')).toHaveCount(0);
  await page.getByRole('button', { name: 'Базовая очередь', exact: true }).click();
  await expect(page.locator('.bay-closed')).toHaveCount(3);
  await page.getByRole('button', { name: 'Сценарии', exact: true }).click();
  await page.getByRole('button', { name: 'Сравнить 30 смен', exact: true }).click();
  await expect(page.locator('.comparison-row')).toHaveCount(4);
});

test('3D ray picking, follow camera, display controls and fullscreen work', async ({ page }) => {
  await openTour(page);
  for (const title of ['Налив · клавиша 2', 'Резервуары · клавиша 3', 'Въезд · клавиша 4', 'План · клавиша 5']) {
    await page.getByTitle(title).click(); await expect(page.getByTitle(title)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByLabel('Кровля эстакады', { exact: true }).click();
  await page.getByLabel('Подписи объектов', { exact: true }).click();
  const result = simulate(createDataset(), BASE_SCENARIO, 42), playback = createPlayback(result);
  const track = playback.tracks.find(t => t.order.id === 'TR-038')!;
  const pose = truckPose(track, 120, result), rect = (await page.locator('.terminal-canvas canvas').boundingBox())!;
  const camera = new PerspectiveCamera(42, rect.width / rect.height, .3, 1800);
  camera.zoom = Math.min(1, camera.aspect / 1.3); camera.updateProjectionMatrix();
  camera.position.set(0, 125 + Math.max(0, playback.parkingRows - 3) * 5, 8.1);
  camera.lookAt(0, 0, 8); camera.updateMatrixWorld();
  const point = new Vector3(pose.position[0], 2, pose.position[1]).project(camera);
  await page.mouse.click(rect.x + (point.x + 1) * rect.width / 2, rect.y + (1 - point.y) * rect.height / 2);
  await expect(page.locator('.terminal-object-title h3')).toHaveText('TR-038');
  await page.getByRole('button', { name: 'Следовать за машиной', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Камера следует за машиной' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByTitle('Обзор · клавиша 1').click();
  await expect(page.getByRole('button', { name: 'Следовать за машиной', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByLabel('Ночное освещение', { exact: true }).click();
  await expect(page.getByLabel('Дневное освещение', { exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Схема основного маршрута', { exact: true }).click();
  await expect(page.getByLabel('Схема основного маршрута', { exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('На весь экран', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.getByLabel('На весь экран', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});

test('tablet and phone layouts retain controls without horizontal overflow', async ({ page }) => {
  await openTour(page);
  for (const width of [1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel('Выбрать объект', { exact: true }).selectOption('gate');
    await expect(page.locator('.terminal-object-title h3')).toHaveText('Регистрация транспорта');
    await page.getByLabel('Снять выбор объекта', { exact: true }).click();
    await seek(page, 180);
  }
});

test('lost WebGL context recovers without losing model data', async ({ page }) => {
  await openTour(page);
  await page.locator('.terminal-canvas canvas').evaluate(element => {
    const gl = (element as HTMLCanvasElement).getContext('webgl2')!;
    gl.getExtension('WEBGL_lose_context')!.loseContext();
  });
  await expect(page.locator('.terminal-fallback')).toBeVisible();
  await page.getByLabel('Выбрать объект', { exact: true }).selectOption('lab');
  await expect(page.locator('.terminal-object-details')).toContainText('Партий выпущено');
  await page.getByRole('button', { name: 'Повторить загрузку 3D', exact: true }).click();
  await expect(page.locator('.terminal-fallback')).toHaveCount(0);
  await expect(slider(page)).toHaveValue('120');
});

test('without WebGL the accessible dispatcher and playback remain usable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type === 'webgl' || type === 'webgl2') return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await openTour(page, false);
  await expect(page.locator('.terminal-fallback')).toBeVisible();
  await page.getByLabel('Выбрать объект', { exact: true }).selectOption('lab');
  await expect(page.locator('.terminal-object-details')).toContainText('Партий выпущено');
  await seek(page, 720);
  expect((await page.locator('.terminal-metrics').innerText()).replace(/\s/g, '')).toContain('1123');
});
