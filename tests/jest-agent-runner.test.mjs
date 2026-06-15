import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  evaluateCoverage,
  extractToolPaths,
  loadConfig,
  parseChangedLines,
  resolveRepositoryPath,
  validateRequest,
  verifyRepository,
} from '../.github/scripts/jest-agent-runner.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.resolve(
  testDirectory,
  '../.github/scripts/jest-agent-hook.mjs',
);

function createRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'jest-agent-runner-'));
  mkdirSync(path.join(root, '.github'), { recursive: true });
  writeFileSync(
    path.join(root, '.github', 'jest-agent.config.json'),
    `${JSON.stringify({ schemaVersion: 1 }, null, 2)}\n`,
    'utf8',
  );
  return root;
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writePassingStaticTools(root) {
  const eslintPath = path.join(
    root,
    'node_modules',
    'eslint',
    'bin',
    'eslint.js',
  );
  const prettierPath = path.join(
    root,
    'node_modules',
    'prettier',
    'bin',
    'prettier.cjs',
  );
  mkdirSync(path.dirname(eslintPath), { recursive: true });
  mkdirSync(path.dirname(prettierPath), { recursive: true });
  writeFileSync(eslintPath, 'process.exitCode = 0;\n', 'utf8');
  writeFileSync(prettierPath, 'process.exitCode = 0;\n', 'utf8');
}

function location(line) {
  return {
    start: { line, column: 0 },
    end: { line, column: 20 },
  };
}

function completeCoverage(overrides = {}) {
  return {
    path: '/repo/src/Component.tsx',
    statementMap: {
      0: location(1),
      1: location(2),
      2: location(3),
    },
    s: { 0: 1, 1: 1, 2: 1 },
    branchMap: {
      0: {
        line: 2,
        type: 'if',
        loc: location(2),
        locations: [location(2), location(3)],
      },
    },
    b: { 0: [1, 1] },
    fnMap: {
      0: {
        name: 'Component',
        decl: location(1),
        loc: {
          start: { line: 1, column: 0 },
          end: { line: 3, column: 20 },
        },
      },
    },
    f: { 0: 1 },
    ...overrides,
  };
}

function evaluationFixture(root, target = {}) {
  const config = loadConfig(root);
  const absolutePath = path.join(root, 'src', 'Component.tsx');
  const request = {
    targets: [
      {
        path: 'src/Component.tsx',
        absolutePath,
        requiredLines: null,
        requiredBranchLines: null,
        ...target,
      },
    ],
    tests: [],
  };
  return { config, request, absolutePath };
}

test('path guard rejects paths outside the repository and symlink paths', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.throws(
    () => resolveRepositoryPath(root, '../outside.ts'),
    /inside the repository/,
  );

  const external = mkdtempSync(path.join(os.tmpdir(), 'jest-agent-external-'));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  try {
    symlinkSync(external, path.join(root, 'linked'));
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('Symbolic links are not available in this environment.');
      return;
    }
    throw error;
  }
  assert.throws(
    () => resolveRepositoryPath(root, 'linked/file.ts'),
    /symbolic link/,
  );
});

test('request validation allows tests but rejects source as a test artifact', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = loadConfig(root);

  const valid = validateRequest(
    {
      schemaVersion: 1,
      targets: [{ path: 'src/Component.tsx' }],
      tests: ['src/Component.test.tsx'],
    },
    config,
  );
  assert.equal(valid.targets[0].path, 'src/Component.tsx');
  assert.equal(valid.tests[0].path, 'src/Component.test.tsx');

  assert.throws(
    () =>
      validateRequest(
        {
          schemaVersion: 1,
          targets: [{ path: 'src/Component.tsx' }],
          tests: ['src/Component.tsx'],
        },
        config,
      ),
    /not allowed/,
  );
});

test('extracts explicit edit paths and patch headers', () => {
  const paths = extractToolPaths({
    files: ['src/One.test.tsx'],
    patch:
      '*** Begin Patch\n*** Update File: tests/Two.test.tsx\n*** End Patch\n',
  });

  assert.deepEqual(
    paths.sort(),
    ['src/One.test.tsx', 'tests/Two.test.tsx'].sort(),
  );
});

test('parses added line ranges from zero-context Git diffs', () => {
  const diff = [
    '@@ -3,2 +3,4 @@',
    '+a',
    '+b',
    '@@ -20 +22,0 @@',
    '@@ -30 +31 @@',
    '+c',
  ].join('\n');

  assert.deepEqual(parseChangedLines(diff), [3, 4, 5, 6, 31]);
});

test('new files require 100 percent in all four coverage metrics', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { config, request, absolutePath } = evaluationFixture(root);
  const classifications = new Map([
    ['src/Component.tsx', { mode: 'new', changedLines: [] }],
  ]);
  const coverage = completeCoverage({
    path: absolutePath,
    b: { 0: [1, 0] },
  });

  const result = evaluateCoverage(
    config,
    request,
    classifications,
    { [absolutePath]: coverage },
  );

  assert.equal(result.status, 'failed');
  assert.deepEqual(result.targets[0].failedMetrics, ['branches']);
});

test('modified files gate changed executable statements and branch arms', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { config, request, absolutePath } = evaluationFixture(root);
  const classifications = new Map([
    ['src/Component.tsx', { mode: 'modified', changedLines: [2] }],
  ]);
  const coverage = completeCoverage({
    path: absolutePath,
    s: { 0: 1, 1: 0, 2: 1 },
    b: { 0: [1, 0] },
  });

  const result = evaluateCoverage(
    config,
    request,
    classifications,
    { [absolutePath]: coverage },
  );

  assert.equal(result.status, 'failed');
  assert.deepEqual(result.targets[0].uncoveredLines, [2]);
  assert.equal(result.targets[0].uncoveredBranches.length, 1);
});

test('legacy gaps reject non-executable and non-branch line declarations', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { config, request, absolutePath } = evaluationFixture(root, {
    requiredLines: [99],
    requiredBranchLines: [98],
  });
  const classifications = new Map([
    [
      'src/Component.tsx',
      {
        mode: 'legacy-gaps',
        changedLines: [],
        requiredLines: [99],
        requiredBranchLines: [98],
      },
    ],
  ]);

  const result = evaluateCoverage(
    config,
    request,
    classifications,
    { [absolutePath]: completeCoverage({ path: absolutePath }) },
  );

  assert.equal(result.status, 'failed');
  assert.deepEqual(result.targets[0].invalidLines, [99]);
  assert.deepEqual(result.targets[0].invalidBranchLines, [98]);
});

test('Stop hook blocks once for a failed report and then avoids a loop', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeJson(
    path.join(root, '.github', '.cache', 'jest-agent', 'request.json'),
    {
      schemaVersion: 1,
      targets: [{ path: 'src/Missing.tsx' }],
      tests: ['src/Missing.test.tsx'],
    },
  );

  function callStop(stopHookActive) {
    const input = JSON.stringify({
      cwd: root,
      hook_event_name: 'Stop',
      stop_hook_active: stopHookActive,
    });
    const result = spawnSync(process.execPath, [hookPath, 'stop'], {
      cwd: root,
      input,
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }

  const firstResult = callStop(false);
  assert.equal(firstResult.hookSpecificOutput.decision, 'block');
  assert.ok(firstResult.hookSpecificOutput.reason.length <= 1000);
  assert.equal(callStop(true).continue, true);
});

test('PostToolUse success is silent to avoid adding model context', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writePassingStaticTools(root);
  const testPath = path.join(root, 'src', 'Component.test.tsx');
  mkdirSync(path.dirname(testPath), { recursive: true });
  writeFileSync(testPath, 'test("component", () => {});\n', 'utf8');

  const input = JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'editFiles',
    tool_input: { files: ['src/Component.test.tsx'] },
  });
  const result = spawnSync(
    process.execPath,
    [hookPath, 'post-tool-use'],
    { cwd: root, input, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { continue: true });
});

test('verifyRepository runs a local Jest binary and writes a passing report', (t) => {
  const root = createRepository();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  writeFileSync(path.join(root, 'base.txt'), 'base\n', 'utf8');
  const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  assert.equal(
    spawnSync('git', ['add', 'base.txt'], { cwd: root }).status,
    0,
  );
  const commit = spawnSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-qm',
      'base',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(commit.status, 0, commit.stderr);

  const sourcePath = path.join(root, 'src', 'Component.tsx');
  const testPath = path.join(root, 'src', 'Component.test.tsx');
  mkdirSync(path.dirname(sourcePath), { recursive: true });
  writeFileSync(
    sourcePath,
    'export function Component() {\n  return true;\n}\n',
    'utf8',
  );
  writeFileSync(testPath, 'test("component", () => {});\n', 'utf8');
  writeJson(
    path.join(root, '.github', '.cache', 'jest-agent', 'request.json'),
    {
      schemaVersion: 1,
      targets: [{ path: 'src/Component.tsx' }],
      tests: ['src/Component.test.tsx'],
    },
  );

  const fakeJestPath = path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');
  mkdirSync(path.dirname(fakeJestPath), { recursive: true });
  writeFileSync(
    fakeJestPath,
    [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const coverageArg = process.argv.find((arg) => arg.startsWith('--coverageDirectory='));",
      "const outputArg = process.argv.find((arg) => arg.startsWith('--outputFile='));",
      "const targetArg = process.argv.find((arg) => arg.startsWith('--collectCoverageFrom='));",
      "const coverageDirectory = coverageArg.slice('--coverageDirectory='.length);",
      "const outputFile = outputArg.slice('--outputFile='.length);",
      "const target = path.resolve(process.cwd(), targetArg.slice('--collectCoverageFrom='.length));",
      'const loc = (line) => ({ start: { line, column: 0 }, end: { line, column: 20 } });',
      'const coverage = {',
      '  path: target,',
      '  statementMap: { 0: loc(1), 1: loc(2) },',
      '  s: { 0: 1, 1: 1 },',
      "  branchMap: { 0: { line: 2, type: 'if', loc: loc(2), locations: [loc(2), loc(2)] } },",
      '  b: { 0: [1, 1] },',
      "  fnMap: { 0: { name: 'Component', decl: loc(1), loc: loc(1) } },",
      '  f: { 0: 1 }',
      '};',
      'fs.mkdirSync(coverageDirectory, { recursive: true });',
      "fs.writeFileSync(path.join(coverageDirectory, 'coverage-final.json'), JSON.stringify({ [target]: coverage }));",
      'fs.mkdirSync(path.dirname(outputFile), { recursive: true });',
      "fs.writeFileSync(outputFile, JSON.stringify({ success: true, numTotalTestSuites: 1, numPassedTestSuites: 1, numFailedTestSuites: 0, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, testResults: [] }));",
    ].join('\n'),
    'utf8',
  );
  writePassingStaticTools(root);

  const report = verifyRepository(root);

  assert.equal(report.status, 'passed');
  assert.equal(report.checks.tests.status, 'passed');
  assert.equal(report.checks.coverage.targets[0].mode, 'new');
  assert.equal(report.checks.coverage.status, 'passed');
  const writtenReport = JSON.parse(
    readFileSync(
      path.join(root, '.github', '.cache', 'jest-agent', 'report.json'),
      'utf8',
    ),
  );
  assert.equal(writtenReport.status, 'passed');

  const stopResult = spawnSync(process.execPath, [hookPath, 'stop'], {
    cwd: root,
    input: JSON.stringify({
      hook_event_name: 'Stop',
      stop_hook_active: false,
    }),
    encoding: 'utf8',
  });
  assert.equal(stopResult.status, 0, stopResult.stderr);
  assert.deepEqual(JSON.parse(stopResult.stdout), { continue: true });
  assert.equal(
    existsSync(
      path.join(root, '.github', '.cache', 'jest-agent', 'request.json'),
    ),
    false,
  );
});
