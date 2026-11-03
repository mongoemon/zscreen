'use strict';

// node:test reporter that writes every test as an Allure result (allure-results/<uuid>-result.json),
// grouped by test file and describe() block, for the single-file Allure report built in CI.
// Usage: node --test --test-reporter=./scripts/allure-reporter.js --test-reporter-destination=stdout
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const OUT_DIR = process.env.ALLURE_RESULTS_DIR || 'allure-results';

const statusOf = (type, data) => {
  if (data.skip !== undefined || data.todo !== undefined) return 'skipped';
  return type === 'test:pass' ? 'passed' : 'failed';
};

/** The assertion / thrown error behind a failure (node:test wraps it in ERR_TEST_FAILURE). */
function statusDetails(error) {
  if (!error) return {};
  const cause = error.cause || error;
  return { message: String(cause.message || cause), trace: cause.stack || '' };
}

function writeResult(type, data, parents) {
  const file = data.file ? path.relative(process.cwd(), data.file) : 'unknown';
  const fullName = [file, ...parents, data.name].join(' › ');
  const stop = Date.now();
  const labels = [
    { name: 'suite', value: file },
    { name: 'framework', value: 'node:test' },
    { name: 'language', value: 'javascript' },
  ];
  if (parents.length) labels.push({ name: 'subSuite', value: parents.join(' › ') });
  const uuid = randomUUID();
  const result = {
    uuid,
    historyId: createHash('md5').update(fullName).digest('hex'),
    name: data.name,
    fullName,
    status: statusOf(type, data),
    statusDetails: statusDetails(data.details.error),
    stage: 'finished',
    start: stop - Math.round(data.details.duration_ms || 0),
    stop,
    labels,
    steps: [],
    attachments: [],
    parameters: [],
  };
  fs.writeFileSync(path.join(OUT_DIR, `${uuid}-result.json`), JSON.stringify(result));
}

module.exports = async function* allureReporter(source) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  /** test file -> names of the running tests by nesting level, to know each test's describe() blocks */
  const stacks = new Map();
  let count = 0;
  for await (const { type, data } of source) {
    if (type === 'test:start') {
      const stack = stacks.get(data.file) || [];
      stack.length = data.nesting;
      stack[data.nesting] = data.name;
      stacks.set(data.file, stack);
    } else if (type === 'test:pass' || type === 'test:fail') {
      // describe() blocks report too; only real tests become results (and never the file itself)
      if (data.details.type === 'suite' || data.name === data.file) continue;
      const parents = (stacks.get(data.file) || []).slice(0, data.nesting).filter((n) => n && n !== data.file);
      writeResult(type, data, parents);
      count += 1;
    }
  }
  yield `allure: ${count} test results written to ${OUT_DIR}/\n`;
};
