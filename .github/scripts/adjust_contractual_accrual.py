from pathlib import Path

path = Path('src/engine/simulation.ts')
text = path.read_text()
old = """    const contractualNotional = buckets.reduce(
      (bucketSum, bucket) => bucketSum + Math.max(0, bucket.notional),
      0
    );
    const contractualExpense = buckets.reduce(
      (bucketSum, bucket) =>
        bucketSum + Math.max(0, bucket.notional) * Math.max(0, bucket.rate) * dtYears,
      0
    );
    const unbucketedBalance = Math.max(0, liability.balance - contractualNotional);

    return sum + contractualExpense + unbucketedBalance * liability.interestRate * dtYears;"""
new = """    const contractualNotional = buckets.reduce(
      (bucketSum, bucket) => bucketSum + Math.max(0, bucket.notional),
      0
    );
    const fundedBalance = Math.max(0, liability.balance);
    const coveredNotional = Math.min(fundedBalance, contractualNotional);
    const contractualScale = contractualNotional > 0 ? coveredNotional / contractualNotional : 0;
    const contractualExpense = buckets.reduce(
      (bucketSum, bucket) =>
        bucketSum +
        Math.max(0, bucket.notional) * contractualScale * Math.max(0, bucket.rate) * dtYears,
      0
    );
    const unbucketedBalance = Math.max(0, fundedBalance - coveredNotional);

    return sum + contractualExpense + unbucketedBalance * liability.interestRate * dtYears;"""
if old not in text:
    raise SystemExit('contractual accrual block not found')
path.write_text(text.replace(old, new, 1))
