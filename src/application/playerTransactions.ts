import type { PlayerAction } from '../domain/actions';
import { getCapitalMarketsInstrument } from '../capitalMarkets/catalogue';
import { formatCurrency } from '../utils/formatters';

export type PlayerOneOffTransactionAction = Extract<PlayerAction, {
  type: 'buySellAsset' | 'launchCapitalMarketsTransaction' | 'drawBoeFunding' | 'enterHedge'
}>;

export type PlayerTransactionKind = 'capitalMarkets' | 'giltTrade' | 'boeFunding' | 'hedge';

export interface QueuedPlayerTransaction {
  id: number;
  action: PlayerOneOffTransactionAction;
}

export interface QueuedPlayerTransactionSummary {
  id: number;
  kind: PlayerTransactionKind;
  label: string;
}

export const isPlayerOneOffTransactionAction = (action: PlayerAction): action is PlayerOneOffTransactionAction =>
  action.type === 'buySellAsset' || action.type === 'launchCapitalMarketsTransaction' ||
  action.type === 'drawBoeFunding' || action.type === 'enterHedge';

export const playerTransactionKindForAction = (action: PlayerOneOffTransactionAction): PlayerTransactionKind => {
  switch (action.type) {
    case 'buySellAsset': return 'giltTrade';
    case 'launchCapitalMarketsTransaction': return 'capitalMarkets';
    case 'drawBoeFunding': return 'boeFunding';
    case 'enterHedge': return 'hedge';
  }
};

export const playerTransactionLabel = (action: PlayerOneOffTransactionAction): string => {
  switch (action.type) {
    case 'buySellAsset': return `${action.amountDelta > 0 ? 'Buy' : 'Sell'} gilts · ${formatCurrency(Math.abs(action.amountDelta))}`;
    case 'launchCapitalMarketsTransaction': return `${getCapitalMarketsInstrument(action.instrument).label} · ${formatCurrency(action.targetAmount)}`;
    case 'drawBoeFunding': return `${action.facility} drawing · ${formatCurrency(action.amount)}`;
    case 'enterHedge': return `${action.direction === 'payFixedReceiveFloat' ? 'Pay fixed' : 'Receive fixed'} swap · ${formatCurrency(action.notional)}`;
  }
};

export const summarizeQueuedPlayerTransactions = (
  transactions: readonly QueuedPlayerTransaction[],
): QueuedPlayerTransactionSummary[] => transactions.map(({ id, action }) => ({
  id,
  kind: playerTransactionKindForAction(action),
  label: playerTransactionLabel(action),
}));
