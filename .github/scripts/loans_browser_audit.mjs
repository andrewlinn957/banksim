import { chromium } from 'playwright-core';

const executablePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ').trim();

await page.goto('http://127.0.0.1:4173/banksim/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Loans', exact: true }).click();
await page.getByRole('heading', { name: 'Loans', exact: true }).waitFor();

const portfolioTabs = page.getByRole('tablist', { name: 'Loan portfolio selector' });
const expectedTabs = ['Residential mortgages', 'Personal loans & revolving credit', 'SME & business lending'];
for (const name of expectedTabs) assert(await portfolioTabs.getByRole('tab', { name, exact: true }).count() === 1, `Missing selector: ${name}`);

const auditPortfolio = async (name, requiredSector, forbiddenSectors) => {
  await portfolioTabs.getByRole('tab', { name, exact: true }).click();
  const heading = page.getByRole('heading', { name: `Cohort breakdown — ${name}`, exact: true });
  await heading.waitFor();
  const cohortSection = heading.locator('xpath=..').locator('xpath=..');
  const sectionText = await text(cohortSection);
  assert(sectionText.includes(requiredSector), `${name}: expected sector ${requiredSector}`);
  for (const forbidden of forbiddenSectors) assert(!sectionText.includes(forbidden), `${name}: unexpected sector ${forbidden}`);
};

await auditPortfolio('Residential mortgages', 'Residential mortgage', ['Consumer', 'SME', 'Large corporate', 'Commercial real estate']);
await auditPortfolio('Personal loans & revolving credit', 'Consumer', ['Residential mortgage', 'SME', 'Large corporate', 'Commercial real estate']);
await auditPortfolio('SME & business lending', 'SME', ['Consumer', 'Residential mortgage']);

const body = await text(page.locator('body'));
for (const label of ['Net loans', 'Net carrying amount', 'Offer rate', 'Maturity bucket', 'Approved, not yet drawn', 'Performing cohort exposure', 'Largest sector share', 'Largest geography share', 'WA workout lag', 'Current PD', 'Current LGD']) {
  assert(body.includes(label), `Missing audited Loans label: ${label}`);
}
assert(!body.includes('Green safer') && !body.includes('Amber middle') && !body.includes('Red riskier'), 'Arbitrary cohort RAG legend remains');
assert(!body.includes('ThreeToFiveY') && !body.includes('GreaterThan5Y'), 'Raw maturity enum leaked into UI');

// Product-level opening maturity buckets must align with configured representative terms.
const loanTable = page.locator('table').first();
const tableText = await text(loanTable);
assert(tableText.includes('Personal Loans & Revolving Credit') && tableText.includes('3–5 years'), 'Personal credit maturity bucket is not 3–5 years');
assert(tableText.includes('SME & Business Lending') && tableText.includes('>5 years'), 'SME/business maturity bucket is not >5 years');

console.log('Loans browser audit passed for all three portfolio selectors.');
await browser.close();
