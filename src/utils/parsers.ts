export interface ParsedInput {
  value: number | undefined;
  error?: string;
}

const clean = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/£/g, '')
    .replace(/gbp/g, '');

const parseNumericToken = (token: string): number | null => {
  const n = Number(token);
  if (!Number.isFinite(n)) return null;
  return n;
};

export const parseRateInput = (raw: string): ParsedInput => {
  const text = clean(raw);
  if (!text) return { value: undefined };

  let value: number | null = null;
  if (text.endsWith('bps')) {
    value = parseNumericToken(text.slice(0, -3));
    if (value !== null) value /= 10000;
  } else if (text.endsWith('%')) {
    value = parseNumericToken(text.slice(0, -1));
    if (value !== null) value /= 100;
  } else if (text.endsWith('pct')) {
    value = parseNumericToken(text.slice(0, -3));
    if (value !== null) value /= 100;
  } else {
    value = parseNumericToken(text);
    if (value !== null && value > 1 && value <= 100) {
      // Ergonomic input: "2.5" means 2.5%.
      value /= 100;
    }
  }

  if (value === null) {
    return { value: undefined, error: 'Invalid rate format' };
  }
  if (value < 0) {
    return { value: undefined, error: 'Rate cannot be negative' };
  }
  if (value > 1) {
    return { value: undefined, error: 'Rate must be <= 100%' };
  }
  return { value };
};

export const parseMoneyInput = (raw: string): ParsedInput => {
  const text = clean(raw);
  if (!text) return { value: undefined };

  let multiplier = 1;
  let token = text;
  if (text.endsWith('bn')) {
    multiplier = 1e9;
    token = text.slice(0, -2);
  } else if (text.endsWith('m')) {
    multiplier = 1e6;
    token = text.slice(0, -1);
  } else if (text.endsWith('k')) {
    multiplier = 1e3;
    token = text.slice(0, -1);
  }

  const parsed = parseNumericToken(token);
  if (parsed === null) {
    return { value: undefined, error: 'Invalid amount format' };
  }

  const value = parsed * multiplier;
  if (value < 0) {
    return { value: undefined, error: 'Amount cannot be negative' };
  }
  return { value };
};
