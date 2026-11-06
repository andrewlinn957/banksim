import { expect, test } from '@playwright/test';

const profiles = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

for (const profile of profiles) {
  test.describe(`credit losses · ${profile.name}`, () => {
    test.use({ viewport: { width: profile.width, height: profile.height } });

    test('opens from Lending and distinguishes expected from realised losses', async ({ page }) => {
      await page.goto('/');
      const areas = page.getByRole('navigation', { name: 'Bank areas' });
      await areas.getByRole('button', { name: 'Lending', exact: true }).click();
      await areas.locator('summary[aria-label="Lending screens"]').click();
      await areas.getByRole('button', { name: 'Credit losses', exact: true }).click();

      await expect(page.getByRole('heading', { name: 'Credit losses' })).toBeVisible();
      await expect(page.getByText('No significant increase in risk', { exact: true })).toBeVisible();
      await expect(page.getByText('Credit risk has increased significantly', { exact: true })).toBeVisible();
      await expect(page.getByText('Credit-impaired', { exact: true })).toBeVisible();
      await expect(page.getByText('Provision charge · latest P&L flow', { exact: true })).toBeVisible();
      await expect(page.getByText('Workout losses realised · latest close', { exact: true })).toBeVisible();
      await expect(page.getByText('Run one month to start the allowance and loss history.', { exact: true })).toBeVisible();

      const layout = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(layout.scrollWidth, `${profile.name} page overflows: ${JSON.stringify(layout)}`).toBeLessThanOrEqual(layout.clientWidth + 1);
    });
  });
}
