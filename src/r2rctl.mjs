#!/usr/bin/env node
/* Raw to Release v0.1.1: dependency-free Node 22 state and evidence runtime. */
import {
  closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync,
  readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const VERSION = '0.1.1';
const CONTRACT = '2.0.0';
const EXIT = Object.freeze({ ok: 0, invalid: 2, blocked: 3, unavailable: 4, internal: 5 });
const DOTS = ['literal_task', 'strategic_intent', 'boundaries', 'task_type', 'relevant_principles'];
const STATES = ['intake', 'intent_confirmed', 'planned', 'approved', 'implementing', 'verifying', 'release_ready'];
const TRANSITIONS = {
  intake: ['intent_confirmed', 'blocked', 'aborted'],
  intent_confirmed: ['planned', 'blocked', 'aborted'],
  planned: ['approved', 'intent_confirmed', 'blocked', 'aborted'],
  approved: ['implementing', 'intent_confirmed', 'blocked', 'aborted'],
  implementing: ['verifying', 'blocked', 'aborted'],
  verifying: ['release_ready', 'implementing', 'blocked', 'aborted'],
  release_ready: [], blocked: [], aborted: [],
};
const LIMITS = { delegations: 12, concurrent_agents: 3, implementation_tasks: 8, fix_review_cycles: 2, retries: 1 };
const PLAN_SECTIONS = ['Scope', 'Architecture', 'Affected areas', 'Tests', 'Risks', 'Exclusions', 'Task authorities'];
const HANDOFF_SECTIONS = ['Candidate', 'Intent and plan', 'Verification', 'Independent review', 'Artifacts', 'Residual risks', 'Protected effects'];
const initialGates = () => ({ privacy_acknowledged: true, dots_confirmed: false, plan_approved: false, branch_created: false, implementation_committed: false, tests_fresh: false, tests_outcome: 'unknown', test_evidence_ids: [], review_independent: false, review_outcome: 'unknown', review_evidence_ids: [], handoff_committed: false, final_worktree_clean: false });

class R2RError extends Error { constructor(message, code = EXIT.invalid) { super(message); this.code = code; } }
const fail = (message, code = EXIT.invalid) => { throw new R2RError(message, code); };

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const sha256 = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
// Time is evidence, never a caller-controlled input.  Tests normalize timestamps
// at their boundary rather than teaching the shipped runtime a test clock.
const isoNow = () => new Date().toISOString();
const json = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { fail(`invalid JSON ${path}: ${error.message}`, EXIT.invalid); }
};
const output = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

function parse(argv) {
  const positional = []; const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--') { flags.set('--', argv.slice(index + 1)); break; }
    if (item.startsWith('--')) {
      const equal = item.indexOf('=');
      if (equal > 2) flags.set(item.slice(0, equal), item.slice(equal + 1));
      else if (index + 1 < argv.length && !argv[index + 1].startsWith('--')) flags.set(item, argv[++index]);
      else flags.set(item, true);
    } else positional.push(item);
  }
  return { positional, flags, get: (name, required = false) => {
    const value = flags.get(`--${name}`);
    if (required && (value === undefined || value === true || value === '')) fail(`--${name} is required`);
    return value;
  } };
}

const cli = parse(process.argv.slice(2));
const root = resolve(String(cli.get('root') || process.cwd()));
const runId = () => {
  const id = String(cli.get('run', true));
  if (!/^\d{8}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail('invalid run ID');
  return id;
};
const r2rRoot = () => join(root, '.raw-to-release');
const runsRoot = () => join(r2rRoot(), 'runs');
const runRoot = (required = true) => {
  const path = join(runsRoot(), runId());
  // Do not permit a run name, its parent, or an already-created run to cross a
  // symlink.  This check is deliberately repeated at every command boundary.
  let cursor = root;
  for (const part of ['.raw-to-release', 'runs', runId()]) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) fail('run path contains a symlink', EXIT.invalid);
  }
  if (required && !existsSync(path)) fail(`run does not exist: ${runId()}`, EXIT.blocked);
  return path;
};
const runtimeRoot = () => join(r2rRoot(), 'runtime', runId());

function rejectSymlinkComponents(path, boundary = root) {
  const rel = relative(boundary, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail('path escapes its authority boundary', EXIT.invalid);
  let cursor = boundary;
  for (const part of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) fail(`path contains a symlink: ${relative(root, cursor)}`, EXIT.invalid);
  }
}

function git(args, { allowFailure = false, nul = false } = {}) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: nul ? 'buffer' : 'utf8', windowsHide: true });
  if (result.error?.code === 'ENOENT') fail('Git is unavailable', EXIT.unavailable);
  if (result.status !== 0 && !allowFailure) fail(`Git failed: ${(result.stderr || '').toString().trim()}`, EXIT.unavailable);
  return result;
}
const gitText = (...args) => git(args).stdout.trim();
const isRepo = () => git(['rev-parse', '--is-inside-work-tree'], { allowFailure: true }).status === 0;
const statusEntries = () => {
  const result = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], { nul: true });
  const bytes = result.stdout || Buffer.alloc(0);
  return bytes.toString('utf8').split('\0').filter(Boolean);
};
const cleanWorktree = () => statusEntries().length === 0;

function ensureRoot() {
  if (!existsSync(root) || !statSync(root).isDirectory()) fail('repository root is unavailable', EXIT.unavailable);
  if (!isRepo()) fail('a Git worktree is required', EXIT.unavailable);
}

function safeRelative(path, { mustExist = true } = {}) {
  if (typeof path !== 'string' || path === '' || isAbsolute(path)) fail(`unsafe repository-relative path: ${path}`, EXIT.invalid);
  const normalized = path.replaceAll('\\', '/');
  if (normalized.split('/').includes('..') || normalized.startsWith('/') || normalized.startsWith('//') || /^[a-z]:/i.test(normalized)) fail(`path escapes repository: ${path}`, EXIT.invalid);
  const target = resolve(root, normalized);
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(`path escapes repository: ${path}`, EXIT.invalid);
  if (mustExist) {
    let cursor = root;
    for (const part of normalized.split('/')) {
      cursor = join(cursor, part);
      if (!existsSync(cursor)) fail(`missing file: ${path}`, EXIT.invalid);
      if (lstatSync(cursor).isSymbolicLink()) fail(`symlink is forbidden: ${path}`, EXIT.invalid);
    }
    if (!statSync(target).isFile()) fail(`not a regular file: ${path}`, EXIT.invalid);
  }
  return target;
}

function safeDirectory(path) {
  if (path === '.') return root;
  const normalized = typeof path === 'string' ? path.replaceAll('\\', '/') : path;
  if (typeof path !== 'string' || path === '' || isAbsolute(path) || normalized.split('/').includes('..') || normalized.startsWith('/') || normalized.startsWith('//') || /^[a-z]:/i.test(normalized)) fail(`directory escapes repository: ${path}`, EXIT.invalid);
  let cursor = root;
  for (const part of normalized.split('/')) {
    cursor = join(cursor, part);
    if (!existsSync(cursor)) fail(`missing directory: ${path}`, EXIT.invalid);
    if (lstatSync(cursor).isSymbolicLink()) fail(`directory contains a symlink: ${path}`, EXIT.invalid);
  }
  if (!statSync(cursor).isDirectory()) fail(`not a directory: ${path}`, EXIT.invalid);
  return cursor;
}

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
    closeSync(fd);
    renameSync(temporary, path);
    try { const directory = openSync(dirname(path), constants.O_RDONLY); fsyncSync(directory); closeSync(directory); } catch { /* unsupported directory fsync */ }
  } catch (error) {
    try { closeSync(fd); } catch { /* already closed */ }
    try { unlinkSync(temporary); } catch { /* best effort only */ }
    throw error;
  }
}

function acquireLock() {
  const path = join(runtimeRoot(), 'r2rctl.lock'); rejectSymlinkComponents(dirname(path)); mkdirSync(dirname(path), { recursive: true }); rejectSymlinkComponents(dirname(path));
  try { return { path, fd: openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600) }; }
  catch (error) { if (error.code === 'EEXIST') fail('run is locked by another operation', EXIT.blocked); throw error; }
}
function locked(action) {
  const lock = acquireLock();
  try { writeFileSync(lock.fd, `${process.pid}\n`); fsyncSync(lock.fd); return action(); }
  finally { closeSync(lock.fd); try { unlinkSync(lock.path); } catch { /* leave evidence of unexpected failure */ } }
}

function events(path) {
  const file = recordPath(path, 'events.json');
  if (!existsSync(file)) return [];
  const value = json(file);
  if (!Array.isArray(value)) fail('corrupt event log', EXIT.invalid);
  let prior = null;
  for (const event of value) {
    const claimed = event.event_hash; const copy = { ...event }; delete copy.event_hash;
    if (event.prior_event_hash !== prior || claimed !== sha256(copy)) fail('corrupt event-log hash chain', EXIT.invalid);
    prior = claimed;
  }
  return value;
}

function manifest(path) {
  const file = join(path, 'run-manifest.json');
  return existsSync(file) ? json(file) : { contract_version: CONTRACT, generation: 0, files: {} };
}

function generationRoot(path, generation) { return join(path, 'generations', String(generation)); }
function recordPath(path, name) {
  const current = manifest(path);
  return current.generation > 0 ? join(generationRoot(path, current.generation), name) : join(path, name);
}

function transaction(path, changes, eventType, eventData = {}) {
  // A manifest is an authority boundary, not merely a checksum index.  Refuse
  // to continue from a partially-written or ambiguous generation.
  if (existsSync(join(path, 'run-manifest.json'))) validateManifest(path, { rejectOrphans: true });
  const currentEvents = events(path);
  const prior = currentEvents.at(-1)?.event_hash || null;
  const body = { sequence: currentEvents.length + 1, at: isoNow(), type: eventType, data: eventData, prior_event_hash: prior };
  const nextEvents = [...currentEvents, { ...body, event_hash: sha256(body) }];
  const all = new Map(Object.entries(changes)); all.set('events.json', nextEvents);
  const current = manifest(path); const files = { ...current.files };
  const nextGeneration = current.generation + 1;
  const stage = join(path, '.staging', `${nextGeneration}-${randomUUID()}`);
  const generation = generationRoot(path, nextGeneration);
  rejectSymlinkComponents(join(path, '.staging'), path); rejectSymlinkComponents(join(path, 'generations'), path);
  mkdirSync(stage, { recursive: true });
  // Re-materialize the complete immutable generation.  The only live pointer is
  // run-manifest.json, swapped after this directory has been durably renamed.
  for (const [name, expected] of Object.entries(current.files)) {
    const source = recordPath(path, name); const content = readFileSync(source);
    atomicWrite(join(stage, name), content);
    files[name] = expected;
  }
  for (const [name, value] of all) {
    if (name === 'run-manifest.json' || isAbsolute(name) || name.includes('\\') || name.split('/').includes('..') || name.startsWith('/') || /^[a-z]:/i.test(name)) fail(`unsafe authoritative record name: ${name}`);
    const content = typeof value === 'string' ? value.replaceAll('\r\n', '\n') : `${canonical(value)}\n`;
    atomicWrite(join(stage, name), content);
    files[name] = { sha256: sha256(content), bytes: Buffer.byteLength(content), type: 'regular' };
  }
  mkdirSync(dirname(generation), { recursive: true });
  renameSync(stage, generation);
  try { const directory = openSync(dirname(generation), constants.O_RDONLY); fsyncSync(directory); closeSync(directory); } catch { /* unsupported directory fsync */ }
  const next = { contract_version: CONTRACT, generation: nextGeneration, files };
  atomicWrite(join(path, 'run-manifest.json'), `${canonical(next)}\n`); // commit point, always last
  return next;
}

function loadRecord(name) {
  const path = recordPath(runRoot(), name);
  if (!existsSync(path)) fail(`missing authoritative record: ${name}`, EXIT.blocked);
  return json(path);
}
function state() { return loadRecord('run-state.json'); }
function assertV2(value, label) {
  if (!value || typeof value !== 'object' || value.contract_version !== CONTRACT) fail(`${label} is not contract 2.0`, EXIT.invalid);
}
function transition(value, next) {
  if (!TRANSITIONS[value.state]?.includes(next)) fail(`illegal lifecycle transition ${value.state} -> ${next}`, EXIT.blocked);
  return { ...value, state: next, history: [...value.history, next], updated_at: isoNow() };
}
function markdownSections(text, headings, label) {
  const matches = [...text.matchAll(/^## ([^\r\n]+)\r?$/gm)];
  const found = matches.map((match) => match[1]);
  if (found.length !== headings.length || headings.some((heading, index) => found[index] !== heading)) fail(`${label} must contain the required level-2 sections in order: ${headings.join(', ')}`, EXIT.invalid);
  for (let index = 0; index < matches.length; index += 1) {
    const start = matches[index].index + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    if (!text.slice(start, end).trim()) fail(`${label} section is empty: ${headings[index]}`, EXIT.invalid);
  }
}
function receiptName(kind, id) { return `receipts/${kind}-${id}.json`; }
function receiptId(kind) { return `${kind}-${randomUUID()}`; }

function preflight() {
  ensureRoot();
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 22) fail(`Node 22 or newer is required; found ${process.versions.node}`, EXIT.unavailable);
  const identityVisibility = 'unobservable';
  const capabilities = {
    contract_version: CONTRACT, node: process.versions.node, git: gitText('--version'),
    repository: '.', branch: gitText('branch', '--show-current'), sha: gitText('rev-parse', 'HEAD'),
    clean: cleanWorktree(), local_command_execution: 'verified', delegation_ids: identityVisibility,
    protected_effects: 'host-controlled',
  };
  if (!capabilities.clean) fail('existing repository worktree is dirty', EXIT.blocked);
  fail('durable delegated-agent identities are unobservable; host effect approval is also unobservable', EXIT.unavailable);
}

function runInit() {
  ensureRoot(); if (!cleanWorktree()) fail('run init requires a clean worktree', EXIT.blocked);
  const id = runId();
  const path = runRoot(false); if (existsSync(path)) fail('run already exists', EXIT.blocked);
  locked(() => {
    mkdirSync(path, { recursive: true });
    const value = {
      contract_version: CONTRACT, run_id: id, state: 'intake', history: ['intake'],
      created_at: isoNow(), updated_at: isoNow(), base_sha: gitText('rev-parse', 'HEAD'),
      branch: `r2r/${id}`, counters: { delegations: 0, concurrent_agents: 0, implementation_tasks: 0, fix_review_cycles: 0, retries: 0 },
      gates: initialGates(), artifacts: { intent: 'intent.json', plan: '', tasks: 'tasks.json', task_records: [], verification: 'verification.json', handoff: '' },
      protected_effects_performed: [], authority_hash: null,
    };
    transaction(path, { 'run-state.json': value }, 'run.init', { run_id: id, base_sha: value.base_sha });
  });
  output({ run_id: id, state: 'intake', branch: `r2r/${id}` });
}

function intentPropose() {
  const dot = String(cli.get('dot', true)); if (!DOTS.includes(dot)) fail(`unknown Dot: ${dot}`);
  const value = String(cli.get('value', true)); const path = runRoot();
  locked(() => {
    const prior = manifest(path).files['intent.json'] ? loadRecord('intent.json') : { contract_version: CONTRACT, run_id: runId(), revision: 0, dots: {}, confirmation_state: 'draft', privacy_acknowledged: true, provenance: { source: 'user', recorded_at: isoNow() } };
    assertV2(prior, 'intent'); if (prior.confirmation_state === 'confirmed') fail('confirmed intent is immutable', EXIT.blocked);
    const revision = (prior.dots[dot]?.revision || 0) + 1;
    const proposal = { contract_version: CONTRACT, run_id: runId(), dot, revision, value, content_hash: sha256(value), proposed_at: isoNow() };
    const next = { ...prior, revision, dots: { ...prior.dots, [dot]: { revision, value, content_hash: proposal.content_hash, confirmed: false, confirmed_at: null } } };
    transaction(path, { [`proposals/${dot}-r${revision}.json`]: proposal, 'intent.json': next }, 'intent.propose', { dot, revision, content_hash: proposal.content_hash });
    output({ dot, revision, content_hash: proposal.content_hash, value });
  });
}

function intentConfirm() {
  const dot = String(cli.get('dot', true)); const revision = Number(cli.get('revision', true));
  const displayedHash = String(cli.get('hash', true)); const user = String(cli.get('user', true)); const path = runRoot();
  locked(() => {
    const current = loadRecord('intent.json'); assertV2(current, 'intent');
    const proposal = loadRecord(`proposals/${dot}-r${revision}.json`);
    if (proposal.content_hash !== displayedHash || current.dots[dot]?.content_hash !== displayedHash || current.dots[dot]?.revision !== revision) fail('confirmation does not match the displayed immutable proposal', EXIT.blocked);
    if (current.dots[dot].confirmed) fail('Dot revision is already confirmed', EXIT.blocked);
    const confirmedAt = isoNow(); const receipt = { contract_version: CONTRACT, receipt_type: 'intent', receipt_id: receiptId('approval-intent', { dot, revision, displayedHash }), run_id: runId(), user, revision, displayed_content_hash: displayedHash, confirmed_at: confirmedAt, target: `${dot}-r${revision}` };
    const dots = { ...current.dots, [dot]: { ...current.dots[dot], confirmed: true, confirmed_at: confirmedAt } };
    const allConfirmed = DOTS.every((name) => dots[name]?.confirmed);
    let nextIntent = { ...current, dots, confirmation_state: allConfirmed ? 'confirmed' : 'draft' };
    nextIntent = { ...nextIntent, intent_hash: sha256(DOTS.map((name) => dots[name])) };
    let nextState = state(); if (allConfirmed && nextState.state === 'intake') nextState = transition(nextState, 'intent_confirmed');
    transaction(path, { 'intent.json': nextIntent, 'run-state.json': nextState, [receiptName('approval-intent', `${dot}-r${revision}-${receipt.receipt_id}`)]: receipt }, 'intent.confirm', { dot, revision, displayedHash, receipt_id: receipt.receipt_id });
    output({ dot, revision, confirmed: true, intent_hash: nextIntent.intent_hash });
  });
}

function planApprove() {
  const path = runRoot(); const file = safeRelative(String(cli.get('file', true)));
  const authorityFile = safeRelative(String(cli.get('authority-file', true)));
  const user = String(cli.get('user', true)); const text = readFileSync(file, 'utf8').replaceAll('\r\n', '\n'); markdownSections(text, PLAN_SECTIONS, 'plan');
  const authorities = json(authorityFile); if (!Array.isArray(authorities.tasks) || authorities.tasks.length === 0 || authorities.tasks.length > LIMITS.implementation_tasks) fail('authority set must contain 1-8 tasks');
  if (new Set(authorities.tasks.map((task) => task.task_id)).size !== authorities.tasks.length || authorities.tasks.some((task) => !task.task_id || !Array.isArray(task.commands) || !Array.isArray(task.allowed_tools) || !Array.isArray(task.forbidden_tools))) fail('every authority entry must bind task ID, commands, allowed tools, and forbidden tools');
  const authorityHash = sha256(authorities); const planHash = sha256(text);
  locked(() => {
    const intent = loadRecord('intent.json'); if (intent.confirmation_state !== 'confirmed') fail('all five Dots must be confirmed', EXIT.blocked);
    let nextState = state(); if (nextState.state !== 'intent_confirmed') fail('plan approval is not allowed in the current state', EXIT.blocked);
    nextState = transition(transition(nextState, 'planned'), 'approved'); nextState.authority_hash = authorityHash;
    const receipt = { contract_version: CONTRACT, receipt_type: 'plan', receipt_id: receiptId('approval-plan', { planHash, authorityHash }), run_id: runId(), user, revision: 1, displayed_content_hash: planHash, authority_hash: authorityHash, confirmed_at: isoNow(), target: 'plan.md' };
    transaction(path, { 'plan.md': text, 'task-authorities.json': authorities, 'run-state.json': nextState, [receiptName('approval-plan', receipt.receipt_id)]: receipt }, 'plan.approve', { plan_hash: planHash, authority_hash: authorityHash, receipt_id: receipt.receipt_id });
    output({ plan_hash: planHash, authority_hash: authorityHash, state: nextState.state });
  });
}

function planReject() {
  const path = runRoot(); const user = String(cli.get('user', true)); const reason = String(cli.get('reason', true));
  const affected = String(cli.get('dots', true)).split(',').filter(Boolean);
  if (!affected.length || affected.some((dot) => !DOTS.includes(dot))) fail('--dots must list affected Dot names');
  locked(() => {
    const current = state();
    if (!['planned', 'approved'].includes(current.state)) fail('plan rejection is not allowed in the current state', EXIT.blocked);
    const next = transition(current, 'intent_confirmed');
    next.authority_hash = null; next.gates = { ...next.gates, plan_approved: false };
    const intent = loadRecord('intent.json');
    const dots = { ...intent.dots };
    for (const dot of affected) dots[dot] = { ...dots[dot], confirmed: false, confirmed_at: null };
    const nextIntent = { ...intent, dots, confirmation_state: 'draft', intent_hash: sha256(DOTS.map((dot) => dots[dot])) };
    const rejectedAt = isoNow(); const receipt = { contract_version: CONTRACT, receipt_type: 'plan-rejection', receipt_id: receiptId('approval-plan-rejection', { current: current.authority_hash, affected, reason }), run_id: runId(), user, revision: 1, displayed_content_hash: sha256(readFileSync(recordPath(path, 'plan.md'))), authority_hash: current.authority_hash, confirmed_at: rejectedAt, reason, rejected_at: rejectedAt, target: 'plan.md', rejected_authority_hash: current.authority_hash };
    transaction(path, { 'intent.json': nextIntent, 'run-state.json': next, [receiptName('approval-plan-rejection', receipt.receipt_id)]: receipt }, 'plan.reject', { user, reason, affected_dots: affected, rejected_authority_hash: current.authority_hash, receipt_id: receipt.receipt_id });
    output({ rejected: true, affected_dots: affected, state: next.state });
  });
}

function runTerminal(action) {
  const path = runRoot(); const reason = String(cli.get('reason', true));
  locked(() => {
    const current = state(); if (['release_ready', 'blocked', 'aborted'].includes(current.state)) fail('run is already terminal', EXIT.blocked);
    const next = transition(current, action === 'abort' ? 'aborted' : 'blocked');
    transaction(path, { 'run-state.json': next }, `run.${action}`, { reason }); output({ state: next.state, reason });
  });
}

function loadTasks() { return manifest(runRoot()).files['tasks.json'] ? loadRecord('tasks.json') : { contract_version: CONTRACT, run_id: runId(), tasks: [] }; }
function assertDag(tasks) {
  const byId = new Map(tasks.map((task) => [task.task_id, task])); const visiting = new Set(); const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail('task dependency cycle', EXIT.blocked); if (visited.has(id)) return;
    const task = byId.get(id); if (!task) fail(`unknown dependency: ${id}`, EXIT.invalid);
    visiting.add(id); for (const dependency of task.dependencies || []) { if (dependency === id) fail('task cannot depend on itself', EXIT.blocked); visit(dependency); }
    visiting.delete(id); visited.add(id);
  }
  for (const id of byId.keys()) visit(id);
}

function commandReceipts(path, taskId, commandId) {
  return Object.keys(manifest(path).files)
    .filter((name) => name.startsWith('receipts/command-'))
    .map((name) => loadRecord(name))
    .filter((receipt) => receipt.task_id === taskId && receipt.command_id === commandId)
    .sort((left, right) => left.attempt - right.attempt || left.ended_at.localeCompare(right.ended_at));
}

function protectedCommand(argv, forbidden = []) {
  const words = argv.map((value) => String(value).toLowerCase());
  const bases = words.map((word) => word.replaceAll('\\', '/').split('/').at(-1));
  const narrative = words.join(' ');
  // argv is the authority boundary, but interpreter payloads are executable
  // too.  Reject the protected effect wherever it is carried, including an
  // absolute executable path, a shell wrapper, or a Node/Python -e payload.
  const protectedEffect = /(^|[\s;|&])(?:git\s+push|(?:npm|pnpm|yarn)\s+(?:add|install|publish)|(?:curl|wget|ssh|scp|ftp|telnet)\b|(?:rm|rmdir)\b|(?:deploy|publish)\b)/;
  if (protectedEffect.test(narrative)) return true;
  if (bases.some((base) => ['curl', 'wget', 'ssh', 'scp', 'ftp', 'telnet', 'rm', 'rmdir'].includes(base))) return true;
  if (['node', 'node.exe', 'python', 'python3', 'python.exe', 'sh', 'bash', 'cmd', 'cmd.exe', 'powershell', 'pwsh'].includes(bases[0]) && /(?:git.{0,80}push|(?:npm|pnpm|yarn).{0,80}(?:install|publish)|curl|wget|ssh|scp|\brm\b|deploy|publish)/.test(narrative)) return true;
  return forbidden.some((effect) => narrative.includes(String(effect).toLowerCase()));
}

function taskCommand(action) {
  const path = runRoot(); const id = String(cli.get('id', action !== 'register'));
  locked(() => {
    let tasks = loadTasks();
    let nextState = state();
    let fallbackChanges = null; let fallbackEvent = {}; let revisedAuthorities = null;
    if (action === 'register') {
      if (!['approved', 'implementing'].includes(nextState.state) || !nextState.authority_hash) fail('task registration requires an approved sealed plan', EXIT.blocked);
      const file = safeRelative(String(cli.get('file', true))); const task = json(file); assertV2(task, 'task');
      if (task.task_id !== String(cli.get('id', true))) fail('task ID does not match file');
      if (tasks.tasks.some((item) => item.task_id === task.task_id)) fail('duplicate task ID', EXIT.blocked);
      if (!task.delegation_id || !task.tester_delegation_id || !Array.isArray(task.commands) || !Array.isArray(task.acceptance_evidence)) fail('task lacks sealed implementer/tester identity, commands, or evidence criteria');
      if (task.approved_authority_hash !== nextState.authority_hash) fail('task authority drift after approval', EXIT.blocked);
      const authorities = loadRecord('task-authorities.json'); const authority = authorities.tasks.find((entry) => entry.task_id === task.task_id);
      if (!authority || task.task_authority_hash !== sha256(authority)) fail('task is not bound to its exact approved authority entry', EXIT.blocked);
      for (const key of ['commands', 'allowed_tools', 'forbidden_tools']) if (canonical(task[key] || []) !== canonical(authority[key] || [])) fail(`task ${key} differs from its approved authority entry`, EXIT.blocked);
      tasks = { ...tasks, tasks: [...tasks.tasks, { ...task, status: 'registered' }] }; assertDag(tasks.tasks);
      if (tasks.tasks.length > LIMITS.implementation_tasks) fail('implementation task limit exceeded', EXIT.blocked);
      nextState = { ...nextState, counters: { ...nextState.counters, implementation_tasks: tasks.tasks.length, delegations: new Set(tasks.tasks.map((item) => item.delegation_id)).size } };
      for (const [name, count] of Object.entries(nextState.counters)) if (LIMITS[name] !== undefined && count > LIMITS[name]) fail(`${name} limit exceeded`, EXIT.blocked);
    } else {
      const index = tasks.tasks.findIndex((item) => item.task_id === id); if (index < 0) fail('unknown task');
      const task = { ...tasks.tasks[index] };
      if (action === 'start') {
        if (task.status !== 'registered') fail('task is not registered', EXIT.blocked);
        if (!(task.dependencies || []).every((dependency) => tasks.tasks.find((item) => item.task_id === dependency)?.status === 'complete')) fail('task dependencies are incomplete', EXIT.blocked);
        task.status = 'started'; task.started_at = isoNow(); if (nextState.state === 'approved') nextState = transition(nextState, 'implementing');
      } else if (action === 'retry' || action === 'fallback') {
        const failed = Object.entries(manifest(path).files).filter(([name]) => name.startsWith('receipts/command-')).map(([name]) => loadRecord(name)).some((receipt) => receipt.task_id === task.task_id && receipt.outcome === 'fail');
        if (!failed || task.status !== 'started') fail(`${action} requires a failed started task`, EXIT.blocked);
        if (action === 'retry') {
          const nextCount = nextState.counters.retries + 1;
          if (nextCount > LIMITS.retries) { nextState = transition(nextState, 'blocked'); transaction(path, { 'run-state.json': nextState }, 'task.retry.exhausted', { task_id: id }); fail('retry limit exhausted', EXIT.blocked); }
          nextState = { ...nextState, counters: { ...nextState.counters, retries: nextCount } };
        } else {
          const authorityFile = safeRelative(String(cli.get('authority-file', true))); const user = String(cli.get('user', true));
          const revised = json(authorityFile); const authority = revised.tasks?.find((entry) => entry.task_id === id);
          if (!authority || !Array.isArray(authority.commands) || !Array.isArray(authority.allowed_tools) || !Array.isArray(authority.forbidden_tools)) fail('fallback requires a complete revised authority entry');
          const sealed = loadRecord('task-authorities.json');
          const sealedIds = (sealed.tasks || []).map((entry) => entry.task_id).sort(); const revisedIds = (revised.tasks || []).map((entry) => entry.task_id).sort();
          if (canonical(sealedIds) !== canonical(revisedIds) || new Set(revisedIds).size !== revisedIds.length) fail('fallback authority revision must revise the complete sealed task set without adding or removing tasks', EXIT.blocked);
          const priorHash = nextState.authority_hash; const revisedHash = sha256(revised);
          if (revisedHash === priorHash) fail('fallback authority revision must change the sealed set', EXIT.blocked);
          task.approved_authority_hash = revisedHash; task.task_authority_hash = sha256(authority);
          task.commands = authority.commands; task.allowed_tools = authority.allowed_tools; task.forbidden_tools = authority.forbidden_tools;
          nextState = { ...nextState, authority_hash: revisedHash, counters: { ...nextState.counters, delegations: nextState.counters.delegations + 1 } };
          if (nextState.counters.delegations > LIMITS.delegations) fail('delegation limit exhausted', EXIT.blocked);
          const approval = { contract_version: CONTRACT, receipt_type: 'authority-revision', receipt_id: receiptId('approval-authority', { priorHash, revisedHash }), run_id: runId(), user, revision: nextState.counters.delegations, displayed_content_hash: revisedHash, authority_hash: revisedHash, prior_authority_hash: priorHash, confirmed_at: isoNow(), target: 'task-authorities.json' };
          fallbackChanges = { 'task-authorities.json': revised, [receiptName('approval-authority', approval.receipt_id)]: approval };
          fallbackEvent = { prior_authority_hash: priorHash, authority_hash: revisedHash, authority_revision_receipt: approval.receipt_id };
          revisedAuthorities = new Map(revised.tasks.map((entry) => [entry.task_id, entry]));
        }
        task.last_recovery = action; task.last_recovery_at = isoNow();
      } else {
        if (task.status !== 'started') fail('task is not started', EXIT.blocked);
        const receipts = (task.acceptance_evidence || []).map((criterion) => commandReceipts(path, task.task_id, criterion).at(-1)).filter(Boolean);
        if (receipts.length !== task.acceptance_evidence.length) fail('missing receipt for an acceptance criterion', EXIT.blocked);
        if (receipts.some((receipt) => receipt.outcome !== 'pass')) fail('task completion evidence is not passing', EXIT.blocked);
        task.status = 'complete'; task.completed_at = isoNow(); task.evidence_hashes = receipts.map((receipt) => sha256(receipt));
      }
      let copy = revisedAuthorities ? tasks.tasks.map((item) => {
        const entry = revisedAuthorities.get(item.task_id);
        return { ...item, approved_authority_hash: nextState.authority_hash, task_authority_hash: sha256(entry), commands: entry.commands, allowed_tools: entry.allowed_tools, forbidden_tools: entry.forbidden_tools };
      }) : [...tasks.tasks];
      copy[index] = task; tasks = { ...tasks, tasks: copy };
    }
    transaction(path, { 'tasks.json': tasks, 'run-state.json': nextState, ...(fallbackChanges || {}) }, `task.${action}`, { task_id: action === 'register' ? cli.get('id') : id, ...fallbackEvent });
    output({ task_id: action === 'register' ? cli.get('id') : id, status: tasks.tasks.find((item) => item.task_id === (action === 'register' ? cli.get('id') : id)).status });
  });
}

function reviewRepair() {
  const path = runRoot(); const reason = String(cli.get('reason', true));
  locked(() => {
    const current = state(); const review = loadRecord('review.json');
    if (review.verdict !== 'fail' || current.state !== 'implementing') fail('review repair requires a failed review during implementation', EXIT.blocked);
    const count = current.counters.fix_review_cycles + 1;
    if (count > LIMITS.fix_review_cycles) { const blocked = transition(current, 'blocked'); transaction(path, { 'run-state.json': blocked }, 'review.repair.exhausted', { reason }); fail('repair-review limit exhausted', EXIT.blocked); }
    const next = { ...current, counters: { ...current.counters, fix_review_cycles: count } };
    transaction(path, { 'run-state.json': next }, 'review.repair', { reason, review_receipt_id: review.receipt_id }); output({ repair_cycle: count });
  });
}

function evidenceExec() {
  const path = runRoot(); const taskId = String(cli.get('task', true)); const commandId = String(cli.get('command', true));
  // The reservation is the run lock itself: retain it from authoritative-state
  // lookup through receipt commit.  A killed process leaves the O_EXCL marker,
  // deliberately blocking recovery rather than permitting duplicate execution.
  return locked(() => {
  const tasks = loadTasks(); const task = tasks.tasks.find((item) => item.task_id === taskId); if (!task || task.status !== 'started') fail('evidence command requires a started task', EXIT.blocked);
  const approved = task.commands.find((command) => command.command_id === commandId); if (!approved || !Array.isArray(approved.argv) || approved.argv.length === 0) fail('command is not in the approved argv set', EXIT.blocked);
  if (protectedCommand(approved.argv, task.forbidden_tools || [])) fail('protected, destructive, install, network, or forbidden command denied: no active host approval capability is observable', EXIT.blocked);
  if (cli.flags.has('--')) fail('evidence exec does not accept narrated or replacement argv', EXIT.blocked);
  const cwd = approved.cwd || '.'; const cwdPath = safeDirectory(cwd);
  const priorReceipts = commandReceipts(path, taskId, commandId); const latest = priorReceipts.at(-1);
  if (latest?.outcome === 'pass') fail('passing evidence is immutable; repeat execution is not authorized', EXIT.blocked);
  if (latest && (!task.last_recovery_at || task.last_recovery_at <= latest.ended_at)) fail('another attempt requires an authorized retry or fallback', EXIT.blocked);
  const attempt = priorReceipts.length + 1; const startedAt = isoNow(); const implementationSha = gitText('rev-parse', 'HEAD'); const statusBefore = gitText('status', '--porcelain=v1', '-z', '--untracked-files=all');
  const minimalEnv = { PATH: process.env.PATH || '', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
  for (const key of ['SystemRoot', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP']) if (process.env[key]) minimalEnv[key] = process.env[key];
  const result = spawnSync(approved.argv[0], approved.argv.slice(1), { cwd: cwdPath, shell: false, encoding: 'utf8', windowsHide: true, env: minimalEnv, timeout: Number(approved.timeout_ms || 300000), maxBuffer: 16 * 1024 * 1024 });
  const endedAt = isoNow(); const stdout = result.stdout || ''; const stderr = result.stderr || '';
  const excerpt = (result.status === 0 ? '' : stderr || stdout).replaceAll(root, '<repo>').replace(/(?:token|password|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=<redacted>').slice(0, 2048);
  const counts = approved.kind === 'test' ? {
    passed: Number((stdout.match(/\b(?:passed|pass(?:ed)?)\b/gi) || []).length),
    failed: Number((`${stdout}\n${stderr}`.match(/\b(?:failed|failure)\b/gi) || []).length),
  } : null;
  const receiptId = `${taskId}-${commandId}-${randomUUID()}-${Date.now().toString(36)}`;
  const receipt = {
    contract_version: CONTRACT, receipt_type: 'command', receipt_id: receiptId, run_id: runId(), task_id: taskId,
    command_id: commandId, argv: approved.argv, cwd, implementation_sha: implementationSha, tester_delegation_id: task.tester_delegation_id, attempt,
    started_at: startedAt, ended_at: endedAt, exit_code: result.status ?? 127,
    outcome: result.status === 0 && gitText('rev-parse', 'HEAD') === implementationSha && gitText('status', '--porcelain=v1', '-z', '--untracked-files=all') === statusBefore ? 'pass' : 'fail', test_counts: counts,
    stdout_sha256: sha256(stdout), stderr_sha256: sha256(stderr), failure_excerpt: excerpt,
  };
  transaction(path, { [receiptName('command', receiptId)]: receipt }, 'evidence.exec', { receipt_id: receiptId, outcome: receipt.outcome, exit_code: receipt.exit_code, task_id: taskId, command_id: commandId });
  output({ receipt: receiptName('command', receiptId), ...receipt });
  if (receipt.outcome !== 'pass') process.exitCode = EXIT.internal;
  });
}

function reviewRecord() {
  const path = runRoot(); const file = safeRelative(String(cli.get('file', true))); const review = json(file); assertV2(review, 'review');
  return locked(() => {
  const required = ['implementer_delegation_ids', 'tester_delegation_id', 'reviewer_delegation_id', 'reviewed_sha', 'input_hashes', 'verdict', 'evidence_ids', 'findings'];
  if (required.some((key) => review[key] === undefined)) fail('review receipt is incomplete');
  const identities = [...review.implementer_delegation_ids, review.tester_delegation_id, review.reviewer_delegation_id];
  if (identities.some((id) => !id) || new Set(identities).size !== identities.length) fail('implementer, tester, and reviewer delegation IDs must be observable and distinct', EXIT.blocked);
  if (review.reviewed_sha !== gitText('rev-parse', 'HEAD')) fail('review is stale or for another commit', EXIT.blocked);
  if (!['pass', 'fail'].includes(review.verdict)) fail('invalid review verdict');
  const tasks = loadTasks(); const receipts = Object.entries(manifest(path).files).filter(([name]) => name.startsWith('receipts/command-')).map(([name]) => loadRecord(name));
  const implementers = [...new Set(tasks.tasks.map((task) => task.delegation_id))].sort();
  if (canonical([...review.implementer_delegation_ids].sort()) !== canonical(implementers)) fail('review implementer identities do not match registered task provenance', EXIT.blocked);
  const testers = [...new Set(receipts.map((item) => item.tester_delegation_id))];
  if (testers.length !== 1 || testers[0] !== review.tester_delegation_id) fail('review tester identity does not match command receipt provenance', EXIT.blocked);
  const runState = state();
  const rules = existsSync(join(root, 'AGENTS.md')) ? readFileSync(join(root, 'AGENTS.md')) : Buffer.from('');
  const implementationDiff = git(['diff', '--binary', `${runState.base_sha}..${review.reviewed_sha}`]).stdout;
  const expectedInputs = { intent: sha256(loadRecord('intent.json')), plan: sha256(readFileSync(recordPath(path, 'plan.md'))), authorities: sha256(loadRecord('task-authorities.json')), tasks: sha256(loadRecord('tasks.json')), rules: sha256(rules), implementation_diff: sha256(implementationDiff) };
  for (const receipt of receipts) expectedInputs[`receipt:${receipt.receipt_id}`] = sha256(receipt);
  if (canonical(review.input_hashes) !== canonical(expectedInputs)) fail('review input hashes do not match authoritative inputs and evidence', EXIT.blocked);
  if (canonical([...review.evidence_ids].sort()) !== canonical(receipts.map((item) => item.receipt_id).sort())) fail('review evidence IDs do not match command receipts', EXIT.blocked);
  if (review.verdict === 'pass' && review.findings.some((finding) => finding.severity === 'P0' || finding.severity === 'P1')) fail('PASS review cannot contain P0 or P1 findings', EXIT.blocked);
  const receipt = { ...review, receipt_type: 'review', run_id: runId(), recorded_at: isoNow(), receipt_id: receiptId('review') };
  transaction(path, { [receiptName('review', receipt.receipt_id)]: receipt, 'review.json': receipt }, 'review.record', { receipt_id: receipt.receipt_id, verdict: receipt.verdict, run_id: runId(), reviewed_sha: receipt.reviewed_sha });
  output(receipt); if (receipt.verdict !== 'pass') process.exitCode = EXIT.internal;
  });
}

function prepareArtifacts() {
  const file = safeRelative(String(cli.get('file', true))); const input = json(file); if (!Array.isArray(input.paths) || input.paths.length === 0) fail('artifact input requires paths');
  const entries = input.paths.map((path) => {
    const target = safeRelative(path); const tracked = git(['ls-files', '--error-unmatch', '--', path], { allowFailure: true }).status === 0;
    if (!tracked) fail(`artifact is untracked: ${path}`, EXIT.blocked);
    const blob = gitText('rev-parse', `HEAD:${path}`); const owning = gitText('log', '-1', '--format=%H', '--', path);
    return { path, sha256: sha256(readFileSync(target)), git_blob_id: blob, owning_commit: owning, file_type: 'regular' };
  });
  const value = { contract_version: CONTRACT, run_id: runId(), artifacts: entries };
  locked(() => transaction(runRoot(), { 'artifact-manifest.json': value }, 'artifacts.record', { count: entries.length })); output(value);
}

function handoffPrepare() {
  const path = runRoot(); const residual = String(cli.get('residual-risk') || 'None recorded.');
  locked(() => {
    fail('release readiness is unavailable: native host identity and effect-approval attestation are unobservable', EXIT.unavailable);
    let nextState = state(); const tasks = loadTasks();
    if (nextState.state !== 'implementing' || tasks.tasks.length === 0 || tasks.tasks.some((task) => task.status !== 'complete')) fail('handoff requires all approved tasks complete', EXIT.blocked);
    const review = loadRecord('review.json'); if (review.verdict !== 'pass') fail('handoff requires passing independent review', EXIT.blocked);
    const candidate = review.reviewed_sha; if (candidate !== gitText('rev-parse', 'HEAD')) fail('product changed after review; a new review is required', EXIT.blocked);
    if (!manifest(path).files['artifact-manifest.json']) fail('artifact manifest is required', EXIT.blocked);
    nextState = transition(nextState, 'verifying'); nextState = transition(nextState, 'release_ready');
    const content = `# Raw to Release handoff\n\n## Candidate\n\nVerified implementation SHA: \`${candidate}\`. The final handoff commit is reported by the parent after read-only validation.\n\n## Intent and plan\n\nImmutable intent and plan approval receipts are in this run.\n\n## Verification\n\nApproved command receipts were produced by r2rctl.\n\n## Independent review\n\nReview receipt \`${review.receipt_id}\` returned PASS.\n\n## Artifacts\n\nSee \`artifact-manifest.json\`.\n\n## Residual risks\n\n${residual}\n\n## Protected effects\n\nNo merge, push, PR creation, deployment, publication, or plugin submission was performed.\n`;
    markdownSections(content, HANDOFF_SECTIONS, 'handoff');
    const commandReceipts = Object.keys(manifest(path).files).filter((name) => name.startsWith('receipts/command-'));
    const verification = { contract_version: CONTRACT, run_id: runId(), implementation_sha: candidate, command_receipts: commandReceipts, review_receipt: receiptName('review', review.receipt_id), outcome: 'pass' };
    transaction(path, { 'handoff.md': content, 'verification.json': verification, 'run-state.json': nextState }, 'handoff.prepare', { implementation_sha: candidate });
    output({ prepared: true, implementation_sha: candidate, state: nextState.state });
  });
}

function validateManifest(path, { rejectOrphans = false } = {}) {
  const value = manifest(path); assertV2(value, 'run manifest');
  if (!Number.isInteger(value.generation) || value.generation < 1) fail('invalid manifest generation', EXIT.invalid);
  rejectSymlinkComponents(join(path, 'generations'), path); rejectSymlinkComponents(join(path, '.staging'), path);
  const active = generationRoot(path, value.generation); rejectSymlinkComponents(active, path);
  if (!existsSync(active) || lstatSync(active).isSymbolicLink() || !statSync(active).isDirectory()) fail('missing active generation', EXIT.invalid);
  if (rejectOrphans) {
    const staging = join(path, '.staging');
    if (existsSync(staging) && lstatSync(staging).isDirectory()) {
      // An interrupted staging write must be investigated, never incorporated.
      if (readdirSync(staging).length) fail('orphan staged generation', EXIT.invalid);
    }
    const generations = readdirSync(join(path, 'generations'));
    if (generations.some((entry) => !/^\d+$/.test(entry) || Number(entry) > value.generation)) fail('orphan or ambiguous generation', EXIT.invalid);
  }
  for (const [name, expected] of Object.entries(value.files)) {
    const full = join(active, name); const rel = relative(active, full);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !existsSync(full) || lstatSync(full).isSymbolicLink() || !statSync(full).isFile()) fail(`invalid authoritative artifact: ${name}`, EXIT.invalid);
    const bytes = readFileSync(full); if (sha256(bytes) !== expected.sha256 || bytes.length !== expected.bytes || expected.type !== 'regular') fail(`authoritative artifact hash mismatch: ${name}`, EXIT.invalid);
  }
  const listed = new Set(Object.keys(value.files));
  function walk(directory, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name; const full = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`symlink in active generation: ${name}`, EXIT.invalid);
      if (entry.isDirectory()) walk(full, name);
      else if (!entry.isFile() || !listed.has(name)) fail(`unlisted authoritative generation entry: ${name}`, EXIT.invalid);
    }
  }
  walk(active);
  events(path);
  return value;
}

function reconstruct(log) {
  const history = ['intake']; const counters = { delegations: 0, concurrent_agents: 0, implementation_tasks: 0, fix_review_cycles: 0, retries: 0 };
  const confirmed = new Set(); const implementers = new Set();
  for (const event of log) {
    if (event.type === 'intent.confirm') { confirmed.add(event.data.dot); if (confirmed.size === DOTS.length && history.at(-1) === 'intake') history.push('intent_confirmed'); }
    else if (event.type === 'plan.approve') history.push('planned', 'approved');
    else if (event.type === 'plan.reject') history.push('intent_confirmed');
    else if (event.type === 'task.register') counters.implementation_tasks += 1;
    else if (event.type === 'task.start' && history.at(-1) === 'approved') history.push('implementing');
    else if (event.type === 'task.retry') counters.retries += 1;
    else if (event.type === 'review.repair') counters.fix_review_cycles += 1;
    else if (event.type === 'handoff.prepare') history.push('verifying', 'release_ready');
    else if (event.type === 'run.abort') history.push('aborted');
    else if (event.type === 'run.block' || event.type.endsWith('.exhausted')) { if (!['blocked', 'aborted', 'release_ready'].includes(history.at(-1))) history.push('blocked'); }
  }
  return { history, counters, implementers };
}

function validateRun() {
  ensureRoot(); const path = runRoot(); const before = gitText('status', '--porcelain=v1', '-z', '--untracked-files=all');
  const runState = state(); assertV2(runState, 'run state'); const authoritative = validateManifest(path, { rejectOrphans: true });
  const log = events(path); if (!log.length || log[0].type !== 'run.init' || log.some((event, index) => event.sequence !== index + 1 || event.data?.run_id && event.data.run_id !== runId())) fail('event sequence or run binding is invalid', EXIT.invalid);
  const rebuilt = reconstruct(log);
  // Every object named by the manifest must belong to this run where it carries
  // a run identifier; hashes are checked before parsing, so re-hashing only one
  // record cannot bypass this cross-link reconstruction.
  for (const name of Object.keys(authoritative.files)) if (name.endsWith('.json') && name !== 'events.json') {
    const value = json(recordPath(path, name)); if (value.run_id !== undefined && value.run_id !== runId()) fail(`cross-run authoritative record: ${name}`, EXIT.invalid);
  }
  if (runState.history.at(-1) !== runState.state) fail('state/history disagreement');
  for (const [prior, next] of runState.history.slice(1).map((value, index) => [runState.history[index], value])) if (!TRANSITIONS[prior]?.includes(next)) fail(`invalid lifecycle transition ${prior} -> ${next}`);
  for (const [name, count] of Object.entries(runState.counters)) if (LIMITS[name] !== undefined && count > LIMITS[name]) fail(`${name} counter overflow`, EXIT.blocked);
  const intent = loadRecord('intent.json'); assertV2(intent, 'intent'); if (intent.confirmation_state !== 'confirmed' || !DOTS.every((dot) => intent.dots[dot]?.confirmed)) fail('intent is not fully confirmed', EXIT.blocked);
  for (const dot of DOTS) {
    const item = intent.dots[dot]; const proposal = loadRecord(`proposals/${dot}-r${item.revision}.json`);
    if (proposal.run_id !== runId() || proposal.content_hash !== item.content_hash || proposal.value !== item.value) fail(`intent proposal cross-link mismatch: ${dot}`, EXIT.invalid);
    const event = [...log].reverse().find((entry) => entry.type === 'intent.confirm' && entry.data.dot === dot && entry.data.revision === item.revision);
    const approval = Object.keys(authoritative.files).filter((name) => name.startsWith(`receipts/approval-intent-${dot}-r${item.revision}`)).map((name) => loadRecord(name)).find((receipt) => receipt.receipt_id === event?.data.receipt_id);
    if (!approval || approval.run_id !== runId() || approval.displayed_content_hash !== item.content_hash) fail(`intent approval membership mismatch: ${dot}`, EXIT.invalid);
  }
  const tasks = loadTasks(); assertV2(tasks, 'tasks'); assertDag(tasks.tasks);
  rebuilt.counters.delegations = new Set(tasks.tasks.map((task) => task.delegation_id)).size + log.filter((event) => event.type === 'authority.revise').length;
  if (canonical(runState.history) !== canonical(rebuilt.history)) fail('state history is not reconstructible from events', EXIT.invalid);
  for (const field of ['delegations', 'implementation_tasks', 'fix_review_cycles', 'retries']) if (runState.counters[field] !== rebuilt.counters[field]) fail(`counter is not reconstructible from events: ${field}`, EXIT.invalid);
  if (tasks.tasks.some((task) => task.approved_authority_hash !== runState.authority_hash)) fail('post-approval authority drift', EXIT.blocked);
  if (runState.authority_hash) {
    const authorities = loadRecord('task-authorities.json'); if (sha256(authorities) !== runState.authority_hash) fail('authority content hash mismatch', EXIT.invalid);
    for (const task of tasks.tasks) { const entry = authorities.tasks.find((item) => item.task_id === task.task_id); if (!entry || task.task_authority_hash !== sha256(entry)) fail(`task authority cross-link mismatch: ${task.task_id}`, EXIT.invalid); }
  }
  if (['approved', 'implementing', 'verifying', 'release_ready'].includes(runState.state)) {
    const plan = readFileSync(recordPath(path, 'plan.md'), 'utf8'); const planHash = sha256(plan); const authorities = loadRecord('task-authorities.json');
    const approvals = Object.keys(authoritative.files).filter((name) => name.startsWith('receipts/approval-plan-') && !name.includes('rejection')).map((name) => loadRecord(name));
    const planEvent = [...log].reverse().find((event) => event.type === 'plan.approve');
    const matching = approvals.filter((receipt) => receipt.receipt_id === planEvent?.data.receipt_id && receipt.run_id === runId() && receipt.receipt_type === 'plan' && receipt.displayed_content_hash === planHash && receipt.authority_hash === sha256(authorities));
    if (matching.length !== 1) fail('plan approval receipt membership or hash mismatch', EXIT.invalid);
  }
  if (runState.protected_effects_performed.length) fail('protected effect recorded without active host approval', EXIT.blocked);
  let releaseReady = false;
  if (runState.state === 'release_ready') {
    const branch = gitText('branch', '--show-current'); if (branch !== `r2r/${runId()}`) fail('wrong release branch', EXIT.blocked);
    if (!cleanWorktree()) fail('release candidate worktree is dirty', EXIT.blocked);
    for (const required of ['plan.md', 'task-authorities.json', 'review.json', 'artifact-manifest.json', 'handoff.md', 'verification.json']) if (!manifest(path).files[required]) fail(`missing authoritative record: ${required}`, EXIT.blocked);
    markdownSections(readFileSync(recordPath(path, 'plan.md'), 'utf8'), PLAN_SECTIONS, 'plan'); markdownSections(readFileSync(recordPath(path, 'handoff.md'), 'utf8'), HANDOFF_SECTIONS, 'handoff');
    const review = loadRecord('review.json'); const identities = [...review.implementer_delegation_ids, review.tester_delegation_id, review.reviewer_delegation_id];
    if (review.verdict !== 'pass' || new Set(identities).size !== identities.length) fail('independent review gate failed', EXIT.blocked);
    if (git(['merge-base', '--is-ancestor', review.reviewed_sha, 'HEAD'], { allowFailure: true }).status !== 0) fail('reviewed commit ancestry is invalid', EXIT.blocked);
    const allowedPrefix = `.raw-to-release/runs/${runId()}/`;
    const changedAfterReview = gitText('diff', '--name-only', `${review.reviewed_sha}..HEAD`).split(/\r?\n/).filter(Boolean);
    if (changedAfterReview.some((name) => !name.replaceAll('\\', '/').startsWith(allowedPrefix))) fail('product changed after independent review', EXIT.blocked);
    const tracked = git(['ls-files', '--error-unmatch', '--', relative(root, path).replaceAll('\\', '/')], { allowFailure: true }).status === 0;
    if (!tracked) fail('authoritative run artifacts are untracked', EXIT.blocked);
    for (const task of tasks.tasks) for (const criterion of task.acceptance_evidence || []) {
      const receipt = commandReceipts(path, task.task_id, criterion).at(-1);
      if (!receipt) fail(`missing command receipt: ${criterion}`, EXIT.blocked);
      if (receipt.receipt_type !== 'command' || receipt.outcome !== 'pass' || receipt.exit_code !== 0 || receipt.implementation_sha !== review.reviewed_sha) fail(`stale or fabricated latest evidence: ${criterion}`, EXIT.blocked);
      const approved = task.commands.find((command) => command.command_id === receipt.command_id); if (!approved || canonical(approved.argv) !== canonical(receipt.argv)) fail(`receipt argv differs from approval: ${criterion}`, EXIT.blocked);
    }
    const artifactManifest = loadRecord('artifact-manifest.json');
    for (const artifact of artifactManifest.artifacts) {
      const target = safeRelative(artifact.path); if (sha256(readFileSync(target)) !== artifact.sha256) fail(`artifact hash mismatch: ${artifact.path}`, EXIT.blocked);
      if (gitText('rev-parse', `HEAD:${artifact.path}`) !== artifact.git_blob_id) fail(`artifact Git blob mismatch: ${artifact.path}`, EXIT.blocked);
      if (git(['merge-base', '--is-ancestor', artifact.owning_commit, 'HEAD'], { allowFailure: true }).status !== 0) fail(`artifact owning commit is not an ancestor: ${artifact.path}`, EXIT.blocked);
    }
    const verification = loadRecord('verification.json');
    if (verification.run_id !== runId() || verification.implementation_sha !== review.reviewed_sha || verification.review_receipt !== receiptName('review', review.receipt_id) || verification.outcome !== 'pass') fail('verification record cross-link mismatch', EXIT.blocked);
    releaseReady = true;
  }
  const after = gitText('status', '--porcelain=v1', '-z', '--untracked-files=all'); if (before !== after) fail('read-only validation mutated the repository', EXIT.internal);
  output({ valid: true, release_ready: releaseReady, run_id: runId(), implementation_sha: manifest(path).files['review.json'] ? loadRecord('review.json').reviewed_sha : null, final_sha: gitText('rev-parse', 'HEAD') });
}

function auditV1() {
  ensureRoot(); const path = runRoot(); const before = sha256(Buffer.concat(Object.keys(manifest(path).files || {}).sort().filter((name) => existsSync(join(path, name))).map((name) => readFileSync(join(path, name)))));
  const value = json(join(path, 'run-state.json')); if (!/^1\.[0-9]+\.[0-9]+$/.test(value.contract_version || '')) fail('audit-v1 accepts contract 1.x only');
  if (!Array.isArray(value.history) || value.history.at(-1) !== value.state) fail('v1 state/history disagreement');
  const after = sha256(Buffer.concat(Object.keys(manifest(path).files || {}).sort().filter((name) => existsSync(join(path, name))).map((name) => readFileSync(join(path, name)))));
  if (before !== after) fail('audit-v1 mutated legacy state', EXIT.internal);
  output({ audit_only: true, resumable: false, migratable: false, contract_version: value.contract_version, run_id: value.run_id });
}

function help() {
  output({ name: 'r2rctl', version: VERSION, node: '>=22', exits: EXIT, commands: ['preflight', 'run init|abort|block', 'intent propose|confirm', 'plan approve|reject', 'task register|start|complete|retry|fallback', 'evidence exec', 'review record|repair', 'artifacts record', 'handoff prepare', 'validate', 'audit-v1'] });
}

function dispatch() {
  const [command, action] = cli.positional;
  if (!command || command === 'help' || cli.flags.has('--help')) return help();
  if (command === 'preflight') return preflight();
  if (command === 'run' && action === 'init') return runInit();
  if (command === 'intent' && action === 'propose') return intentPropose();
  if (command === 'intent' && action === 'confirm') return intentConfirm();
  if (command === 'plan' && action === 'approve') return planApprove();
  if (command === 'plan' && action === 'reject') return planReject();
  if (command === 'run' && ['abort', 'block'].includes(action)) return runTerminal(action);
  if (command === 'task' && ['register', 'start', 'complete', 'retry', 'fallback'].includes(action)) return taskCommand(action);
  if (command === 'evidence' && action === 'exec') return evidenceExec();
  if (command === 'review' && action === 'record') return reviewRecord();
  if (command === 'review' && action === 'repair') return reviewRepair();
  if (command === 'artifacts' && action === 'record') return prepareArtifacts();
  if (command === 'handoff' && action === 'prepare') return handoffPrepare();
  if (command === 'validate') return validateRun();
  if (command === 'audit-v1') return auditV1();
  fail('unknown command');
}

try { dispatch(); }
catch (error) {
  if (error instanceof R2RError) { console.error(`r2rctl: ${error.message}`); process.exit(error.code); }
  console.error(`r2rctl: unexpected internal failure: ${error?.stack || error}`); process.exit(EXIT.internal);
}
