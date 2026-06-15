#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CONFIG_PATH = '.github/jest-agent.config.json';
export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: 1,
  requestPath: '.github/.cache/jest-agent/request.json',
  reportPath: '.github/.cache/jest-agent/report.json',
  coverageDirectory: '.github/.cache/jest-agent/coverage',
  jestResultPath: '.github/.cache/jest-agent/jest-results.json',
  allowedEditPatterns: [
    '(^|/)(tests?|__tests__|__mocks__|test-utils|fixtures)/',
    '\\.(test|spec)\\.[cm]?[jt]sx?$',
  ],
  sourceExtensions: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'],
  jestArgs: ['--runInBand'],
  diffBase: 'HEAD',
  maxOutputCharacters: 4000,
  timeouts: {
    formatSeconds: 30,
    verifySeconds: 180,
  },
});

const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_TARGETS = 50;
const MAX_TESTS = 200;
const REVISION_PATTERN =
  /^[A-Za-z0-9_./@~^{}:+-]+(?:\.\.\.[A-Za-z0-9_./@~^{}:+-]+)?$/;
const EDIT_TOOL_PATTERN = /(edit|create|write|replace|apply.?patch)/i;
const PATH_KEY_PATTERN =
  /(^|_)(file|files|path|paths|filePath|filePaths|filepath|filepaths)$/i;
const PATCH_PATH_PATTERN =
  /^\*{3} (?:Add|Update|Delete) File:\s*(.+)\s*$/gm;

const TOOL_CANDIDATES = Object.freeze({
  jest: [
    'node_modules/jest/bin/jest.js',
    'node_modules/jest-cli/bin/jest.js',
  ],
  eslint: ['node_modules/eslint/bin/eslint.js'],
  prettier: [
    'node_modules/prettier/bin/prettier.cjs',
    'node_modules/prettier/bin-prettier.js',
  ],
});

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function uniqueSortedNumbers(values) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function trimOutput(value, limit) {
  const text = String(value ?? '').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n...[truncated]`;
}

function readJson(filePath, maxBytes = Number.POSITIVE_INFINITY) {
  const stat = statSync(filePath);
  if (!stat.isFile()) throw new Error(`${filePath} is not a regular file.`);
  if (stat.size > maxBytes) {
    throw new Error(`${filePath} exceeds ${maxBytes} bytes.`);
  }
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function assertStringArray(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error(`${label} must be an array with at most ${maximum} items.`);
  }
  for (const [index, item] of value.entries()) {
    assertString(item, `${label}[${index}]`);
  }
  return value;
}

function assertPositiveLineArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  for (const [index, line] of value.entries()) {
    if (!Number.isInteger(line) || line < 1) {
      throw new Error(`${label}[${index}] must be a positive integer.`);
    }
  }
  return uniqueSortedNumbers(value);
}

function isInside(root, candidate, allowRoot = false) {
  const relative = path.relative(root, candidate);
  if (relative === '') return allowRoot;
  return !relative.startsWith(`..${path.sep}`) && relative !== '..' &&
    !path.isAbsolute(relative);
}

function rejectSymlinkComponents(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!existsSync(current)) break;
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`Path contains a symbolic link: ${toPosix(relative)}`);
    }
  }
}

export function resolveRepositoryPath(
  root,
  inputPath,
  label = 'path',
  { allowRoot = false, allowSymlink = false } = {},
) {
  assertString(inputPath, label);
  if (inputPath.includes('\0')) throw new Error(`${label} contains a null byte.`);

  let absolutePath;
  if (inputPath.startsWith('file://')) {
    absolutePath = fileURLToPath(inputPath);
  } else {
    absolutePath = path.isAbsolute(inputPath)
      ? path.normalize(inputPath)
      : path.resolve(root, inputPath);
  }

  if (!isInside(root, absolutePath, allowRoot)) {
    throw new Error(`${label} must stay inside the repository.`);
  }
  if (!allowSymlink) rejectSymlinkComponents(root, absolutePath);
  return {
    absolutePath,
    relativePath: toPosix(path.relative(root, absolutePath)) || '.',
  };
}

function mergeConfig(rawConfig) {
  return {
    ...DEFAULT_CONFIG,
    ...rawConfig,
    timeouts: {
      ...DEFAULT_CONFIG.timeouts,
      ...(rawConfig.timeouts ?? {}),
    },
  };
}

export function loadConfig(root = process.cwd()) {
  const repositoryRoot = realpathSync(path.resolve(root));
  const configFile = path.join(repositoryRoot, CONFIG_PATH);
  const rawConfig = existsSync(configFile) ? readJson(configFile) : {};
  const config = mergeConfig(rawConfig);

  if (config.schemaVersion !== 1) {
    throw new Error('Unsupported Jest agent config schemaVersion.');
  }
  assertStringArray(
    config.allowedEditPatterns,
    'allowedEditPatterns',
    100,
  );
  assertStringArray(config.sourceExtensions, 'sourceExtensions', 50);
  assertStringArray(config.jestArgs, 'jestArgs', 100);
  if (!REVISION_PATTERN.test(assertString(config.diffBase, 'diffBase'))) {
    throw new Error('diffBase contains unsupported characters.');
  }
  if (
    !Number.isInteger(config.maxOutputCharacters) ||
    config.maxOutputCharacters < 500 ||
    config.maxOutputCharacters > 100_000
  ) {
    throw new Error('maxOutputCharacters must be an integer from 500 to 100000.');
  }

  for (const [name, seconds] of Object.entries(config.timeouts)) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
      throw new Error(`timeouts.${name} must be an integer from 1 to 3600.`);
    }
  }

  const request = resolveRepositoryPath(
    repositoryRoot,
    config.requestPath,
    'requestPath',
  );
  const report = resolveRepositoryPath(
    repositoryRoot,
    config.reportPath,
    'reportPath',
  );
  const coverage = resolveRepositoryPath(
    repositoryRoot,
    config.coverageDirectory,
    'coverageDirectory',
  );
  const jestResult = resolveRepositoryPath(
    repositoryRoot,
    config.jestResultPath,
    'jestResultPath',
  );

  return {
    ...config,
    root: repositoryRoot,
    requestPathAbsolute: request.absolutePath,
    requestPathRelative: request.relativePath,
    reportPathAbsolute: report.absolutePath,
    reportPathRelative: report.relativePath,
    coverageDirectoryAbsolute: coverage.absolutePath,
    coverageDirectoryRelative: coverage.relativePath,
    jestResultPathAbsolute: jestResult.absolutePath,
    jestResultPathRelative: jestResult.relativePath,
    allowedEditRegexes: config.allowedEditPatterns.map(
      (pattern) => new RegExp(pattern),
    ),
  };
}

export function isAllowedTestArtifact(relativePath, config) {
  const normalized = toPosix(relativePath);
  return config.allowedEditRegexes.some((pattern) => pattern.test(normalized));
}

export function isEditTool(toolName) {
  return EDIT_TOOL_PATTERN.test(String(toolName ?? ''));
}

export function extractToolPaths(toolInput) {
  const paths = new Set();

  function addPath(value) {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed !== '') paths.add(trimmed);
  }

  function visit(value, key = '') {
    if (typeof value === 'string') {
      if (PATH_KEY_PATTERN.test(key)) addPath(value);
      for (const match of value.matchAll(PATCH_PATH_PATTERN)) addPath(match[1]);
      return;
    }
    if (Array.isArray(value)) {
      if (PATH_KEY_PATTERN.test(key)) {
        for (const item of value) addPath(item);
      } else {
        for (const item of value) visit(item, key);
      }
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [childKey, childValue] of Object.entries(value)) {
      visit(childValue, childKey);
    }
  }

  visit(toolInput);
  return [...paths];
}

function normalizeRequestPath(config, inputPath, label) {
  return resolveRepositoryPath(config.root, inputPath, label);
}

export function validateRequest(rawRequest, config) {
  if (!rawRequest || typeof rawRequest !== 'object' || Array.isArray(rawRequest)) {
    throw new Error('Request must be a JSON object.');
  }
  if (rawRequest.schemaVersion !== 1) {
    throw new Error('Request schemaVersion must be 1.');
  }
  if (
    !Array.isArray(rawRequest.targets) ||
    rawRequest.targets.length === 0 ||
    rawRequest.targets.length > MAX_TARGETS
  ) {
    throw new Error(`targets must contain 1 to ${MAX_TARGETS} items.`);
  }
  assertStringArray(rawRequest.tests, 'tests', MAX_TESTS);
  if (rawRequest.tests.length === 0) {
    throw new Error('tests must contain at least one approved test path.');
  }
  const rawArtifacts = rawRequest.artifacts ?? [];
  assertStringArray(rawArtifacts, 'artifacts', MAX_TESTS);

  const targetPaths = new Set();
  const targets = rawRequest.targets.map((target, index) => {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
      throw new Error(`targets[${index}] must be an object.`);
    }
    const resolved = normalizeRequestPath(
      config,
      target.path,
      `targets[${index}].path`,
    );
    if (!config.sourceExtensions.includes(path.extname(resolved.relativePath))) {
      throw new Error(
        `targets[${index}].path must use a configured source extension.`,
      );
    }
    if (targetPaths.has(resolved.relativePath)) {
      throw new Error(`Duplicate target path: ${resolved.relativePath}`);
    }
    targetPaths.add(resolved.relativePath);

    const hasRequiredLines = Object.hasOwn(target, 'requiredLines');
    const hasRequiredBranchLines = Object.hasOwn(
      target,
      'requiredBranchLines',
    );
    if (hasRequiredLines !== hasRequiredBranchLines) {
      throw new Error(
        `targets[${index}] must provide both requiredLines and ` +
          'requiredBranchLines, or neither.',
      );
    }

    return {
      path: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      requiredLines: hasRequiredLines
        ? assertPositiveLineArray(
            target.requiredLines,
            `targets[${index}].requiredLines`,
          )
        : null,
      requiredBranchLines: hasRequiredBranchLines
        ? assertPositiveLineArray(
            target.requiredBranchLines,
            `targets[${index}].requiredBranchLines`,
          )
        : null,
    };
  });

  function normalizeArtifact(inputPath, label) {
    const resolved = normalizeRequestPath(
      config,
      inputPath,
      label,
    );
    if (!isAllowedTestArtifact(resolved.relativePath, config)) {
      throw new Error(`Test path is not allowed by config: ${resolved.relativePath}`);
    }
    return resolved;
  }

  const testPaths = new Set();
  const tests = rawRequest.tests.map((testPath, index) => {
    const resolved = normalizeArtifact(testPath, `tests[${index}]`);
    if (testPaths.has(resolved.relativePath)) {
      throw new Error(`Duplicate test path: ${resolved.relativePath}`);
    }
    testPaths.add(resolved.relativePath);
    return {
      path: resolved.relativePath,
      absolutePath: resolved.absolutePath,
    };
  });
  const artifactPaths = new Set();
  const artifacts = rawArtifacts.map((artifactPath, index) => {
    const resolved = normalizeArtifact(
      artifactPath,
      `artifacts[${index}]`,
    );
    if (
      artifactPaths.has(resolved.relativePath) ||
      testPaths.has(resolved.relativePath)
    ) {
      throw new Error(`Duplicate artifact path: ${resolved.relativePath}`);
    }
    artifactPaths.add(resolved.relativePath);
    return {
      path: resolved.relativePath,
      absolutePath: resolved.absolutePath,
    };
  });

  return {
    schemaVersion: 1,
    targets,
    tests,
    artifacts,
  };
}

export function loadRequest(config) {
  if (!existsSync(config.requestPathAbsolute)) return null;
  const rawRequest = readJson(config.requestPathAbsolute, MAX_REQUEST_BYTES);
  return validateRequest(rawRequest, config);
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    timeout: options.timeoutMs,
    windowsHide: true,
  });
  return {
    command,
    args,
    status: result.status,
    signal: result.signal,
    error: result.error
      ? {
          code: result.error.code ?? 'PROCESS_ERROR',
          message: result.error.message,
        }
      : null,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ok: result.status === 0 && !result.error,
  };
}

function runGit(config, args) {
  return runProcess('git', args, {
    cwd: config.root,
    timeoutMs: 15_000,
  });
}

function resolveDiffRevision(config) {
  if (!config.diffBase.includes('...')) return config.diffBase;
  const [left, right] = config.diffBase.split('...');
  const result = runGit(config, ['merge-base', left, right]);
  if (!result.ok || result.stdout.trim() === '') {
    throw new Error(
      `Unable to resolve merge base ${config.diffBase}: ` +
        trimOutput(result.stderr, 1000),
    );
  }
  return result.stdout.trim();
}

function repositoryRelativeFromProject(config, relativePath) {
  return toPosix(relativePath);
}

function resolveLocalTool(config, toolName) {
  const candidates = TOOL_CANDIDATES[toolName] ?? [];
  for (const relativePath of candidates) {
    const candidate = path.join(config.root, relativePath);
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      const realToolPath = realpathSync(candidate);
      if (!isInside(config.root, realToolPath)) continue;
      return {
        command: process.execPath,
        prefixArgs: [realToolPath],
        path: relativePath,
      };
    }
  }
  return null;
}

function invokeLocalTool(config, toolName, args, timeoutSeconds) {
  const tool = resolveLocalTool(config, toolName);
  if (!tool) {
    return {
      available: false,
      tool: toolName,
      ok: false,
      status: null,
      stdout: '',
      stderr: '',
    };
  }
  const result = runProcess(tool.command, [...tool.prefixArgs, ...args], {
    cwd: config.root,
    timeoutMs: timeoutSeconds * 1000,
  });
  return {
    available: true,
    tool: toolName,
    binary: tool.path,
    ...result,
    stdout: trimOutput(result.stdout, config.maxOutputCharacters),
    stderr: trimOutput(result.stderr, config.maxOutputCharacters),
  };
}

export function formatTestFiles(config, inputPaths) {
  const files = [];
  const rejected = [];
  for (const inputPath of inputPaths) {
    try {
      const resolved = resolveRepositoryPath(config.root, inputPath, 'file');
      if (
        isAllowedTestArtifact(resolved.relativePath, config) &&
        existsSync(resolved.absolutePath) &&
        statSync(resolved.absolutePath).isFile()
      ) {
        files.push(repositoryRelativeFromProject(config, resolved.relativePath));
      }
    } catch (error) {
      rejected.push({ path: String(inputPath), message: error.message });
    }
  }
  const uniqueFiles = [...new Set(files)];
  if (uniqueFiles.length === 0) {
    return {
      status: rejected.length > 0 ? 'failed' : 'skipped',
      files: [],
      rejected,
      prettier: { status: 'skipped' },
      eslint: { status: 'skipped' },
    };
  }

  const prettier = invokeLocalTool(
    config,
    'prettier',
    ['--write', ...uniqueFiles],
    config.timeouts.formatSeconds,
  );
  const eslint = invokeLocalTool(
    config,
    'eslint',
    ['--fix', ...uniqueFiles],
    config.timeouts.formatSeconds,
  );
  const failures = [prettier, eslint].filter(
    (result) => !result.available || !result.ok,
  );
  return {
    status: failures.length > 0 || rejected.length > 0 ? 'failed' : 'passed',
    files: uniqueFiles,
    rejected,
    prettier: summarizeToolResult(prettier),
    eslint: summarizeToolResult(eslint),
  };
}

function summarizeToolResult(result) {
  if (!result.available) {
    return {
      status: 'failed',
      reason: `Local ${result.tool} binary was not found.`,
    };
  }
  return {
    status: result.ok ? 'passed' : 'failed',
    binary: result.binary,
    exitCode: result.status,
    signal: result.signal,
    error: result.error,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseNameList(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(toPosix);
}

export function parseChangedLines(diffText) {
  const lines = new Set();
  const hunkPattern =
    /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  for (const match of diffText.matchAll(hunkPattern)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let offset = 0; offset < count; offset += 1) {
      lines.add(start + offset);
    }
  }
  return uniqueSortedNumbers([...lines]);
}

function classifyTarget(config, target) {
  const diffRevision = config.diffRevision ?? config.diffBase;
  const untracked = runGit(config, [
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    target.path,
  ]);
  if (!untracked.ok) {
    throw new Error(
      `Unable to inspect untracked files: ${trimOutput(untracked.stderr, 1000)}`,
    );
  }
  if (parseNameList(untracked.stdout).includes(target.path)) {
    return { mode: 'new', changedLines: [] };
  }

  const added = runGit(config, [
    'diff',
    '--diff-filter=A',
    '--name-only',
    diffRevision,
    '--',
    target.path,
  ]);
  if (!added.ok) {
    throw new Error(
      `Unable to compare ${target.path} with ${config.diffBase}: ` +
        trimOutput(added.stderr, 1000),
    );
  }
  if (parseNameList(added.stdout).includes(target.path)) {
    return { mode: 'new', changedLines: [] };
  }

  const diff = runGit(config, [
    'diff',
    '--unified=0',
    '--no-ext-diff',
    '--no-color',
    diffRevision,
    '--',
    target.path,
  ]);
  if (!diff.ok) {
    throw new Error(
      `Unable to read Git diff for ${target.path}: ` +
        trimOutput(diff.stderr, 1000),
    );
  }
  const changedLines = parseChangedLines(diff.stdout);
  if (changedLines.length > 0) return { mode: 'modified', changedLines };

  if (
    target.requiredLines === null ||
    target.requiredBranchLines === null ||
    target.requiredLines.length + target.requiredBranchLines.length === 0
  ) {
    throw new Error(
      `${target.path} has no diff. Provide approved requiredLines and/or ` +
        'requiredBranchLines for a legacy coverage gap.',
    );
  }
  return {
    mode: 'legacy-gaps',
    changedLines: [],
    requiredLines: target.requiredLines,
    requiredBranchLines: target.requiredBranchLines,
  };
}

function collectChangedTestFiles(config, request) {
  const files = new Set(
    [...request.tests, ...request.artifacts].map((file) => file.path),
  );
  return [...files]
    .filter((relativePath) => {
      const absolutePath = path.join(config.root, relativePath);
      return existsSync(absolutePath) && statSync(absolutePath).isFile();
    })
    .sort();
}

function runStaticChecks(config, files) {
  if (files.length === 0) {
    return {
      prettier: { status: 'skipped', reason: 'No existing test artifacts.' },
      eslint: { status: 'skipped', reason: 'No existing test artifacts.' },
    };
  }
  const projectFiles = files.map((relativePath) =>
    repositoryRelativeFromProject(config, relativePath)
  );
  const prettier = invokeLocalTool(
    config,
    'prettier',
    ['--check', ...projectFiles],
    config.timeouts.formatSeconds,
  );
  const eslint = invokeLocalTool(
    config,
    'eslint',
    projectFiles,
    config.timeouts.formatSeconds,
  );
  return {
    prettier: summarizeToolResult(prettier),
    eslint: summarizeToolResult(eslint),
  };
}

function prepareArtifactDirectories(config) {
  rmSync(config.coverageDirectoryAbsolute, { recursive: true, force: true });
  rmSync(config.jestResultPathAbsolute, { force: true });
  mkdirSync(config.coverageDirectoryAbsolute, { recursive: true });
  mkdirSync(path.dirname(config.jestResultPathAbsolute), { recursive: true });
}

function runJest(config, request) {
  const missingTests = request.tests
    .filter((test) => !existsSync(test.absolutePath))
    .map((test) => test.path);
  if (missingTests.length > 0) {
    return {
      status: 'failed',
      available: null,
      reason: 'Approved test files do not exist.',
      missingTests,
    };
  }

  prepareArtifactDirectories(config);
  const testPaths = request.tests.map((test) =>
    repositoryRelativeFromProject(config, test.path)
  );
  const targetPaths = request.targets.map((target) =>
    repositoryRelativeFromProject(config, target.path)
  );
  const args = [
    ...config.jestArgs,
    '--coverage',
    '--coverageReporters=json',
    '--coverageReporters=json-summary',
    `--coverageDirectory=${config.coverageDirectoryAbsolute}`,
    '--json',
    `--outputFile=${config.jestResultPathAbsolute}`,
    ...targetPaths.map((targetPath) => `--collectCoverageFrom=${targetPath}`),
    '--runTestsByPath',
    ...testPaths,
  ];
  const result = invokeLocalTool(
    config,
    'jest',
    args,
    config.timeouts.verifySeconds,
  );
  if (!result.available) {
    return {
      status: 'failed',
      available: false,
      reason: 'Local Jest binary was not found in node_modules.',
    };
  }

  let jestResult = null;
  if (existsSync(config.jestResultPathAbsolute)) {
    try {
      jestResult = readJson(config.jestResultPathAbsolute);
    } catch (error) {
      jestResult = { parseError: error.message };
    }
  }
  return {
    status: result.ok && jestResult?.success === true ? 'passed' : 'failed',
    available: true,
    binary: result.binary,
    exitCode: result.status,
    signal: result.signal,
    error: result.error,
    stdout: result.stdout,
    stderr: result.stderr,
    result: summarizeJestResult(jestResult, config.maxOutputCharacters),
  };
}

function summarizeJestResult(result, outputLimit) {
  if (!result) return null;
  if (result.parseError) return { parseError: result.parseError };
  const failures = [];
  for (const suite of result.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      if (assertion.status !== 'failed') continue;
      failures.push({
        file: suite.name,
        title: [...(assertion.ancestorTitles ?? []), assertion.title]
          .filter(Boolean)
          .join(' > '),
        messages: (assertion.failureMessages ?? []).map((message) =>
          trimOutput(message, outputLimit)
        ),
      });
      if (failures.length >= 20) break;
    }
    if (failures.length >= 20) break;
    if (
      suite.status === 'failed' &&
      (suite.assertionResults ?? []).length === 0
    ) {
      failures.push({
        file: suite.name,
        title: 'Test suite failed before assertions ran.',
        messages: [trimOutput(suite.message, outputLimit)],
      });
    }
  }
  return {
    success: result.success === true,
    numTotalTestSuites: result.numTotalTestSuites ?? null,
    numPassedTestSuites: result.numPassedTestSuites ?? null,
    numFailedTestSuites: result.numFailedTestSuites ?? null,
    numTotalTests: result.numTotalTests ?? null,
    numPassedTests: result.numPassedTests ?? null,
    numFailedTests: result.numFailedTests ?? null,
    failures,
  };
}

function locationContainsLine(location, line) {
  if (!location?.start || !location?.end) return false;
  return location.start.line <= line && location.end.line >= line;
}

function statementIdsForLines(fileCoverage, lines) {
  const ids = new Set();
  for (const [id, location] of Object.entries(fileCoverage.statementMap ?? {})) {
    if (lines.some((line) => locationContainsLine(location, line))) ids.add(id);
  }
  return ids;
}

function branchMatchesLines(branch, lines) {
  if (lines.includes(branch.line)) return true;
  if (lines.some((line) => locationContainsLine(branch.loc, line))) return true;
  return (branch.locations ?? []).some((location) =>
    lines.some((line) => locationContainsLine(location, line))
  );
}

function summarizeMetric(counts) {
  const total = counts.length;
  const covered = counts.filter((count) => count > 0).length;
  return {
    total,
    covered,
    skipped: 0,
    pct: total === 0 ? 100 : Math.round((covered / total) * 10_000) / 100,
  };
}

function coverageMetrics(fileCoverage) {
  const statementEntries = Object.entries(fileCoverage.s ?? {});
  const lineCounts = new Map();
  for (const [id, count] of statementEntries) {
    const line = fileCoverage.statementMap?.[id]?.start?.line;
    if (Number.isInteger(line)) {
      lineCounts.set(line, (lineCounts.get(line) ?? 0) + count);
    }
  }
  return {
    statements: summarizeMetric(statementEntries.map(([, count]) => count)),
    branches: summarizeMetric(Object.values(fileCoverage.b ?? {}).flat()),
    functions: summarizeMetric(Object.values(fileCoverage.f ?? {})),
    lines: summarizeMetric([...lineCounts.values()]),
  };
}

function normalizeCoverageEntries(config, coverage) {
  const entries = new Map();
  for (const [filePath, fileCoverage] of Object.entries(coverage)) {
    const absolutePath = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(config.root, filePath);
    entries.set(absolutePath, fileCoverage);
  }
  return entries;
}

function evaluateNewTarget(target, fileCoverage) {
  const metrics = coverageMetrics(fileCoverage);
  const failedMetrics = Object.entries(metrics)
    .filter(([, metric]) => metric.pct !== 100)
    .map(([name]) => name);
  return {
    path: target.path,
    mode: 'new',
    status: failedMetrics.length === 0 ? 'passed' : 'failed',
    metrics,
    failedMetrics,
  };
}

function uncoveredBranchesForLines(fileCoverage, lines) {
  const uncovered = [];
  const matchedLines = new Set();
  for (const [id, branch] of Object.entries(fileCoverage.branchMap ?? {})) {
    if (!branchMatchesLines(branch, lines)) continue;
    for (const line of lines) {
      if (branchMatchesLines(branch, [line])) matchedLines.add(line);
    }
    const counts = fileCoverage.b?.[id] ?? [];
    counts.forEach((count, arm) => {
      if (count > 0) return;
      const location = branch.locations?.[arm] ?? branch.loc;
      uncovered.push({
        line: location?.start?.line ?? branch.line ?? null,
        arm,
        type: branch.type ?? 'branch',
      });
    });
  }
  return { uncovered, matchedLines };
}

function evaluateModifiedTarget(target, classification, fileCoverage) {
  const statementIds = statementIdsForLines(
    fileCoverage,
    classification.changedLines,
  );
  const uncoveredLines = uniqueSortedNumbers(
    [...statementIds]
      .filter((id) => (fileCoverage.s?.[id] ?? 0) === 0)
      .map((id) => fileCoverage.statementMap[id].start.line),
  );
  const executableChangedLines = uniqueSortedNumbers(
    [...statementIds].map((id) => fileCoverage.statementMap[id].start.line),
  );
  const branches = uncoveredBranchesForLines(
    fileCoverage,
    classification.changedLines,
  );
  return {
    path: target.path,
    mode: 'modified',
    status:
      uncoveredLines.length === 0 && branches.uncovered.length === 0
        ? 'passed'
        : 'failed',
    changedLines: classification.changedLines,
    executableChangedLines,
    nonExecutableChangedLines: classification.changedLines.filter(
      (line) =>
        ![...statementIds].some((id) =>
          locationContainsLine(fileCoverage.statementMap[id], line)
        ),
    ),
    uncoveredLines,
    uncoveredBranches: branches.uncovered,
    metrics: coverageMetrics(fileCoverage),
  };
}

function evaluateLegacyTarget(target, classification, fileCoverage) {
  const invalidLines = [];
  const uncoveredLines = [];
  for (const line of classification.requiredLines) {
    const ids = statementIdsForLines(fileCoverage, [line]);
    if (ids.size === 0) {
      invalidLines.push(line);
    } else if ([...ids].some((id) => (fileCoverage.s?.[id] ?? 0) === 0)) {
      uncoveredLines.push(line);
    }
  }

  const invalidBranchLines = [];
  const uncoveredBranches = [];
  for (const line of classification.requiredBranchLines) {
    const branchResult = uncoveredBranchesForLines(fileCoverage, [line]);
    if (!branchResult.matchedLines.has(line)) {
      invalidBranchLines.push(line);
    } else {
      uncoveredBranches.push(...branchResult.uncovered);
    }
  }
  return {
    path: target.path,
    mode: 'legacy-gaps',
    status:
      invalidLines.length === 0 &&
      invalidBranchLines.length === 0 &&
      uncoveredLines.length === 0 &&
      uncoveredBranches.length === 0
        ? 'passed'
        : 'failed',
    requiredLines: classification.requiredLines,
    requiredBranchLines: classification.requiredBranchLines,
    invalidLines,
    invalidBranchLines,
    uncoveredLines,
    uncoveredBranches,
    metrics: coverageMetrics(fileCoverage),
  };
}

export function evaluateCoverage(config, request, classifications, coverage) {
  const entries = normalizeCoverageEntries(config, coverage);
  const targets = request.targets.map((target) => {
    const fileCoverage = entries.get(path.normalize(target.absolutePath));
    const classification = classifications.get(target.path);
    if (!fileCoverage) {
      return {
        path: target.path,
        mode: classification.mode,
        status: 'failed',
        error: 'Target is missing from coverage-final.json.',
      };
    }
    if (classification.mode === 'new') {
      return evaluateNewTarget(target, fileCoverage);
    }
    if (classification.mode === 'modified') {
      return evaluateModifiedTarget(target, classification, fileCoverage);
    }
    return evaluateLegacyTarget(target, classification, fileCoverage);
  });
  return {
    status: targets.every((target) => target.status === 'passed')
      ? 'passed'
      : 'failed',
    targets,
  };
}

function readCoverage(config, request, classifications) {
  const coveragePath = path.join(
    config.coverageDirectoryAbsolute,
    'coverage-final.json',
  );
  if (!existsSync(coveragePath)) {
    return {
      status: 'failed',
      error: 'coverage-final.json was not produced.',
      targets: [],
    };
  }
  try {
    return evaluateCoverage(
      config,
      request,
      classifications,
      readJson(coveragePath),
    );
  } catch (error) {
    return {
      status: 'failed',
      error: error.message,
      targets: [],
    };
  }
}

function reportCheckFailed(check) {
  return check?.status === 'failed';
}

export function writeReport(config, report) {
  mkdirSync(path.dirname(config.reportPathAbsolute), { recursive: true });
  const temporaryPath = `${config.reportPathAbsolute}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, config.reportPathAbsolute);
}

function failureReport(config, message) {
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'failed',
    error: message,
    artifacts: {
      report: config?.reportPathRelative ?? DEFAULT_CONFIG.reportPath,
    },
  };
  if (config) writeReport(config, report);
  return report;
}

export function verifyRepository(root = process.cwd()) {
  let config;
  try {
    config = loadConfig(root);
    const request = loadRequest(config);
    if (!request) {
      return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        status: 'skipped',
        reason: 'No approved Jest agent request exists.',
        artifacts: { report: config.reportPathRelative },
      };
    }

    config.diffRevision = resolveDiffRevision(config);
    const classifications = new Map();
    for (const target of request.targets) {
      if (!existsSync(target.absolutePath)) {
        throw new Error(`Target does not exist: ${target.path}`);
      }
      classifications.set(target.path, classifyTarget(config, target));
    }

    const testFiles = collectChangedTestFiles(config, request);
    const staticChecks = runStaticChecks(config, testFiles);
    const tests = runJest(config, request);
    const coverage = readCoverage(config, request, classifications);
    const failed =
      reportCheckFailed(staticChecks.prettier) ||
      reportCheckFailed(staticChecks.eslint) ||
      reportCheckFailed(tests) ||
      reportCheckFailed(coverage);
    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: failed ? 'failed' : 'passed',
      request: {
        targets: request.targets.map(({ path: targetPath }) => ({
          path: targetPath,
          mode: classifications.get(targetPath).mode,
        })),
        tests: request.tests.map((test) => test.path),
        artifacts: request.artifacts.map((artifact) => artifact.path),
      },
      checks: {
        prettier: staticChecks.prettier,
        eslint: staticChecks.eslint,
        tests,
        coverage,
      },
      artifacts: {
        report: config.reportPathRelative,
        coverage: config.coverageDirectoryRelative,
        jestResult: config.jestResultPathRelative,
      },
    };
    writeReport(config, report);
    return report;
  } catch (error) {
    return failureReport(config, error.message);
  }
}

function printCliSummary(report) {
  if (report.status === 'skipped') {
    console.log(`SKIPPED: ${report.reason}`);
    return;
  }
  console.log(`${report.status.toUpperCase()}: ${report.artifacts.report}`);
  if (report.error) console.log(report.error);
  for (const target of report.checks?.coverage?.targets ?? []) {
    const details = [
      ...(target.uncoveredLines?.length
        ? [`lines=${target.uncoveredLines.join(',')}`]
        : []),
      ...(target.uncoveredBranches?.length
        ? [`branches=${target.uncoveredBranches.length}`]
        : []),
      ...(target.failedMetrics?.length
        ? [`metrics=${target.failedMetrics.join(',')}`]
        : []),
    ].join(' ');
    console.log(
      `${target.status.toUpperCase()} ${target.path} (${target.mode})` +
        (details ? ` ${details}` : ''),
    );
  }
}

function parseCliArguments(argv) {
  const [command = 'verify', ...args] = argv;
  if (command !== 'verify') {
    throw new Error(`Unsupported command: ${command}`);
  }
  let root = process.cwd();
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--root' || index + 1 >= args.length) {
      throw new Error(`Unsupported argument: ${args[index]}`);
    }
    root = args[index + 1];
    index += 1;
  }
  return { command, root };
}

function runCli() {
  try {
    const options = parseCliArguments(process.argv.slice(2));
    const report = verifyRepository(options.root);
    printCliSummary(report);
    process.exitCode = report.status === 'failed' ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) runCli();
