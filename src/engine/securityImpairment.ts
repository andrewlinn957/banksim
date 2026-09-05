import { BankState } from '../domain/bankState';
import { BalanceSheetItem } from '../domain/balanceSheet';
import { SimulationConfig } from '../domain/config';

// The supported gilt book uses the IFRS 9 low-credit-risk Stage 1 assumption.
export const securityEcl = (item: BalanceSheetItem, config: SimulationConfig) => {
  const security=item.security;
  if(!security || security.classification==='FVTPL')return 0;
  const p=config.productParameters[item.productType];
  const gross=Math.max(0,security.amortisedCost ?? item.balance);
  const scenarios=config.behaviour.ifrs9?.eclScenarios ?? [{weight:1,pdMultiplier:1}];
  const weights=scenarios.reduce((s,x)=>s+Math.max(0,x.weight),0);
  if(weights<=0)return 0;
  return scenarios.reduce((sum,x)=>{
    const pd=1-(1-Math.min(1,Math.max(0,(p?.baseDefaultRate ?? 0)*x.pdMultiplier)))**(1/12);
    let survival=1,loss=0;
    for(let month=1;month<=12;month++){loss+=gross*survival*pd*(p?.lossGivenDefault ?? 0)/(1+Math.max(0,item.interestRate)/12)**month;survival*=1-pd;}
    return sum+loss*Math.max(0,x.weight)/weights;
  },0);
};
export const recogniseSecurityImpairment = (state: BankState, config: SimulationConfig) => {
  let expense=0,oci=0;
  const adjustments: Record<string,number>={};
  for(const item of state.financial.balanceSheet.items){
    const s=item.security;if(!s)continue;
    s.amortisedCost ??= item.balance;
    const target=securityEcl(item,config),delta=target-(s.lossAllowance ?? 0);
    s.lossAllowance=target;expense+=delta;
    if(s.classification==='FVOCI')oci+=delta;
    else if(s.classification==='HTM'){item.balance-=delta;adjustments[item.productType]=delta;}
  }
  return {expense,oci,adjustments};
};
