from pathlib import Path

p=Path('src/App.tsx')
s=p.read_text()
old="""      capitalMarketsInstrument: 'none',
      capitalMarketsTargetAmount: '',
      dividendPayoutRatio:"""
new="""      capitalMarketsInstrument: 'none',
      capitalMarketsTargetAmount: '',
      capitalMarketsMaxDiscount: '15%',
      capitalMarketsMaxSpreadBps: '1000',
      capitalMarketsTenorMonths: '60',
      dividendPayoutRatio:"""
assert old in s
p.write_text(s.replace(old,new,1))

p=Path('src/components/ActionsPanel.tsx')
s=p.read_text()
old="""field=\"capitalMarketsMaxDiscount\" label=\"Maximum acceptable discount\" hint=\"The deal fails rather than price below this limit.\" state={state} update={update} disabled={disabled||instrument==='none'}"""
new="""field=\"capitalMarketsMaxDiscount\" label=\"Maximum acceptable discount\" hint=\"The deal fails rather than price below this limit.\" state={state} update={update} disabled={disabled}"""
assert old in s
p.write_text(s.replace(old,new,1))
