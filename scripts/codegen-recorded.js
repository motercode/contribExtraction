import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://consent.google.com/m?continue=https://www.google.com/maps/contrib/102214896434264755474/photos&gl=ES&m=0&pc=m&uxe=eomtm&cm=2&hl=es&src=1');
  await page.getByRole('button', { name: 'Rechazar todo' }).click();
  await page.goto('https://www.google.com/maps/contrib/102214896434264755474/photos/@40.4259427,-3.6110336,15z/data=!4m3!8m2!3m1!1e1?entry=ttu&g_ep=EgoyMDI2MTAxMi4wIKXMDSoASAFQAw%3D%3D');
  await page.getByRole('button', { name: 'Foto 1 de' }).first().click();
  await page.getByRole('button', { name: 'Foto 1 de' }).nth(1).click();
  await page.getByRole('button', { name: 'Foto 1 de' }).nth(2).click();
  await page.getByRole('button', { name: 'Foto 1 de' }).nth(3).click();
  await page.getByRole('button', { name: 'Foto 1 de' }).nth(4).click();
  await page.getByRole('button', { name: 'Foto 1 de' }).nth(5).click();
  await page.locator('div:nth-child(7) > .EGN8xd > .WY21Hc > .xUc6Hf').click();
  await page.locator('div:nth-child(8) > .EGN8xd > .WY21Hc > .xUc6Hf').click();
  await page.locator('div:nth-child(8) > .EGN8xd > .WY21Hc > .xUc6Hf').click();
  await page.locator('div:nth-child(9) > .EGN8xd > .WY21Hc > .xUc6Hf').click();
  await page.getByRole('main', { name: 'Contribuciones de motercode' }).getByRole('button', { name: 'Cerrar' }).click();
  await page.locator('div:nth-child(10) > .EGN8xd > .WY21Hc > .xUc6Hf').dblclick();
  await page.getByRole('application', { name: 'Street View' }).click({
    clickCount: 3
  });
  await page.locator('canvas').nth(2).click({
    position: {
      x: 1009,
      y: 314
    }
  });
});