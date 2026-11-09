import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { verifyJoinedAuditBundle, type JoinedAuditBundle } from '../server/auditBundle';

const inputArg = process.argv[2];
if (!inputArg) throw new Error('Usage: npm run audit:verify -- <joined-audit.json|joined-audit.json.gz>');
const inputPath = resolve(inputArg);
const bytes = readFileSync(inputPath);
const jsonBytes = extname(inputPath) === '.gz' ? gunzipSync(bytes) : bytes;
let bundle: JoinedAuditBundle;
try { bundle = JSON.parse(jsonBytes.toString('utf8')) as JoinedAuditBundle; }
catch { throw new Error('Audit bundle is not valid JSON'); }
const verification = verifyJoinedAuditBundle(bundle);
process.stdout.write(`${JSON.stringify({ inputPath, ...verification }, null, 2)}\n`);
if (!verification.verified) process.exitCode = 2;
