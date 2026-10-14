import fs from 'node:fs';
import path from 'node:path';

export function validateProductionReport(report) {
  const errors = [];
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return { valid: false, errors: ['Production QA report must be a JSON object.'] };
  }
  if (report.verified !== true) errors.push('Render output has not been verified.');
  for (const section of ['productionQA', 'creativeQA']) {
    if (!report[section] || typeof report[section].pass !== 'boolean') {
      errors.push(`Report must contain a ${section} pass/fail result.`);
    } else if (!report[section].pass) {
      errors.push(`${section} did not pass.`);
    }
  }
  return { valid: errors.length === 0, errors };
}

if (process.argv[1] && path.basename(process.argv[1]) === 'validate-production.mjs') {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error('Usage: npm run qa:validate -- <production-qa.json>');
    process.exit(1);
  }

  try {
    const report = JSON.parse(fs.readFileSync(path.resolve(reportPath), 'utf8'));
    const result = validateProductionReport(report);
    if (!result.valid) {
      console.error(`Production QA failed:\n- ${result.errors.join('\n- ')}`);
      process.exitCode = 1;
    } else {
      console.log('Production QA and Creative QA passed.');
      console.log(JSON.stringify({
        productionQA: report.productionQA,
        creativeQA: report.creativeQA,
      }, null, 2));
    }
  } catch (error) {
    console.error(`Could not validate production QA report: ${error.message}`);
    process.exitCode = 1;
  }
}
