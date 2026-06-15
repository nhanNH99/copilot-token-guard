#!/usr/bin/env node

import { readFileSync, rmSync } from 'node:fs';

import {
  extractToolPaths,
  formatTestFiles,
  isEditTool,
  loadConfig,
  verifyRepository,
} from './jest-agent-runner.mjs';

const MAX_HOOK_ERROR_CHARACTERS = 800;
const MAX_TEST_FAILURES = 2;
const MAX_COVERAGE_ITEMS = 12;

function readHookInput() {
  const input = readFileSync(0, 'utf8').trim();
  if (input === '') return {};
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Hook input must be a JSON object.');
  }
  return parsed;
}

function printHookResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function compactText(value, maximum = MAX_HOOK_ERROR_CHARACTERS) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length <= maximum
    ? text
    : `${text.slice(0, maximum - 3)}...`;
}

function postToolUse(input, config) {
  if (!isEditTool(input.tool_name)) return { continue: true };
  const result = formatTestFiles(config, extractToolPaths(input.tool_input));
  if (result.files.length === 0 && result.rejected.length === 0) {
    return { continue: true };
  }
  if (result.status !== 'failed') return { continue: true };

  const details = [];
  if (result.prettier.status === 'failed') {
    details.push(
      `Prettier: ${
        result.prettier.reason ||
        result.prettier.stderr ||
        result.prettier.stdout
      }`,
    );
  } else if (result.prettier.status === 'unavailable') {
    details.push('Prettier is not installed locally; formatting was skipped.');
  }
  if (result.eslint.status === 'failed') {
    details.push(
      `ESLint: ${
        result.eslint.reason || result.eslint.stderr || result.eslint.stdout
      }`,
    );
  } else if (result.eslint.status === 'unavailable') {
    details.push('ESLint is not installed locally; lint auto-fix was skipped.');
  }
  for (const rejected of result.rejected) {
    details.push(`Rejected ${rejected.path}: ${rejected.message}`);
  }

  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: compactText(details.join(' ')),
    },
  };
}

function stop(input, config) {
  if (input.stop_hook_active === true) return { continue: true };

  const report = verifyRepository(config.root);
  if (report.status === 'passed') {
    rmSync(config.requestPathAbsolute, { force: true });
    return { continue: true };
  }
  if (report.status === 'skipped') return { continue: true };

  const summary = summarizeFailedReport(report);
  return {
    hookSpecificOutput: {
      hookEventName: 'Stop',
      decision: 'block',
      reason:
        `Verification failed. ${summary} Report: ` +
        `${config.reportPathRelative}. Propose a repair and wait for approval.`,
    },
  };
}

function summarizeFailedReport(report) {
  const parts = [];
  if (report.error) parts.push(`Runner: ${report.error}`);
  for (const tool of ['prettier', 'eslint']) {
    const check = report.checks?.[tool];
    if (check?.status !== 'failed') continue;
    parts.push(
      `${tool}: ${compactText(
        check.reason || check.stderr || check.stdout || 'failed',
        240,
      )}`,
    );
  }
  const tests = report.checks?.tests;
  if (tests?.status === 'failed') {
    if (tests.reason) parts.push(`Jest: ${tests.reason}`);
    for (
      const failure of tests.result?.failures?.slice(0, MAX_TEST_FAILURES) ?? []
    ) {
      parts.push(`Test: ${failure.title || failure.file}`);
    }
  }
  for (const target of report.checks?.coverage?.targets ?? []) {
    if (target.status !== 'failed') continue;
    const details = [];
    if (target.failedMetrics?.length) {
      details.push(`metrics ${target.failedMetrics.join(',')}`);
    }
    if (target.uncoveredLines?.length) {
      details.push(
        `lines ${target.uncoveredLines.slice(0, MAX_COVERAGE_ITEMS).join(',')}`,
      );
    }
    if (target.uncoveredBranches?.length) {
      details.push(
        `branches ${target.uncoveredBranches
          .slice(0, MAX_COVERAGE_ITEMS)
          .map((branch) => `${branch.line}:${branch.arm}`)
          .join(',')}`,
      );
    }
    if (target.invalidLines?.length) {
      details.push(`invalid lines ${target.invalidLines.join(',')}`);
    }
    if (target.invalidBranchLines?.length) {
      details.push(
        `invalid branch lines ${target.invalidBranchLines.join(',')}`,
      );
    }
    if (target.error) details.push(target.error);
    parts.push(`Coverage ${target.path}: ${details.join('; ') || 'failed'}`);
  }
  if (parts.length === 0) parts.push('See the structured report for details.');
  return compactText(parts.join(' '));
}

function run() {
  const mode = process.argv[2];
  try {
    const input = readHookInput();
    const config = loadConfig(process.cwd());
    if (mode === 'post-tool-use') {
      printHookResult(postToolUse(input, config));
    } else if (mode === 'stop') {
      printHookResult(stop(input, config));
    } else {
      printHookResult({
        continue: false,
        stopReason: `Unsupported Jest agent hook mode: ${mode}`,
      });
    }
  } catch (error) {
    printHookResult({
      continue: false,
      stopReason: `Jest agent hook failed safely: ${error.message}`,
    });
  }
}

run();
