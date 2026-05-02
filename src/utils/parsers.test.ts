import { describe, expect, it } from 'vitest';
import { parseMoneyInput, parseRateInput } from './parsers';

describe('Input parsers', () => {
  it('parses rates in decimal, percent, and bps formats', () => {
    expect(parseRateInput('0.025').value).toBeCloseTo(0.025, 12);
    expect(parseRateInput('2.5%').value).toBeCloseTo(0.025, 12);
    expect(parseRateInput('250bps').value).toBeCloseTo(0.025, 12);
    expect(parseRateInput('2.5').value).toBeCloseTo(0.025, 12);
  });

  it('parses money with scale suffixes and symbols', () => {
    expect(parseMoneyInput('10bn').value).toBeCloseTo(10e9, 6);
    expect(parseMoneyInput('500m').value).toBeCloseTo(500e6, 6);
    expect(parseMoneyInput('25k').value).toBeCloseTo(25e3, 6);
    expect(parseMoneyInput('£1,250,000').value).toBeCloseTo(1_250_000, 6);
    expect(parseMoneyInput('GBP 1.5bn').value).toBeCloseTo(1.5e9, 6);
  });

  it('returns errors for invalid or disallowed inputs', () => {
    expect(parseRateInput('-1%').error).toBeTruthy();
    expect(parseRateInput('abc').error).toBeTruthy();
    expect(parseMoneyInput('-5m').error).toBeTruthy();
    expect(parseMoneyInput('xyz').error).toBeTruthy();
  });
});
