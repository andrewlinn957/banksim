import { EvaluationStore } from './store';
import { createBankSimServer, serverBuildInfo } from './app';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const databasePath = process.env.BANKSIM_DATABASE_PATH?.trim() || './data/banksim.sqlite3';
mkdirSync(dirname(resolve(databasePath)), { recursive: true, mode: 0o700 });
const adminToken = required('BANKSIM_ADMIN_TOKEN');
const engineVersion = required('BANKSIM_ENGINE_VERSION');
const build = serverBuildInfo();
const store = new EvaluationStore(databasePath);

const app = await createBankSimServer({
  store,
  adminToken,
  engineVersion,
  buildDigest: process.env.BANKSIM_BUILD_DIGEST?.trim() || build.buildDigest,
  dependencyLockHash: build.lockfileHash,
  scenarioVersion: process.env.BANKSIM_SCENARIO_VERSION?.trim() || 'public-catalogue-v1',
  maxAdvanceMonths: Number(process.env.BANKSIM_MAX_ADVANCE_MONTHS || 12),
  maxHorizonMonths: Number(process.env.BANKSIM_MAX_HORIZON_MONTHS || 120),
  requestRateLimitMax: Number(process.env.BANKSIM_REQUEST_RATE_LIMIT || 120),
  host: process.env.BANKSIM_HOST?.trim() || '127.0.0.1',
});

await app.listen({ host: process.env.BANKSIM_HOST?.trim() || '127.0.0.1', port: Number(process.env.BANKSIM_PORT || 3000) });

let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await app.close();
  store.close();
};

process.once('SIGINT', () => { void close().then(() => process.exit(0)); });
process.once('SIGTERM', () => { void close().then(() => process.exit(0)); });
