import { BankState, InterestRateHedge } from '../domain/bankState';
import { SimulationConfig } from '../domain/config';
import { AssetProductType as A, LiabilityProductType as L, BalanceSheetSide as S, Currency, MaturityBucket } from '../domain/enums';

// Undesignated swaps at FVTPL. Flat current floating-rate projection and discounting
// are model valuation assumptions, not market quotes or full IFRS 13 calibration.
export const hedgeFairValue = (hedge: InterestRateHedge, floatingRate: number): number => {
  const rate = Math.max(-.99, floatingRate), r = rate / 12;
  const n = Math.max(0, hedge.monthsRemaining);
  const annuity = Math.abs(r) < 1e-10 ? n : (1 - (1 + r) ** -n) / r;
  const sign = hedge.direction === 'payFixedReceiveFloat' ? 1 : -1;
  return sign * hedge.notional * (rate - hedge.fixedRate) / 12 * annuity;
};
export const syncHedgeBalances = (state: BankState, config: SimulationConfig) => {
  for (const [productType, side, label, sign] of [[A.DerivativeAssets,S.Asset,'Derivative assets',1],[L.DerivativeLiabilities,S.Liability,'Derivative liabilities',-1]] as const) {
    const balance = state.financial.hedges.reduce((sum,h)=>sum+Math.max(0,(h.fairValue ?? 0)*sign),0);
    let item=state.financial.balanceSheet.items.find(i=>i.productType===productType);
    if (!item && (balance > 0 || state.financial.hedges.length > 0)) { item={productType,side,label,balance:0,interestRate:0,currency:Currency.GBP,maturityBucket:MaturityBucket.LessThan1Y,liquidityTag:config.liquidityTags[productType],encumbrance:{encumberedAmount:0}};state.financial.balanceSheet.items.push(item); }
    if(item)item.balance=balance;
  }
};
export const revalueHedges = (state: BankState, config: SimulationConfig) => {
  const beforeA=state.financial.balanceSheet.items.find(i=>i.productType===A.DerivativeAssets)?.balance ?? 0;
  const beforeL=state.financial.balanceSheet.items.find(i=>i.productType===L.DerivativeLiabilities)?.balance ?? 0;
  state.financial.hedges.forEach(h=>h.fairValue=hedgeFairValue(h,state.market.riskFreeShort));
  syncHedgeBalances(state,config);
  const assetDelta=(state.financial.balanceSheet.items.find(i=>i.productType===A.DerivativeAssets)?.balance ?? 0)-beforeA;
  const liabilityDelta=(state.financial.balanceSheet.items.find(i=>i.productType===L.DerivativeLiabilities)?.balance ?? 0)-beforeL;
  return { pnl:assetDelta-liabilityDelta, adjustments:{[A.DerivativeAssets]:-assetDelta,[L.DerivativeLiabilities]:-liabilityDelta} };
};

// Unmargined, spot-starting vanilla GBP swaps, one trade per netting set.
// PRA CCR 274/278/279b/279c/280a; leverage 429c fixes the PFE multiplier to one.
export const hedgeExposures = (state: BankState) => state.financial.hedges.reduce((sum,h) => {
  const maturity=Math.max(0,h.monthsRemaining/12);
  if(maturity===0)return sum;
  const adjustedNotional=Math.max(0,h.notional)*(1-Math.exp(-.05*maturity))/.05;
  const addOn=adjustedNotional*.005*Math.sqrt(Math.min(1,Math.max(10/250,maturity)));
  const value=h.fairValue ?? hedgeFairValue(h,state.market.riskFreeShort);
  const replacement=Math.max(0,value);
  const multiplier=addOn>0?Math.min(1,.05+.95*Math.exp(Math.min(0,value/(1.9*addOn)))):1;
  return {credit:sum.credit+1.4*(replacement+multiplier*addOn),leverage:sum.leverage+1.4*(replacement+addOn)};
},{credit:0,leverage:0});
