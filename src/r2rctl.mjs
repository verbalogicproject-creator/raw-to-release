#!/usr/bin/env node
/* Raw to Release v0.1.1: dependency-free Node 22 state and evidence runtime. */
import {
  closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync,
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
  approved: ['implementing', 'blocked', 'aborted'],
  implementing: ['verifying', 'blocked', 'aborted'],
  verifying: ['release_ready', 'implementing', 'blocked', 'aborted'],
  release_ready: [], blocked: [], aborted: [],
};
const LIMITS = { delegations: 12, concurrent_agents: 3, implementation_tasks: 8, fix_review_cycles: 2, retries: 1 };
const PLAN_SECTIONS = ['Scope', 'Architecture', 'Affected areas', 'Tests', 'Risks', 'Exclusions', 'Task authorities'];
const HANDOFF_SECTIONS = ['Candidate', 'Intent and plan', 'Verification', 'Independent review', 'Artifacts', 'Residual risks', 'Protected effects'];

class R2RError extends Error { constructor(message, code = EXIT.invalid) { super(message); this.code = code; } }
const fail = (message, code = EXIT.invalid) => { throw new R2RError(message, code); };

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}
const sha256 = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
const isoNow = () => process.env.R2RCTL_TEST_TIME || new Date().toISOString();
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
const runId = () => String(cli.get('run', true));
const r2rRoot = () => join(root, '.raw-to-release');
const runsRoot = () => join(r2rRoot(), 'runs');
const runRoot = (required = true) => {
  const path = join(runsRoot(), runId());
  if (required && !existsSync(path)) fail(`run does not exist: ${runId()}`, EXIT.blocked);
  return path;
};
const runtimeRoot = () => join(r2rRoot(), 'runtime', runId());

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
  if (normalized.split('/').includes('..') || normalized.startsWith('/')) fail(`path escapes repository: ${path}`, EXIT.invalid);
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
  const path = join(runtimeRoot(), 'r2rctl.lock'); mkdirSync(dirname(path), { recursive: true });
  try { return { path, fd: openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600) }; }
  catch (error) { if (error.code === 'EEXIST') fail('run is locked by another operation', EXIT.blocked); throw error; }
}
function locked(action) {
  const lock = acquireLock();
  try { writeFileSync(lock.fd, `${process.pid}\n`); fsyncSync(lock.fd); return action(); }
  finally { closeSync(lock.fd); try { unlinkSync(lock.path); } catch { /* leave evidence of unexpected failure */ } }
}

function events(path) {
  const file = join(path, 'events.json');
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

function transaction(path, changes, eventType, eventData = {}) {
  const currentEvents = events(path);
  const prior = currentEvents.at(-1)?.event_hash || null;
  const body = { sequence: currentEvents.length + 1, at: isoNow(), type: eventType, data: eventData, prior_event_hash: prior };
  const nextEvents = [...currentEvents, { ...body, event_hash: sha256(body) }];
  const all = new Map(Object.entries(changes)); all.set('events.json', nextEvents);
  const current = manifest(path); const files = { ...current.files };
  for (const [name, value] of all) {
    if (name === 'run-manifest.json' || isAbsolute(name) || name.split('/').includes('..')) fail(`unsafe authoritative record name: ${name}`);
    const content = typeof value === 'string' ? value.replaceAll('\r\n', '\n') : `${canonical(value)}\n`;
    atomicWrite(join(path, name), content);
    files[name] = { sha256: sha256(content), bytes: Buffer.byteLength(content), type: 'regular' };
  }
  const next = { contract_version: CONTRACT, generation: current.generation + 1, files };
  atomicWrite(join(path, 'run-manifest.json'), `${canonical(next)}\n`); // commit point, always last
  return next;
}

function loadRecord(name) {
  const path = join(runRoot(), name);
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

function preflight() {
  ensureRoot();
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 22) fail(`Node 22 or newer is required; found ${process.versions.node}`, EXIT.unavailable);
  const identityVisibility = String(cli.get('delegation-ids') || 'unobservable');
  const capabilities = {
    contract_version: CONTRACT, node: process.versions.node, git: gitText('--version'),
    repository: '.', branch: gitText('branch', '--show-current'), sha: gitText('rev-parse', 'HEAD'),
    clean: cleanWorktree(), local_command_execution: 'verified', delegation_ids: identityVisibility,
    protected_effects: 'host-controlled',
  };
  if (!capabilities.clean) fail('existing repository worktree is dirty', EXIT.blocked);
  if (identityVisibility !== 'observable') fail('durable delegated-agent identities are unobservable', EXIT.unavailable);
  output(capabilities);
}

function runInit() {
  ensureRoot(); if (!cleanWorktree()) fail('run init requires a clean worktree', EXIT.blocked);
  const id = runId(); if (!/^\d{8}-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail('invalid run ID');
  const path = runRoot(false); if (existsSync(path)) fail('run already exists', EXIT.blocked);
  locked(() => {
    mkdirSync(path, { recursive: true });
    const value = {
      contract_version: CONTRACT, run_id: id, state: 'intake', history: ['intake'],
      created_at: isoNow(), updated_at: isoNow(), base_sha: gitText('rev-parse', 'HEAD'),
      branch: `r2r/${id}`, counters: { delegations: 0, concurrent_agents: 0, implementation_tasks: 0, fix_review_cycles: 0, retries: 0 },
      gates: {}, protected_effects_performed: [], authority_hash: null,
    };
    transaction(path, { 'run-state.json': value }, 'run.init', { run_id: id, base_sha: value.base_sha });
  });
  output({ run_id: id, state: 'intake', branch: `r2r/${id}` });
}

function intentPropose() {
  const dot = String(cli.get('dot', true)); if (!DOTS.includes(dot)) fail(`unknown Dot: ${dot}`);
  const value = String(cli.get('value', true)); const path = runRoot();
  locked(() => {
    const prior = existsSync(join(path, 'intent.json')) ? loadRecord('intent.json') : { contract_version: CONTRACT, run_id: runId(), dots: {}, confirmation_state: 'draft', privacy_acknowledged: true };
    assertV2(prior, 'intent'); if (prior.confirmation_state === 'confirmed') fail('confirmed intent is immutable', EXIT.blocked);
    const revision = (prior.dots[dot]?.revision || 0) + 1;
    const proposal = { contract_version: CONTRACT, run_id: runId(), dot, revision, value, content_hash: sha256(value), proposed_at: isoNow() };
    const next = { ...prior, dots: { ...prior.dots, [dot]: { revision, value, content_hash: proposal.content_hash, confirmed: false, confirmed_at: null } } };
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
    const confirmedAt = isoNow(); const receipt = { contract_version: CONTRACT, receipt_type: 'intent', user, revision, displayed_content_hash: displayedHash, confirmed_at: confirmedAt, target: `${dot}-r${revision}` };
    const dots = { ...current.dots, [dot]: { ...current.dots[dot], confirmed: true, confirmed_at: confirmedAt } };
    const allConfirmed = DOTS.every((name) => dots[name]?.confirmed);
    let nextIntent = { ...current, dots, confirmation_state: allConfirmed ? 'confirmed' : 'draft' };
    nextIntent = { ...nextIntent, intent_hash: sha256(DOTS.map((name) => dots[name])) };
    let nextState = state(); if (allConfirmed && nextState.state === 'intake') nextState = transition(nextState, 'intent_confirmed');
    transaction(path, { 'intent.json': nextIntent, 'run-state.json': nextState, [receiptName('approval-intent', `${dot}-r${revision}`)]: receipt }, 'intent.confirm', { dot, revision, displayedHash });
    output({ dot, revision, confirmed: true, intent_hash: nextIntent.intent_hash });
  });
}

function planApprove() {
  const path = runRoot(); const file = safeRelative(String(cli.get('file', true)));
  const authorityFile = safeRelative(String(cli.get('authority-file', true)));
  const user = String(cli.get('user', true)); const text = readFileSync(file, 'utf8').replaceAll('\r\n', '\n'); markdownSections(text, PLAN_SECTIONS, 'plan');
  const authorities = json(authorityFile); if (!Array.isArray(authorities.tasks) || authorities.tasks.length === 0 || authorities.tasks.length > LIMITS.implementation_tasks) fail('authority set must contain 1-8 tasks');
  const authorityHash = sha256(authorities); const planHash = sha256(text);
  locked(() => {
    const intent = loadRecord('intent.json'); if (intent.confirmation_state !== 'confirmed') fail('all five Dots must be confirmed', EXIT.blocked);
    let nextState = state(); if (nextState.state !== 'intent_confirmed') fail('plan approval is not allowed in the current state', EXIT.blocked);
    nextState = transition(transition(nextState, 'planned'), 'approved'); nextState.authority_hash = authorityHash;
    const receipt = { contract_version: CONTRACT, receipt_type: 'plan', user, revision: 1, displayed_content_hash: planHash, authority_hash: authorityHash, confirmed_at: isoNow(), target: 'plan.md' };
    transaction(path, { 'plan.md': text, 'task-authorities.json': authorities, 'run-state.json': nextState, [receiptName('approval-plan', planHash.slice(0, 16))]: receipt }, 'plan.approve', { plan_hash: planHash, authority_hash: authorityHash });
    output({ plan_hash: planHash, authority_hash: authorityHash, state: nextState.state });
  });
}

function loadTasks() { return existsSync(join(runRoot(), 'tasks.json')) ? loadRecord('tasks.json') : { contract_version: CONTRACT, run_id: runId(), tasks: [] }; }
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

function taskCommand(action) {
  const path = runRoot(); const id = String(cli.get('id', action !== 'register')); let tasks = loadTasks();
  locked(() => {
    let nextState = state();
    if (action === 'register') {
      const file = safeRelative(String(cli.get('file', true))); const task = json(file); assertV2(task, 'task');
      if (task.task_id !== String(cli.get('id', true))) fail('task ID does not match file');
      if (tasks.tasks.some((item) => item.task_id === task.task_id)) fail('duplicate task ID', EXIT.blocked);
      if (!task.delegation_id || !Array.isArray(task.commands) || !Array.isArray(task.acceptance_evidence)) fail('task lacks sealed identity, commands, or evidence criteria');
      if (task.approved_authority_hash !== nextState.authority_hash) fail('task authority drift after approval', EXIT.blocked);
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
      } else {
        if (task.status !== 'started') fail('task is not started', EXIT.blocked);
        const receipts = (task.acceptance_evidence || []).map((criterion) => {
          const entry = Object.keys(manifest(path).files).find((name) => name.startsWith('receipts/command-') && json(join(path, name)).task_id === task.task_id && json(join(path, name)).command_id === criterion);
          if (!entry) fail(`missing receipt for acceptance criterion: ${criterion}`, EXIT.blocked);
          return loadRecord(entry);
        });
        if (receipts.some((receipt) => receipt.outcome !== 'pass')) fail('task completion evidence is not passing', EXIT.blocked);
        task.status = 'complete'; task.completed_at = isoNow(); task.evidence_hashes = receipts.map((receipt) => sha256(receipt));
      }
      const copy = [...tasks.tasks]; copy[index] = task; tasks = { ...tasks, tasks: copy };
    }
    transaction(path, { 'tasks.json': tasks, 'run-state.json': nextState }, `task.${action}`, { task_id: action === 'register' ? cli.get('id') : id });
    output({ task_id: action === 'register' ? cli.get('id') : id, status: tasks.tasks.find((item) => item.task_id === (action === 'register' ? cli.get('id') : id)).status });
  });
}

function evidenceExec() {
  const path = runRoot(); const taskId = String(cli.get('task', true)); const commandId = String(cli.get('command', true));
  const tasks = loadTasks(); const task = tasks.tasks.find((item) => item.task_id === taskId); if (!task || task.status !== 'started') fail('evidence command requires a started task', EXIT.blocked);
  const approved = task.commands.find((command) => command.command_id === commandId); if (!approved || !Array.isArray(approved.argv) || approved.argv.length === 0) fail('command is not in the approved argv set', EXIT.blocked);
  if (cli.flags.has('--')) fail('evidence exec does not accept narrated or replacement argv', EXIT.blocked);
  const cwd = approved.cwd || '.'; let cwdPath = root;
  if (cwd !== '.') {
    if (isAbsolute(cwd) || cwd.replaceAll('\\', '/').split('/').includes('..')) fail('command cwd escapes repository', EXIT.blocked);
    cwdPath = resolve(root, cwd); if (!existsSync(cwdPath) || lstatSync(cwdPath).isSymbolicLink() || !statSync(cwdPath).isDirectory()) fail('approved command cwd is unavailable', EXIT.blocked);
  }
  const startedAt = isoNow(); const implementationSha = gitText('rev-parse', 'HEAD');
  const result = spawnSync(approved.argv[0], approved.argv.slice(1), { cwd: cwdPath, shell: false, encoding: 'utf8', windowsHide: true, timeout: Number(approved.timeout_ms || 300000), maxBuffer: 16 * 1024 * 1024 });
  const endedAt = isoNow(); const stdout = result.stdout || ''; const stderr = result.stderr || '';
  const excerpt = (result.status === 0 ? '' : stderr || stdout).replaceAll(root, '<repo>').replace(/(?:token|password|secret|api[_-]?key)\s*[=:]\s*\S+/gi, '$1=<redacted>').slice(0, 2048);
  const counts = approved.kind === 'test' ? {
    passed: Number((stdout.match(/\b(?:passed|pass(?:ed)?)\b/gi) || []).length),
    failed: Number((`${stdout}\n${stderr}`.match(/\b(?:failed|failure)\b/gi) || []).length),
  } : null;
  const receiptId = `${taskId}-${commandId}-${sha256(`${startedAt}:${implementationSha}`).slice(0, 12)}`;
  const receipt = {
    contract_version: CONTRACT, receipt_type: 'command', receipt_id: receiptId, run_id: runId(), task_id: taskId,
    command_id: commandId, argv: approved.argv, cwd, implementation_sha: implementationSha,
    started_at: startedAt, ended_at: endedAt, exit_code: result.status ?? 127,
    outcome: result.status === 0 ? 'pass' : 'fail', test_counts: counts,
    stdout_sha256: sha256(stdout), stderr_sha256: sha256(stderr), failure_excerpt: excerpt,
  };
  locked(() => transaction(path, { [receiptName('command', receiptId)]: receipt }, 'evidence.exec', { receipt_id: receiptId, outcome: receipt.outcome, exit_code: receipt.exit_code }));
  output({ receipt: receiptName('command', receiptId), ...receipt });
  if (receipt.outcome !== 'pass') process.exitCode = EXIT.internal;
}

function reviewRecord() {
  const path = runRoot(); const file = safeRelative(String(cli.get('file', true))); const review = json(file); assertV2(review, 'review');
  const required = ['implementer_delegation_ids', 'tester_delegation_id', 'reviewer_delegation_id', 'reviewed_sha', 'input_hashes', 'verdict', 'evidence_ids', 'findings'];
  if (required.some((key) => review[key] === undefined)) fail('review receipt is incomplete');
  const identities = [...review.implementer_delegation_ids, review.tester_delegation_id, review.reviewer_delegation_id];
  if (identities.some((id) => !id) || new Set(identities).size !== identities.length) fail('implementer, tester, and reviewer delegation IDs must be observable and distinct', EXIT.blocked);
  if (review.reviewed_sha !== gitText('rev-parse', 'HEAD')) fail('review is stale or for another commit', EXIT.blocked);
  if (!['pass', 'fail'].includes(review.verdict)) fail('invalid review verdict');
  const receipt = { ...review, receipt_type: 'review', run_id: runId(), recorded_at: isoNow(), receipt_id: sha256(review).slice(0, 24) };
  locked(() => transaction(path, { [receiptName('review', receipt.receipt_id)]: receipt, 'review.json': receipt }, 'review.record', { receipt_id: receipt.receipt_id, verdict: receipt.verdict }));
  output(receipt); if (receipt.verdict !== 'pass') process.exitCode = EXIT.internal;
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
    let nextState = state(); const tasks = loadTasks();
    if (nextState.state !== 'implementing' || tasks.tasks.length === 0 || tasks.tasks.some((task) => task.status !== 'complete')) fail('handoff requires all approved tasks complete', EXIT.blocked);
    const review = loadRecord('review.json'); if (review.verdict !== 'pass') fail('handoff requires passing independent review', EXIT.blocked);
    const candidate = review.reviewed_sha; if (git(['merge-base', '--is-ancestor', candidate, 'HEAD'], { allowFailure: true }).status !== 0) fail('reviewed candidate is not an ancestor of HEAD', EXIT.blocked);
    if (!existsSync(join(path, 'artifact-manifest.json'))) fail('artifact manifest is required', EXIT.blocked);
    nextState = transition(nextState, 'verifying'); nextState = transition(nextState, 'release_ready');
    const content = `# Raw to Release handoff\n\n## Candidate\n\nVerified implementation SHA: \`${candidate}\`. The final handoff commit is reported by the parent after read-only validation.\n\n## Intent and plan\n\nImmutable intent and plan approval receipts are in this run.\n\n## Verification\n\nApproved command receipts were produced by r2rctl.\n\n## Independent review\n\nReview receipt \`${review.receipt_id}\` returned PASS.\n\n## Artifacts\n\nSee \`artifact-manifest.json\`.\n\n## Residual risks\n\n${residual}\n\n## Protected effects\n\nNo merge, push, PR creation, deployment, publication, or plugin submission was performed.\n`;
    markdownSections(content, HANDOFF_SECTIONS, 'handoff');
    transaction(path, { 'handoff.md': content, 'run-state.json': nextState }, 'handoff.prepare', { implementation_sha: candidate });
    output({ prepared: true, implementation_sha: candidate, state: nextState.state });
  });
}

function validateManifest(path) {
  const value = manifest(path); assertV2(value, 'run manifest');
  for (const [name, expected] of Object.entries(value.files)) {
    const full = join(path, name); const rel = relative(path, full);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || !existsSync(full) || lstatSync(full).isSymbolicLink() || !statSync(full).isFile()) fail(`invalid authoritative artifact: ${name}`, EXIT.invalid);
    const bytes = readFileSync(full); if (sha256(bytes) !== expected.sha256 || bytes.length !== expected.bytes || expected.type !== 'regular') fail(`authoritative artifact hash mismatch: ${name}`, EXIT.invalid);
  }
  events(path);
  return value;
}

function validateRun() {
  ensureRoot(); const path = runRoot(); const before = gitText('status', '--porcelain=v1', '-z', '--untracked-files=all');
  const runState = state(); assertV2(runState, 'run state'); validateManifest(path);
  if (runState.history.at(-1) !== runState.state) fail('state/history disagreement');
  for (const [prior, next] of runState.history.slice(1).map((value, index) => [runState.history[index], value])) if (!TRANSITIONS[prior]?.includes(next)) fail(`invalid lifecycle transition ${prior} -> ${next}`);
  for (const [name, count] of Object.entries(runState.counters)) if (LIMITS[name] !== undefined && count > LIMITS[name]) fail(`${name} counter overflow`, EXIT.blocked);
  const intent = loadRecord('intent.json'); assertV2(intent, 'intent'); if (intent.confirmation_state !== 'confirmed' || !DOTS.every((dot) => intent.dots[dot]?.confirmed)) fail('intent is not fully confirmed', EXIT.blocked);
  const tasks = loadTasks(); assertV2(tasks, 'tasks'); assertDag(tasks.tasks);
  if (tasks.tasks.some((task) => task.approved_authority_hash !== runState.authority_hash)) fail('post-approval authority drift', EXIT.blocked);
  if (runState.protected_effects_performed.length) fail('protected effect recorded without active host approval', EXIT.blocked);
  let releaseReady = false;
  if (runState.state === 'release_ready') {
    const branch = gitText('branch', '--show-current'); if (branch !== `r2r/${runId()}`) fail('wrong release branch', EXIT.blocked);
    if (!cleanWorktree()) fail('release candidate worktree is dirty', EXIT.blocked);
    for (const required of ['plan.md', 'task-authorities.json', 'review.json', 'artifact-manifest.json', 'handoff.md']) if (!existsSync(join(path, required))) fail(`missing authoritative record: ${required}`, EXIT.blocked);
    markdownSections(readFileSync(join(path, 'plan.md'), 'utf8'), PLAN_SECTIONS, 'plan'); markdownSections(readFileSync(join(path, 'handoff.md'), 'utf8'), HANDOFF_SECTIONS, 'handoff');
    const review = loadRecord('review.json'); const identities = [...review.implementer_delegation_ids, review.tester_delegation_id, review.reviewer_delegation_id];
    if (review.verdict !== 'pass' || new Set(identities).size !== identities.length) fail('independent review gate failed', EXIT.blocked);
    if (git(['merge-base', '--is-ancestor', review.reviewed_sha, 'HEAD'], { allowFailure: true }).status !== 0) fail('reviewed commit ancestry is invalid', EXIT.blocked);
    const tracked = git(['ls-files', '--error-unmatch', '--', relative(root, path).replaceAll('\\', '/')], { allowFailure: true }).status === 0;
    if (!tracked) fail('authoritative run artifacts are untracked', EXIT.blocked);
    const receiptsDir = join(path, 'receipts');
    for (const task of tasks.tasks) for (const criterion of task.acceptance_evidence || []) {
      const receiptPath = Object.keys(manifest(path).files).find((name) => name.startsWith('receipts/command-') && json(join(path, name)).task_id === task.task_id && json(join(path, name)).command_id === criterion);
      if (!receiptPath) fail(`missing command receipt: ${criterion}`, EXIT.blocked);
      const receipt = loadRecord(receiptPath); if (receipt.receipt_type !== 'command' || receipt.outcome !== 'pass' || receipt.exit_code !== 0 || receipt.implementation_sha !== review.reviewed_sha) fail(`stale or fabricated evidence: ${criterion}`, EXIT.blocked);
      const approved = task.commands.find((command) => command.command_id === receipt.command_id); if (!approved || canonical(approved.argv) !== canonical(receipt.argv)) fail(`receipt argv differs from approval: ${criterion}`, EXIT.blocked);
    }
    if (!existsSync(receiptsDir)) fail('evidence receipts are missing', EXIT.blocked);
    const artifactManifest = loadRecord('artifact-manifest.json');
    for (const artifact of artifactManifest.artifacts) {
      const target = safeRelative(artifact.path); if (sha256(readFileSync(target)) !== artifact.sha256) fail(`artifact hash mismatch: ${artifact.path}`, EXIT.blocked);
      if (gitText('rev-parse', `HEAD:${artifact.path}`) !== artifact.git_blob_id) fail(`artifact Git blob mismatch: ${artifact.path}`, EXIT.blocked);
      if (git(['merge-base', '--is-ancestor', artifact.owning_commit, 'HEAD'], { allowFailure: true }).status !== 0) fail(`artifact owning commit is not an ancestor: ${artifact.path}`, EXIT.blocked);
    }
    releaseReady = true;
  }
  const after = gitText('status', '--porcelain=v1', '-z', '--untracked-files=all'); if (before !== after) fail('read-only validation mutated the repository', EXIT.internal);
  output({ valid: true, release_ready: releaseReady, run_id: runId(), implementation_sha: existsSync(join(path, 'review.json')) ? loadRecord('review.json').reviewed_sha : null, final_sha: gitText('rev-parse', 'HEAD') });
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
  output({ name: 'r2rctl', version: VERSION, node: '>=22', exits: EXIT, commands: ['preflight', 'run init', 'intent propose|confirm', 'plan approve', 'task register|start|complete', 'evidence exec', 'review record', 'artifacts record', 'handoff prepare', 'validate', 'audit-v1'] });
}

function dispatch() {
  const [command, action] = cli.positional;
  if (!command || command === 'help' || cli.flags.has('--help')) return help();
  if (command === 'preflight') return preflight();
  if (command === 'run' && action === 'init') return runInit();
  if (command === 'intent' && action === 'propose') return intentPropose();
  if (command === 'intent' && action === 'confirm') return intentConfirm();
  if (command === 'plan' && action === 'approve') return planApprove();
  if (command === 'task' && ['register', 'start', 'complete'].includes(action)) return taskCommand(action);
  if (command === 'evidence' && action === 'exec') return evidenceExec();
  if (command === 'review' && action === 'record') return reviewRecord();
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
