import { expect, test, type Page } from '@playwright/test';

const profiles = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'narrow', width: 390, height: 844 },
] as const;

const expectNoDocumentOverflow = async (page: Page) => {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
};

for (const profile of profiles) {
  test.describe(profile.name, () => {
    test.use({ viewport: { width: profile.width, height: profile.height } });

    test('management workspace remains usable', async ({ page }) => {
      await page.goto('/');
      await page
        .getByRole('navigation', { name: 'Bank areas' })
        .getByRole('button', { name: 'Treasury & Funding', exact: true })
        .click();
      await expect(page.locator('.department-workspace')).toBeVisible();
      await expect(page.locator('.department-workspace')).toContainText('Treasury');
      await expectNoDocumentOverflow(page);
    });

    test('capital and liquidity dashboards render without page overflow', async ({ page }) => {
      await page.goto('/');
      await page
        .getByRole('navigation', { name: 'Bank areas' })
        .getByRole('button', { name: 'Risk & Regulatory', exact: true })
        .click();
      await expect(page.locator('.regulatory-detail')).toBeVisible();

      const dashboards = [
        { label: 'Capital', selector: '.capital-dashboard' },
        { label: 'Liquidity coverage', selector: '.lcr-dashboard' },
        { label: 'Stable funding', selector: '.nsfr-dashboard' },
        { label: 'Leverage', selector: '.leverage-dashboard' },
      ] as const;

      for (const dashboard of dashboards) {
        await page.locator('.metric-switch').getByRole('button', { name: dashboard.label, exact: true }).click();
        await expect(page.locator(dashboard.selector)).toBeVisible();
        await expectNoDocumentOverflow(page);
      }
    });
  });
}
