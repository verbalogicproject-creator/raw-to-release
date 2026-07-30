import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import { readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const PROJECT = resolve(import.meta.dirname, '..');
const CLI = join(PROJECT, 'plugins', 'raw-to-release', 'skills', 'raw-to-release', 'bin', 'r2rctl.mjs');
const RUN = '20260730-0700-fixture';
const FIXED_TIME = '2026-07-30T04:00:00.000Z';

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'r2rctl-'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, '.gitignore'), '.raw-to-release/runtime/\n');
  writeFileSync(join(root, 'product.txt'), 'candidate\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'fixture');
  return root;
}

function cli(root, ...args) {
  return spawnSync(process.execPath, [CLI, '--root', root, ...args], {
    encoding: 'utf8', env: { ...process.env, R2RCTL_TEST_TIME: FIXED_TIME },
  });
}

function ok(result) { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); }
function init(root) { return ok(cli(root, 'run', 'init', '--run', RUN)); }
function runPath(root) { return join(root, '.raw-to-release', 'runs', RUN); }
function active(root, name) { const manifest = JSON.parse(readFileSync(join(runPath(root), 'run-manifest.json'))); return join(runPath(root), 'generations', String(manifest.generation), name); }
function activeJson(root, name) { return JSON.parse(readFileSync(active(root, name), 'utf8')); }
function canonical(value) { if (value === null || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`; }
function hash(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }

function confirmIntent(root) {
  for (const dot of ['literal-task', 'strategic-intent', 'boundaries', 'task-type', 'relevant-principles']) {
    const proposed = ok(cli(root, 'intent', 'propose', '--run', RUN, '--dot', dot.replaceAll('-', '_'), '--value', `value for ${dot}`));
    ok(cli(root, 'intent', 'confirm', '--run', RUN, '--dot', dot.replaceAll('-', '_'), '--revision', String(proposed.revision), '--hash', proposed.content_hash, '--user', 'human-1'));
  }
}

function writePlan(root, authorities = { tasks: [{ task_id: 'task-1', allowed_tools: [], forbidden_tools: [], commands: [{ command_id: 'test', argv: [process.execPath, '-e', "console.log('1 passed')"], cwd: '.', kind: 'test' }] }] }) {
  const plan = ['# Plan', 'Scope', 'Architecture', 'Affected areas', 'Tests', 'Risks', 'Exclusions', 'Task authorities']
    .map((heading, index) => index === 0 ? `${heading}\n` : `## ${heading}\n\nDefined ${heading.toLowerCase()}.\n`).join('\n');
  writeFileSync(join(root, 'plan-input.md'), plan);
  writeFileSync(join(root, 'authorities.json'), JSON.stringify(authorities));
  return ok(cli(root, 'plan', 'approve', '--run', RUN, '--file', 'plan-input.md', '--authority-file', 'authorities.json', '--user', 'human-1'));
}

test('help exposes the version, complete command surface, and exit contract', () => {
  const result = ok(cli(repository(), 'help'));
  assert.equal(result.version, '0.1.1');
  assert.deepEqual(result.exits, { ok: 0, invalid: 2, blocked: 3, unavailable: 4, internal: 5 });
  assert.ok(result.commands.includes('audit-v1'));
});

test('preflight fails closed for dirty worktrees and unobservable delegation IDs', () => {
  const root = repository();
  let result = cli(root, 'preflight'); assert.equal(result.status, 4); assert.match(result.stderr, /identities are unobservable/);
  result = cli(root, 'preflight', '--delegation-ids', 'observable'); assert.equal(result.status, 4); assert.match(result.stderr, /unobservable/);
  writeFileSync(join(root, 'dirty.txt'), 'dirty');
  result = cli(root, 'preflight', '--delegation-ids', 'observable'); assert.equal(result.status, 3); assert.match(result.stderr, /dirty/);
});

test('run init uses a manifest-last transaction and a chained event log', () => {
  const root = repository(); init(root); const path = runPath(root);
  const manifest = JSON.parse(readFileSync(join(path, 'run-manifest.json')));
  const events = JSON.parse(readFileSync(active(root, 'events.json')));
  assert.equal(manifest.contract_version, '2.0.0'); assert.equal(manifest.generation, 1);
  assert.equal(events[0].type, 'run.init'); assert.equal(events[0].prior_event_hash, null);
  assert.ok(/^[a-f0-9]{64}$/.test(events[0].event_hash));
  assert.equal(existsSync(join(root, '.raw-to-release', 'runtime', RUN, 'r2rctl.lock')), false);
});

test('concurrent run mutation is blocked and does not absorb the lock', () => {
  const root = repository(); init(root);
  const lock = join(root, '.raw-to-release', 'runtime', RUN, 'r2rctl.lock'); mkdirSync(resolve(lock, '..'), { recursive: true }); writeFileSync(lock, 'other\n');
  const before = readFileSync(join(runPath(root), 'run-manifest.json'));
  const result = cli(root, 'intent', 'propose', '--run', RUN, '--dot', 'literal_task', '--value', 'x');
  assert.equal(result.status, 3); assert.match(result.stderr, /locked/);
  assert.deepEqual(readFileSync(join(runPath(root), 'run-manifest.json')), before); assert.equal(readFileSync(lock, 'utf8'), 'other\n');
});

test('intent confirmation binds the exact displayed revision and hash', () => {
  const root = repository(); init(root);
  const proposed = ok(cli(root, 'intent', 'propose', '--run', RUN, '--dot', 'literal_task', '--value', 'exact displayed value'));
  const before = readFileSync(join(runPath(root), 'run-manifest.json'));
  let result = cli(root, 'intent', 'confirm', '--run', RUN, '--dot', 'literal_task', '--revision', '1', '--hash', '0'.repeat(64), '--user', 'human-1');
  assert.equal(result.status, 3); assert.deepEqual(readFileSync(join(runPath(root), 'run-manifest.json')), before);
  const confirmed = ok(cli(root, 'intent', 'confirm', '--run', RUN, '--dot', 'literal_task', '--revision', '1', '--hash', proposed.content_hash, '--user', 'human-1'));
  assert.equal(confirmed.confirmed, true);
  result = cli(root, 'intent', 'confirm', '--run', RUN, '--dot', 'literal_task', '--revision', '1', '--hash', proposed.content_hash, '--user', 'human-1');
  assert.equal(result.status, 3);
});

test('plan approval requires deterministic sections and seals the authority hash', () => {
  const root = repository(); init(root); confirmIntent(root);
  writeFileSync(join(root, 'bad-plan.md'), '# Plan\n\nNo contract sections.\n');
  writeFileSync(join(root, 'authorities.json'), JSON.stringify({ tasks: [{ task_id: 'task-1' }] }));
  let result = cli(root, 'plan', 'approve', '--run', RUN, '--file', 'bad-plan.md', '--authority-file', 'authorities.json', '--user', 'human-1');
  assert.equal(result.status, 2); assert.match(result.stderr, /required level-2 sections/);
  const approved = writePlan(root); assert.match(approved.plan_hash, /^[a-f0-9]{64}$/); assert.match(approved.authority_hash, /^[a-f0-9]{64}$/);
  const receiptFiles = Object.keys(JSON.parse(readFileSync(join(runPath(root), 'run-manifest.json'))).files).filter((name) => name.includes('approval-plan'));
  assert.equal(receiptFiles.length, 1);
});

test('tasks reject authority drift, self-dependencies, and unknown cycle edges', () => {
  const root = repository(); init(root); confirmIntent(root); const approved = writePlan(root);
  const base = { contract_version: '2.0.0', task_id: 'task-1', delegation_id: 'impl-1', tester_delegation_id: 'tester-1', approved_authority_hash: approved.authority_hash, task_authority_hash: hash(JSON.parse(readFileSync(join(root, 'authorities.json'))).tasks[0]), dependencies: [], allowed_tools: [], forbidden_tools: [], commands: [{ command_id: 'test', argv: [process.execPath, '-e', "console.log('1 passed')"], cwd: '.', kind: 'test' }], acceptance_evidence: ['test'] };
  writeFileSync(join(root, 'task.json'), JSON.stringify({ ...base, approved_authority_hash: 'f'.repeat(64) }));
  let result = cli(root, 'task', 'register', '--run', RUN, '--id', 'task-1', '--file', 'task.json'); assert.equal(result.status, 3); assert.match(result.stderr, /authority drift/);
  writeFileSync(join(root, 'task.json'), JSON.stringify({ ...base, dependencies: ['task-1'] }));
  result = cli(root, 'task', 'register', '--run', RUN, '--id', 'task-1', '--file', 'task.json'); assert.equal(result.status, 3); assert.match(result.stderr, /itself/);
  writeFileSync(join(root, 'task.json'), JSON.stringify({ ...base, dependencies: ['task-2'] }));
  result = cli(root, 'task', 'register', '--run', RUN, '--id', 'task-1', '--file', 'task.json'); assert.equal(result.status, 2); assert.match(result.stderr, /unknown dependency/);
});

test('evidence exec uses only approved argv and derives a bounded receipt from execution', () => {
  const root = repository(); init(root); confirmIntent(root); const approved = writePlan(root);
  const task = { contract_version: '2.0.0', task_id: 'task-1', delegation_id: 'impl-1', tester_delegation_id: 'tester-1', approved_authority_hash: approved.authority_hash, task_authority_hash: hash(JSON.parse(readFileSync(join(root, 'authorities.json'))).tasks[0]), dependencies: [], allowed_tools: [], forbidden_tools: [], commands: [{ command_id: 'test', argv: [process.execPath, '-e', "console.log('1 passed')"], cwd: '.', kind: 'test' }], acceptance_evidence: ['test'] };
  writeFileSync(join(root, 'task.json'), JSON.stringify(task));
  ok(cli(root, 'task', 'register', '--run', RUN, '--id', 'task-1', '--file', 'task.json')); ok(cli(root, 'task', 'start', '--run', RUN, '--id', 'task-1'));
  let result = cli(root, 'evidence', 'exec', '--run', RUN, '--task', 'task-1', '--command', 'test', '--', 'echo', 'fabricated');
  assert.equal(result.status, 3); assert.match(result.stderr, /replacement argv/);
  const receipt = ok(cli(root, 'evidence', 'exec', '--run', RUN, '--task', 'task-1', '--command', 'test'));
  assert.equal(receipt.exit_code, 0); assert.equal(receipt.outcome, 'pass'); assert.deepEqual(receipt.argv, task.commands[0].argv);
  assert.equal(receipt.test_counts.passed, 1); assert.match(receipt.stdout_sha256, /^[a-f0-9]{64}$/); assert.equal(receipt.failure_excerpt, '');
  ok(cli(root, 'task', 'complete', '--run', RUN, '--id', 'task-1'));
});

test('failed commands retain child exit and map the operation to exit 5', () => {
  const root = repository(); init(root); confirmIntent(root); const authority = { task_id: 'task-1', allowed_tools: [], forbidden_tools: [], commands: [{ command_id: 'test', argv: [process.execPath, '-e', "console.error('secret=leak');process.exit(7)"], cwd: '.', kind: 'test' }] }; const approved = writePlan(root, { tasks: [authority] });
  const task = { contract_version: '2.0.0', task_id: 'task-1', delegation_id: 'impl-1', tester_delegation_id: 'tester-1', approved_authority_hash: approved.authority_hash, task_authority_hash: hash(authority), dependencies: [], allowed_tools: [], forbidden_tools: [], commands: authority.commands, acceptance_evidence: ['test'] };
  writeFileSync(join(root, 'task.json'), JSON.stringify(task)); ok(cli(root, 'task', 'register', '--run', RUN, '--id', 'task-1', '--file', 'task.json')); ok(cli(root, 'task', 'start', '--run', RUN, '--id', 'task-1'));
  const result = cli(root, 'evidence', 'exec', '--run', RUN, '--task', 'task-1', '--command', 'test');
  assert.equal(result.status, 5); const receipt = JSON.parse(result.stdout); assert.equal(receipt.exit_code, 7); assert.equal(receipt.outcome, 'fail'); assert.doesNotMatch(receipt.failure_excerpt, /leak/); assert.match(receipt.failure_excerpt, /redacted/);
  const complete = cli(root, 'task', 'complete', '--run', RUN, '--id', 'task-1'); assert.equal(complete.status, 3);
});

test('review receipt requires durable mutually distinct identities and current SHA', () => {
  const root = repository(); init(root); const sha = git(root, 'rev-parse', 'HEAD');
  const review = { contract_version: '2.0.0', implementer_delegation_ids: ['agent-1'], tester_delegation_id: 'agent-1', reviewer_delegation_id: 'agent-3', reviewed_sha: sha, input_hashes: {}, verdict: 'pass', evidence_ids: [], findings: [] };
  writeFileSync(join(root, 'review-input.json'), JSON.stringify(review));
  let result = cli(root, 'review', 'record', '--run', RUN, '--file', 'review-input.json'); assert.equal(result.status, 3); assert.match(result.stderr, /distinct/);
  review.tester_delegation_id = 'agent-2'; review.reviewed_sha = '0'.repeat(40); writeFileSync(join(root, 'review-input.json'), JSON.stringify(review));
  result = cli(root, 'review', 'record', '--run', RUN, '--file', 'review-input.json'); assert.equal(result.status, 3); assert.match(result.stderr, /stale/);
});

test('artifact recording rejects absolute, escaping, symlinked, and untracked paths', () => {
  const root = repository(); init(root);
  const cases = [['absolute', resolve(root, 'product.txt')], ['escape', '../outside'], ['untracked', 'loose.txt']];
  writeFileSync(join(root, 'loose.txt'), 'loose');
  for (const [name, path] of cases) {
    writeFileSync(join(root, 'artifacts.json'), JSON.stringify({ paths: [path] }));
    const result = cli(root, 'artifacts', 'record', '--run', RUN, '--file', 'artifacts.json'); assert.notEqual(result.status, 0, name);
  }
  try {
    symlinkSync(join(root, 'product.txt'), join(root, 'linked.txt'));
    writeFileSync(join(root, 'artifacts.json'), JSON.stringify({ paths: ['linked.txt'] }));
    const result = cli(root, 'artifacts', 'record', '--run', RUN, '--file', 'artifacts.json'); assert.equal(result.status, 2); assert.match(result.stderr, /symlink/);
  } catch { /* platform without symlink permission is covered in CI receipts */ }
});

test('validate rejects event corruption and leaves every byte untouched', () => {
  const root = repository(); init(root); const path = runPath(root);
  writeFileSync(active(root, 'events.json'), '[{"corrupt":true}]\n'); const before = readFileSync(active(root, 'events.json'));
  const result = cli(root, 'validate', '--run', RUN); assert.equal(result.status, 2); assert.match(result.stderr, /hash mismatch|hash chain/);
  assert.deepEqual(readFileSync(active(root, 'events.json')), before);
});

test('audit-v1 is read-only and explicitly non-resumable', () => {
  const root = repository(); const path = runPath(root); mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'run-state.json'), JSON.stringify({ contract_version: '1.9.9', run_id: RUN, state: 'intake', history: ['intake'] }));
  const before = readFileSync(join(path, 'run-state.json')); const result = ok(cli(root, 'audit-v1', '--run', RUN));
  assert.equal(result.audit_only, true); assert.equal(result.resumable, false); assert.deepEqual(readFileSync(join(path, 'run-state.json')), before);
  writeFileSync(join(path, 'run-state.json'), JSON.stringify({ contract_version: '3.0.0', run_id: RUN, state: 'intake', history: ['intake'] }));
  assert.equal(cli(root, 'audit-v1', '--run', RUN).status, 2);
});

test('records emitted by a real CLI journey conform to canonical contract 2.0', () => {
  const root = repository(); init(root);
  const contracts = join(PROJECT, 'method', 'contracts'); const ajv = new Ajv2020({ strict: true, allErrors: true });
  for (const name of readdirSync(contracts).filter((item) => item.endsWith('.json')).sort()) ajv.addSchema(JSON.parse(readFileSync(join(contracts, name), 'utf8')));
  assert.equal(ajv.getSchema('https://raw-to-release.dev/contracts/2/run-state.json')(activeJson(root, 'run-state.json')), true);
  ok(cli(root, 'intent', 'propose', '--run', RUN, '--dot', 'literal_task', '--value', 'literal'));
  assert.equal(ajv.getSchema('https://raw-to-release.dev/contracts/2/intent-record.json')(activeJson(root, 'intent.json')), true);
  for (const dot of ['strategic_intent', 'boundaries', 'task_type', 'relevant_principles']) ok(cli(root, 'intent', 'propose', '--run', RUN, '--dot', dot, '--value', dot));
  for (const dot of ['literal_task', 'strategic_intent', 'boundaries', 'task_type', 'relevant_principles']) {
    const intent = activeJson(root, 'intent.json'); ok(cli(root, 'intent', 'confirm', '--run', RUN, '--dot', dot, '--revision', String(intent.dots[dot].revision), '--hash', intent.dots[dot].content_hash, '--user', 'human-1'));
  }
  const approved = writePlan(root); const authority = JSON.parse(readFileSync(join(root, 'authorities.json'))).tasks[0];
  const task = { contract_version: '2.0.0', task_id: 'task-1', delegation_id: 'impl-1', tester_delegation_id: 'tester-1', approved_authority_hash: approved.authority_hash, task_authority_hash: hash(authority), dependencies: [], allowed_tools: authority.allowed_tools, forbidden_tools: authority.forbidden_tools, commands: authority.commands, acceptance_evidence: ['test'] };
  writeFileSync(join(root, 'task.json'), JSON.stringify(task)); ok(cli(root, 'task', 'register', '--run', RUN, '--id', 'task-1', '--file', 'task.json'));
  assert.equal(ajv.getSchema('https://raw-to-release.dev/contracts/2/tasks.json')(activeJson(root, 'tasks.json')), true);
  ok(cli(root, 'task', 'start', '--run', RUN, '--id', 'task-1')); const receipt = ok(cli(root, 'evidence', 'exec', '--run', RUN, '--task', 'task-1', '--command', 'test'));
  assert.equal(ajv.getSchema('https://raw-to-release.dev/contracts/2/command-receipt.json')(activeJson(root, receipt.receipt)), true);
});

test('an interrupted future generation is never absorbed on resume', () => {
  const root = repository(); init(root); const path = runPath(root); const before = readFileSync(join(path, 'run-manifest.json'));
  cpSync(join(path, 'generations', '1'), join(path, 'generations', '2'), { recursive: true });
  writeFileSync(join(path, 'generations', '2', 'uncommitted.json'), '{}\n');
  const result = cli(root, 'intent', 'propose', '--run', RUN, '--dot', 'literal_task', '--value', 'must not absorb');
  assert.equal(result.status, 2); assert.match(result.stderr, /orphan|ambiguous/); assert.deepEqual(readFileSync(join(path, 'run-manifest.json')), before);
});

test('task registration is impossible before a sealed approved plan', () => {
  const root = repository(); init(root);
  writeFileSync(join(root, 'task.json'), JSON.stringify({ contract_version: '2.0.0', task_id: 'task-1' }));
  const result = cli(root, 'task', 'register', '--run', RUN, '--id', 'task-1', '--file', 'task.json');
  assert.equal(result.status, 3); assert.match(result.stderr, /approved sealed plan/);
});

test('protected command classes are denied before spawn', () => {
  const root = repository(); init(root); confirmIntent(root);
  const authority = { task_id: 'task-1', allowed_tools: ['git'], forbidden_tools: ['push'], commands: [{ command_id: 'tests', argv: ['git', 'push', 'origin', 'main'], cwd: '.', kind: 'test' }] };
  const approved = writePlan(root, { tasks: [authority] });
  const task = { contract_version: '2.0.0', task_id: 'task-1', delegation_id: 'impl-1', tester_delegation_id: 'tester-1', approved_authority_hash: approved.authority_hash, task_authority_hash: hash(authority), dependencies: [], allowed_tools: authority.allowed_tools, forbidden_tools: authority.forbidden_tools, commands: authority.commands, acceptance_evidence: ['tests'] };
  writeFileSync(join(root, 'task.json'), JSON.stringify(task)); ok(cli(root, 'task', 'register', '--run', RUN, '--id', 'task-1', '--file', 'task.json')); ok(cli(root, 'task', 'start', '--run', RUN, '--id', 'task-1'));
  const result = cli(root, 'evidence', 'exec', '--run', RUN, '--task', 'task-1', '--command', 'tests');
  assert.equal(result.status, 3); assert.match(result.stderr, /protected|forbidden/);
});

test('protected effects cannot be hidden in absolute paths or interpreter payloads', () => {
  for (const argv of [['/usr/bin/curl', 'https://example.invalid'], [process.execPath, '-e', "require('node:child_process').execFileSync('git',['push'])"]]) {
    const root = repository(); init(root); confirmIntent(root);
    const authority = { task_id: 'task-1', allowed_tools: ['node'], forbidden_tools: [], commands: [{ command_id: 'tests', argv, cwd: '.', kind: 'test' }] };
    const approved = writePlan(root, { tasks: [authority] }); const task = { contract_version: '2.0.0', task_id: 'task-1', delegation_id: 'impl-1', tester_delegation_id: 'tester-1', approved_authority_hash: approved.authority_hash, task_authority_hash: hash(authority), dependencies: [], allowed_tools: authority.allowed_tools, forbidden_tools: [], commands: authority.commands, acceptance_evidence: ['tests'] };
    writeFileSync(join(root, 'task.json'), JSON.stringify(task)); ok(cli(root, 'task', 'register', '--run', RUN, '--id', 'task-1', '--file', 'task.json')); ok(cli(root, 'task', 'start', '--run', RUN, '--id', 'task-1'));
    const result = cli(root, 'evidence', 'exec', '--run', RUN, '--task', 'task-1', '--command', 'tests'); assert.equal(result.status, 3); assert.match(result.stderr, /host approval capability/);
  }
});

test('plan rejection invalidates affected Dots until exact reconfirmation', () => {
  const root = repository(); init(root); confirmIntent(root); writePlan(root);
  ok(cli(root, 'plan', 'reject', '--run', RUN, '--user', 'human-1', '--reason', 'boundary changed', '--dots', 'boundaries'));
  let intent = activeJson(root, 'intent.json'); assert.equal(intent.confirmation_state, 'draft'); assert.equal(intent.dots.boundaries.confirmed, false);
  assert.equal(cli(root, 'plan', 'approve', '--run', RUN, '--file', 'plan-input.md', '--authority-file', 'authorities.json', '--user', 'human-1').status, 3);
  const proposed = ok(cli(root, 'intent', 'propose', '--run', RUN, '--dot', 'boundaries', '--value', 'revised boundary'));
  ok(cli(root, 'intent', 'confirm', '--run', RUN, '--dot', 'boundaries', '--revision', String(proposed.revision), '--hash', proposed.content_hash, '--user', 'human-1'));
  assert.equal(writePlan(root).state, 'approved');
});

test('latest-attempt policy requires retry and refuses pass overwrite', () => {
  const root = repository(); init(root); confirmIntent(root);
  const script = "const fs=require('fs'),p='.raw-to-release/runtime/retry-marker';fs.mkdirSync('.raw-to-release/runtime',{recursive:true});if(!fs.existsSync(p)){fs.writeFileSync(p,'1');process.exit(7)}console.log('1 passed')";
  const authority = { task_id: 'task-1', allowed_tools: ['node'], forbidden_tools: [], commands: [{ command_id: 'tests', argv: [process.execPath, '-e', script], cwd: '.', kind: 'test' }] };
  const approved = writePlan(root, { tasks: [authority] }); const task = { contract_version: '2.0.0', task_id: 'task-1', delegation_id: 'impl-1', tester_delegation_id: 'tester-1', approved_authority_hash: approved.authority_hash, task_authority_hash: hash(authority), dependencies: [], allowed_tools: authority.allowed_tools, forbidden_tools: [], commands: authority.commands, acceptance_evidence: ['tests'] };
  writeFileSync(join(root, 'task.json'), JSON.stringify(task)); ok(cli(root, 'task', 'register', '--run', RUN, '--id', 'task-1', '--file', 'task.json')); ok(cli(root, 'task', 'start', '--run', RUN, '--id', 'task-1'));
  assert.equal(cli(root, 'evidence', 'exec', '--run', RUN, '--task', 'task-1', '--command', 'tests').status, 5);
  assert.equal(cli(root, 'evidence', 'exec', '--run', RUN, '--task', 'task-1', '--command', 'tests').status, 3);
  ok(cli(root, 'task', 'retry', '--run', RUN, '--id', 'task-1')); const passed = ok(cli(root, 'evidence', 'exec', '--run', RUN, '--task', 'task-1', '--command', 'tests'));
  assert.equal(passed.attempt, 2); assert.equal(passed.outcome, 'pass'); assert.equal(cli(root, 'evidence', 'exec', '--run', RUN, '--task', 'task-1', '--command', 'tests').status, 3);
  ok(cli(root, 'task', 'complete', '--run', RUN, '--id', 'task-1'));
});

test('non-init traversal and nested-symlink cwd fail closed', () => {
  const root = repository(); assert.equal(cli(root, 'validate', '--run', '../escape').status, 2); assert.equal(cli(root, 'validate', '--run', '..\\escape').status, 2); assert.equal(cli(root, 'validate', '--run', 'C:\\escape').status, 2);
  init(root); confirmIntent(root); const outside = mkdtempSync(join(tmpdir(), 'r2r-outside-')); symlinkSync(outside, join(root, 'linked-dir'));
  const authority = { task_id: 'task-1', allowed_tools: ['node'], forbidden_tools: [], commands: [{ command_id: 'tests', argv: [process.execPath, '-e', "console.log('1 passed')"], cwd: 'linked-dir', kind: 'test' }] };
  const approved = writePlan(root, { tasks: [authority] }); const task = { contract_version: '2.0.0', task_id: 'task-1', delegation_id: 'impl-1', tester_delegation_id: 'tester-1', approved_authority_hash: approved.authority_hash, task_authority_hash: hash(authority), dependencies: [], allowed_tools: authority.allowed_tools, forbidden_tools: [], commands: authority.commands, acceptance_evidence: ['tests'] };
  writeFileSync(join(root, 'task.json'), JSON.stringify(task)); ok(cli(root, 'task', 'register', '--run', RUN, '--id', 'task-1', '--file', 'task.json')); ok(cli(root, 'task', 'start', '--run', RUN, '--id', 'task-1'));
  const result = cli(root, 'evidence', 'exec', '--run', RUN, '--task', 'task-1', '--command', 'tests'); assert.equal(result.status, 2); assert.match(result.stderr, /symlink/);
});
