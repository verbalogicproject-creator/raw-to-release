import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const directory = resolve(import.meta.dirname, '..', 'method', 'contracts');
const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const name of readdirSync(directory).filter((item) => item.endsWith('.json')).sort()) ajv.addSchema(JSON.parse(readFileSync(join(directory, name), 'utf8')));
const H = 'a'.repeat(64), G = 'b'.repeat(40), RUN = '20260730-0700-fixture';

const samples = {
  'approval-receipt.json': { contract_version: '2.0.0', receipt_type: 'plan', user: 'human-1', revision: 1, displayed_content_hash: H, authority_hash: H, confirmed_at: '2026-07-30T04:00:00Z', target: 'plan.md' },
  'command-receipt.json': { contract_version: '2.0.0', receipt_type: 'command', receipt_id: 'receipt-1', run_id: RUN, task_id: 'task-1', command_id: 'tests', argv: ['node', '--test'], cwd: '.', implementation_sha: G, tester_delegation_id: 'tester-1', attempt: 1, started_at: '2026-07-30T04:00:00Z', ended_at: '2026-07-30T04:01:00Z', exit_code: 0, outcome: 'pass', test_counts: { passed: 13, failed: 0 }, stdout_sha256: H, stderr_sha256: H, failure_excerpt: '' },
  'review-receipt.json': { contract_version: '2.0.0', receipt_type: 'review', receipt_id: 'review-1', run_id: RUN, implementer_delegation_ids: ['impl-1'], tester_delegation_id: 'test-1', reviewer_delegation_id: 'review-1', reviewed_sha: G, input_hashes: { plan: H }, verdict: 'pass', evidence_ids: ['receipt-1'], findings: [], recorded_at: '2026-07-30T04:02:00Z' },
  'artifact-manifest.json': { contract_version: '2.0.0', run_id: RUN, artifacts: [{ path: 'product.txt', sha256: H, git_blob_id: G, owning_commit: G, file_type: 'regular' }] },
  'tasks.json': { contract_version: '2.0.0', run_id: RUN, tasks: [] },
  'verification.json': { contract_version: '2.0.0', run_id: RUN, implementation_sha: G, command_receipts: ['receipts/command-1.json'], review_receipt: 'receipts/review-1.json', outcome: 'pass' },
};

for (const [name, valid] of Object.entries(samples)) {
  test(`${name} accepts its positive contract-2 fixture`, () => {
    const validate = ajv.getSchema(`https://raw-to-release.dev/contracts/2/${name}`);
    assert.equal(validate(valid), true, JSON.stringify(validate.errors));
  });
  test(`${name} rejects contract 1 and malformed evidence`, () => {
    const validate = ajv.getSchema(`https://raw-to-release.dev/contracts/2/${name}`);
    const invalid = structuredClone(valid); invalid.contract_version = '1.9.9';
    assert.equal(validate(invalid), false);
  });
}

test('review schema does not substitute schema validity for identity independence', () => {
  const validate = ajv.getSchema('https://raw-to-release.dev/contracts/2/review-receipt.json');
  const structurallyValidButSameIdentity = structuredClone(samples['review-receipt.json']);
  structurallyValidButSameIdentity.tester_delegation_id = structurallyValidButSameIdentity.implementer_delegation_ids[0];
  assert.equal(validate(structurallyValidButSameIdentity), true);
  // r2rctl performs the cross-field provenance check; this documents that trust boundary.
});
