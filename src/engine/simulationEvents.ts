export type EventSeverity = 'info' | 'warning' | 'error';

export interface SimulationEvent {
  id: string;
  severity: EventSeverity;
  message: string;
  timestamp: number;
  tags?: string[];
}

let eventSequence = 0;

const EVENT_TAG_RULES: Array<{ tag: string; pattern: RegExp }> = [
  { tag: 'capital', pattern: /\bcet1|at1|capital|equity|dividend|coupon|mda|oci\b/i },
  { tag: 'liquidity', pattern: /\blcr|nsfr|hqla|outflow|inflow|liquidity|run\b/i },
  { tag: 'funding', pattern: /\bfunding|rollover|debt|repo|maturity\b/i },
  { tag: 'deposits', pattern: /\bdeposit|withdrawal|churn|franchise\b/i },
  { tag: 'loans', pattern: /\bloan|mortgage|pipeline|underwriting|drawdown|origination\b/i },
  { tag: 'credit', pattern: /\bdefault|pd|lgd|impairment|provision|loss\b/i },
  { tag: 'conduct', pattern: /\bconduct|consumer duty|duty|fine|remediation\b/i },
  { tag: 'income', pattern: /\bp&l|profit|income|expense|cost|tax\b/i },
  { tag: 'market', pattern: /\bspread|rate|curve|macro|shock|gilt\b/i },
  { tag: 'hedges', pattern: /\bhedge|irrbb|duration|eve|nii\b/i },
];

const inferEventTags = (message: string, explicitTags: string[] = []): string[] => {
  const deduped = new Set<string>(explicitTags.map((tag) => tag.toLowerCase()));
  EVENT_TAG_RULES.forEach(({ tag, pattern }) => {
    if (pattern.test(message)) deduped.add(tag);
  });
  return [...deduped];
};

export const createSimulationEvent = (
  severity: EventSeverity,
  message: string,
  tags: string[] = []
): SimulationEvent => {
  const timestamp = Date.now();
  const id = `evt-${timestamp}-${eventSequence++}`;
  return {
    id,
    severity,
    message,
    timestamp,
    tags: inferEventTags(message, tags),
  };
};
