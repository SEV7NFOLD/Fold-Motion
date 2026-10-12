import { getHealthReport } from '../src/runtime/health.mjs';

const report = await getHealthReport();

for (const check of report.checks) {
  const status = check.ok ? 'PASS' : 'FAIL';
  console.log(`${status.padEnd(4)} ${check.name}: ${check.detail}`);
}

if (!report.ok) {
  process.exitCode = 1;
}
