import { expect, test, type Page } from '@playwright/test';

const readExport = async (page: Page) => {
  await page.getByRole('button', { name: 'Export run', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied JSON', exact: true })).toBeVisible();
  return page.evaluate(() => JSON.parse((window as unknown as { exportedRun: string }).exportedRun));
};

test('export distinguishes earnings bases and reconciles opening capital and common book value', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { (window as unknown as { exportedRun: string }).exportedRun = text; } },
    });
  });
  await page.goto('/');
  const opening = await readExport(page);
  expect(opening.formatVersion).toBe(6);
  expect(opening.run.opening.share.ttmEps).toBeNull();
  expect(opening.run.opening.share.smoothedAnnualisedEps).toBeGreaterThan(0);
  expect(opening.run.series.keys.smoothedAnnualisedEps).toContain('smoothed annualised');
  expect(opening.run.series.keys).not.toHaveProperty('eps');
  const capital = opening.run.opening.capitalReconciliation;
  expect(capital.capitalM.regulatoryCet1 / capital.capitalM.rwa * 100).toBeCloseTo(capital.reportedCet1Pct, 3);
  expect(capital.book.commonBookEquityM / capital.book.sharesM).toBeCloseTo(capital.book.reportedBvps, 4);
  expect(opening.run.opening.share.price / capital.book.calculatedBvps).toBeCloseTo(capital.book.reportedPb, 3);

  await page.getByText('Settings', { exact: true }).click();
  await page.locator('.settings-menu label').filter({ hasText: /^Speed/ }).locator('select').selectOption('450');
  await page.getByLabel('Pause when buffers need attention').uncheck();
  await page.getByText('Settings', { exact: true }).click();
  await page.getByLabel('Advance time').selectOption('month');
  for (let month = 0; month < 12; month += 1) {
    const previousDate = await page.locator('.clock-date').textContent();
    await page.getByRole('button', { name: '▶ Run', exact: true }).click();
    await expect(page.locator('.clock-date')).not.toHaveText(previousDate!);
    await expect(page.getByRole('button', { name: '▶ Run', exact: true })).toBeEnabled();
  }
  const completed = await readExport(page);
  const series = completed.run.series.values;
  expect(series.ttmMonths.at(-1)).toBe(12);
  expect(series.ttmEps.slice(0, 12)).toEqual(Array(12).fill(null));
  const commonProfitM = series.netProfit.slice(1).reduce((sum: number, profit: number, i: number) => sum + profit - series.at1Coupons[i + 1], 0);
  expect(series.ttmEps.at(-1)).toBeCloseTo(commonProfitM / capital.book.sharesM, 3);
  expect(series.quotedPeSmoothed.at(-1)).toBeCloseTo(series.sharePrice.at(-1) / series.smoothedAnnualisedEps.at(-1), 2);
  if (series.ttmEps.at(-1) > 0) {
    expect(series.quotedPeTtm.at(-1)).toBeCloseTo(series.sharePrice.at(-1) / series.ttmEps.at(-1), 2);
  }
  await page.getByLabel('Finance & Capital screens', { exact: true }).click();
  await page.locator('.area-jump-menu[open]').getByRole('button', { name: 'Share price', exact: true }).click();
  for (const label of ['Smoothed annualised EPS', 'TTM EPS', 'Model P/E', 'Quoted P/E (smoothed)', 'Quoted P/E (TTM)']) {
    await expect(page.locator('.metric-label').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })).toBeVisible();
  }
  await expect(page.getByText('TTM proxy')).toHaveCount(0);
});
