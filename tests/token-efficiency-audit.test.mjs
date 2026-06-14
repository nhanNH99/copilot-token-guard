import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  auditRepository,
  MAX_AGENT_FILES,
  MAX_POLICY_BYTES,
  POLICY_END_MARKER,
  POLICY_START_MARKER,
  REQUIRED_POLICY_RULE_IDS,
} from '../.github/scripts/token-efficiency-audit.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(
  testDirectory,
  '../.github/scripts/token-efficiency-audit.mjs',
);

function createRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'token-efficiency-audit-'));
  mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  return root;
}

function validPolicyBody() {
  return REQUIRED_POLICY_RULE_IDS.map(
    (ruleId) => `<!-- ${ruleId} -->\n- Rule ${ruleId}.`,
  ).join('\n');
}

function writePolicy(root, body = validPolicyBody()) {
  const content = [
    '# Repository Instructions',
    POLICY_START_MARKER,
    body,
    POLICY_END_MARKER,
    '',
  ].join('\n');
  writeFileSync(
    path.join(root, '.github', 'copilot-instructions.md'),
    content,
    'utf8',
  );
}

function writeAgent(
  root,
  content = [
    '# Bug fixer',
    '',
    '**Token-efficiency profile:** safe',
    '',
    'Fix defects and run tests.',
    '',
  ].join('\n'),
  relativePath = 'bug-fix.agent.md',
) {
  const filePath = path.join(root, '.github', 'agents', relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    content,
    'utf8',
  );
}

function findingCodes(result, collection) {
  return result[collection].map((finding) => finding.code);
}

test('accepts valid policy and lists custom agents', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writePolicy(root);
  writeAgent(root);

  const result = auditRepository(root);

  assert.equal(result.ok, true);
  assert.equal(result.policy.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    result.agents,
    [
      {
        path: '.github/agents/bug-fix.agent.md',
        profile: 'safe',
        profileDeclared: true,
        duplicatePolicy: false,
      },
    ],
  );
});

test('reports missing policy', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const result = auditRepository(root);

  assert.equal(result.ok, false);
  assert.ok(findingCodes(result, 'errors').includes('POLICY_MISSING'));
});

test('reports invalid policy markers', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    path.join(root, '.github', 'copilot-instructions.md'),
    '# No managed markers\nPRIVATE_POLICY_TEXT\n',
    'utf8',
  );

  const result = auditRepository(root);

  assert.equal(result.ok, false);
  assert.ok(
    findingCodes(result, 'errors').includes('POLICY_MARKERS_INVALID'),
  );
});

test('reports missing required policy rules', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const body = validPolicyBody().replace(
    `<!-- ${REQUIRED_POLICY_RULE_IDS[0]} -->`,
    '',
  );
  writePolicy(root, body);

  const result = auditRepository(root);

  assert.equal(result.ok, false);
  assert.equal(result.policy.valid, false);
  assert.ok(
    findingCodes(result, 'errors').includes('POLICY_RULE_MISSING'),
  );
});

test('reports missing source-integrity policy rule', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const body = validPolicyBody().replace('<!-- TE-SOURCE-01 -->', '');
  writePolicy(root, body);

  const result = auditRepository(root);

  assert.equal(result.ok, false);
  assert.equal(result.policy.valid, false);
  assert.ok(
    result.errors.some(
      (finding) =>
        finding.code === 'POLICY_RULE_MISSING' &&
        finding.message.includes('TE-SOURCE-01'),
    ),
  );
});

test('reports duplicated required policy rules', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const duplicatedRule = `<!-- ${REQUIRED_POLICY_RULE_IDS[0]} -->`;
  writePolicy(root, `${validPolicyBody()}\n${duplicatedRule}\n`);

  const result = auditRepository(root);

  assert.equal(result.ok, false);
  assert.equal(result.policy.valid, false);
  assert.ok(
    findingCodes(result, 'errors').includes('POLICY_RULE_DUPLICATED'),
  );
});

test('reports oversized policy without reading it', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    path.join(root, '.github', 'copilot-instructions.md'),
    'x'.repeat(MAX_POLICY_BYTES + 1),
    'utf8',
  );

  const result = auditRepository(root);

  assert.equal(result.ok, false);
  assert.ok(findingCodes(result, 'errors').includes('POLICY_TOO_LARGE'));
});

test('rejects a symlinked policy', (t) => {
  const root = createRepository();
  const external = path.join(root, 'external-policy.md');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    external,
    `${POLICY_START_MARKER}\npolicy\n${POLICY_END_MARKER}\n`,
    'utf8',
  );

  try {
    symlinkSync(
      external,
      path.join(root, '.github', 'copilot-instructions.md'),
    );
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('Symbolic links are not available in this environment.');
      return;
    }
    throw error;
  }

  const result = auditRepository(root);

  assert.equal(result.ok, false);
  assert.ok(
    findingCodes(result, 'errors').includes('POLICY_PATH_SYMLINK'),
  );
});

test('warns when an agent duplicates shared response rules', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writePolicy(root);
  writeAgent(
    root,
    [
      '# Agent',
      '**Token-efficiency profile:** safe',
      'Respond in the same language as the user.',
      'Remove greetings, filler, and repeated conclusions.',
      'Do not narrate routine tool calls.',
      '',
    ].join('\n'),
  );

  const result = auditRepository(root);

  assert.equal(result.ok, true);
  assert.ok(
    findingCodes(result, 'warnings').includes(
      'AGENT_DUPLICATES_SHARED_POLICY',
    ),
  );
  assert.equal(result.agents[0].duplicatePolicy, true);
});

test('recognizes safe and compact agent profiles', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writePolicy(root);
  writeAgent(root);
  writeAgent(
    root,
    '# Reviewer\n\n**Token-efficiency profile:** compact\n',
    'review.agent.md',
  );

  const result = auditRepository(root);

  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    result.agents.map(({ path: agentPath, profile, profileDeclared }) => ({
      path: agentPath,
      profile,
      profileDeclared,
    })),
    [
      {
        path: '.github/agents/bug-fix.agent.md',
        profile: 'safe',
        profileDeclared: true,
      },
      {
        path: '.github/agents/review.agent.md',
        profile: 'compact',
        profileDeclared: true,
      },
    ],
  );
});

test('warns and falls back to safe when agent profile is missing', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writePolicy(root);
  writeAgent(root, '# Agent\n\nReview code.\n');

  const result = auditRepository(root);

  assert.equal(result.ok, true);
  assert.ok(
    findingCodes(result, 'warnings').includes('AGENT_PROFILE_MISSING'),
  );
  assert.equal(result.agents[0].profile, 'safe');
  assert.equal(result.agents[0].profileDeclared, false);
});

test('warns and falls back to safe when agent profile is invalid', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writePolicy(root);
  writeAgent(
    root,
    '# Agent\n\n**Token-efficiency profile:** ultra\n',
  );

  const result = auditRepository(root);

  assert.equal(result.ok, true);
  assert.ok(
    findingCodes(result, 'warnings').includes('AGENT_PROFILE_INVALID'),
  );
  assert.equal(result.agents[0].profile, 'safe');
  assert.equal(result.agents[0].profileDeclared, true);
});

test('warns and falls back to safe when agent profile is duplicated', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writePolicy(root);
  writeAgent(
    root,
    [
      '# Agent',
      '',
      '**Token-efficiency profile:** safe',
      '**Token-efficiency profile:** compact',
      '',
    ].join('\n'),
  );

  const result = auditRepository(root);

  assert.ok(
    findingCodes(result, 'warnings').includes('AGENT_PROFILE_INVALID'),
  );
  assert.equal(result.agents[0].profile, 'safe');
  assert.equal(result.agents[0].profileDeclared, true);
});

test('scans markdown custom agents without the .agent.md suffix', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writePolicy(root);
  writeAgent(
    root,
    '# Reviewer\n\n**Token-efficiency profile:** compact\n',
    'review.md',
  );

  const result = auditRepository(root);

  assert.deepEqual(
    result.agents.map((agent) => agent.path),
    ['.github/agents/review.md'],
  );
  assert.equal(result.agents[0].profile, 'compact');
});

test('warns when more than the maximum number of agents exist', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writePolicy(root);

  for (let index = 0; index <= MAX_AGENT_FILES; index += 1) {
    writeAgent(
      root,
      '# Agent\n\n**Token-efficiency profile:** safe\n',
      `${String(index).padStart(4, '0')}.md`,
    );
  }

  const result = auditRepository(root);

  assert.equal(result.agents.length, MAX_AGENT_FILES);
  assert.ok(
    findingCodes(result, 'warnings').includes('AGENT_SCAN_LIMIT_REACHED'),
  );
});

test('cli reports resolved agent profile counts', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writePolicy(root);
  writeAgent(root);
  writeAgent(
    root,
    '# Reviewer\n\n**Token-efficiency profile:** compact\n',
    'review.md',
  );

  const run = spawnSync(
    process.execPath,
    [scriptPath, '--root', root],
    { encoding: 'utf8' },
  );

  assert.equal(run.status, 0);
  assert.match(run.stdout, /Custom agents: 2/);
  assert.match(run.stdout, /Profiles: safe=1, compact=1/);
  assert.equal(run.stderr, '');
});

test('hook mode always emits non-blocking JSON and does not leak file content', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const secret = 'PRIVATE_POLICY_TEXT_SHOULD_NOT_LEAK';
  writeFileSync(
    path.join(root, '.github', 'copilot-instructions.md'),
    `${secret}\n`,
    'utf8',
  );

  const run = spawnSync(
    process.execPath,
    [scriptPath, '--root', root, '--hook'],
    { encoding: 'utf8' },
  );

  assert.equal(run.status, 0);
  const output = JSON.parse(run.stdout);
  assert.equal(output.continue, true);
  assert.equal(typeof output.systemMessage, 'string');
  assert.equal(run.stdout.includes(secret), false);
  assert.equal(run.stderr.includes(secret), false);
});

test('valid hook mode is silent except for continue JSON', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writePolicy(root);
  writeAgent(root);

  const run = spawnSync(
    process.execPath,
    [scriptPath, '--root', root, '--hook'],
    { encoding: 'utf8' },
  );

  assert.equal(run.status, 0);
  assert.deepEqual(JSON.parse(run.stdout), { continue: true });
  assert.equal(run.stderr, '');
});

test('hook mode does not inject agent profile warnings', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writePolicy(root);
  writeAgent(root, '# Agent without profile\n');

  const run = spawnSync(
    process.execPath,
    [scriptPath, '--root', root, '--hook'],
    { encoding: 'utf8' },
  );

  assert.equal(run.status, 0);
  assert.deepEqual(JSON.parse(run.stdout), { continue: true });
  assert.equal(run.stderr, '');
});

test('hook mode returns valid non-blocking JSON after argument errors', () => {
  const run = spawnSync(
    process.execPath,
    [scriptPath, '--hook', '--unknown-option'],
    { encoding: 'utf8' },
  );

  assert.equal(run.status, 0);
  const output = JSON.parse(run.stdout);
  assert.equal(output.continue, true);
  assert.equal(typeof output.systemMessage, 'string');
  assert.equal(run.stderr, '');
});
