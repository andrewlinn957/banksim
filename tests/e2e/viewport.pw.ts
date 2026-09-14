import { expect, test, type Page } from '@playwright/test';

// Representative viewport coverage for management and prudential surfaces.
const profiles = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'narrow', width: 390, height: 844 },
] as const;

const expectNoDocumentOverflow = async (page: Page, context: string) => {
  const layout = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          classes: element.className?.toString().slice(0, 120) ?? '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((item) => item.right > clientWidth + 1 || item.left < -1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 8);
    return { clientWidth, scrollWidth, offenders };
  });
  expect(
    layout.scrollWidth,
    `${context}: viewport ${layout.clientWidth}px, document ${layout.scrollWidth}px; offenders ${JSON.stringify(layout.offenders)}`
  ).toBeLessThanOrEqual(layout.clientWidth + 1);
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
      await expectNoDocumentOverflow(page, 'Treasury workspace');
    });

    test('finance report shortcuts sit directly below the time controls', async ({ page }) => {
      await page.goto('/');
      await page
        .getByRole('navigation', { name: 'Bank areas' })
        .getByRole('button', { name: 'Finance & Capital', exact: true })
        .click();

      const reports = page.getByRole('navigation', { name: 'Finance & Capital reports' });
      await expect(reports).toBeVisible();
      await expect(reports).toContainText('Open the detailed view when you need it.');
      await expect(reports.getByRole('button', { name: 'Performance', exact: false })).toBeVisible();
      await expect(reports.getByRole('button', { name: 'Accounts', exact: false })).toBeVisible();
      await expect(reports.getByRole('button', { name: 'Share price', exact: false })).toBeVisible();
      await expect(reports.getByRole('button', { name: 'Costs', exact: false })).toBeVisible();
      await expect(reports.evaluate((element) => element.previousElementSibling?.matches('.time-console'))).resolves.toBe(true);
      await expect(page.locator('.department-workspace')).not.toContainText('Open the detailed view when you need it.');
      await expectNoDocumentOverflow(page, 'Finance report shortcuts');
    });

    test('event log and reconciliations stay behind the Game menu', async ({ page }) => {
      await page.goto('/');
      await page.getByLabel('Advance time').selectOption('month');
      await page.getByRole('button', { name: 'Run', exact: false }).click();
      await expect(page.locator('.post-close-links')).toHaveCount(1);
      await expect(page.locator('.post-close-links')).toBeHidden();

      await page.getByText('Game', { exact: true }).click();
      const menu = page.locator('.settings-menu');
      await expect(menu.getByRole('button', { name: 'Event log', exact: true })).toBeVisible();
      await expect(menu.getByRole('button', { name: 'Reconciliations', exact: true })).toBeVisible();
      await expectNoDocumentOverflow(page, 'Game menu close-review links');
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
        await expectNoDocumentOverflow(page, dashboard.label);
      }
    });
  });
}
