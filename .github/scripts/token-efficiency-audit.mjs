#!/usr/bin/env node

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const POLICY_RELATIVE_PATH = '.github/copilot-instructions.md';
export const POLICY_START_MARKER = '<!-- token-efficiency-policy:start -->';
export const POLICY_END_MARKER = '<!-- token-efficiency-policy:end -->';
export const MAX_POLICY_BYTES = 16 * 1024;
export const MAX_AGENT_BYTES = 64 * 1024;
export const MAX_AGENT_FILES = 1000;
export const REQUIRED_POLICY_RULE_IDS = Object.freeze([
  'TE-CORE-01',
  'TE-EXACT-01',
  'TE-SOURCE-01',
  'TE-REPORT-01',
  'TE-PROFILE-01',
  'TE-SAFETY-01',
]);
export const SUPPORTED_AGENT_PROFILES = Object.freeze(['safe', 'compact']);

const DEFAULT_AGENT_PROFILE = 'safe';
const AGENT_PROFILE_LABEL = /^\s*\*\*Token-efficiency profile:\*\*/i;
const AGENT_PROFILE_DECLARATION =
  /^\s*\*\*Token-efficiency profile:\*\*\s*(\S+)\s*$/i;

const DUPLICATE_RULE_PATTERNS = [
  /respond in the same language as the user/i,
  /remove greetings,\s*filler/i,
  /do not narrate routine tool/i,
  /for completed coding work,\s*report only/i,
  /never shorten away security impact/i,
];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function countOccurrences(text, needle) {
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(needle, offset)) !== -1) {
    count += 1;
    offset += needle.length;
  }
  return count;
}

function addFinding(list, code, relativePath, message) {
  list.push({ code, path: toPosix(relativePath), message });
}

function parseAgentProfile(content) {
  const declarations = [];
  let labelCount = 0;

  for (const line of content.split(/\r?\n/)) {
    if (AGENT_PROFILE_LABEL.test(line)) labelCount += 1;
    const match = line.match(AGENT_PROFILE_DECLARATION);
    if (match) declarations.push(match[1].toLowerCase());
  }

  if (labelCount === 0) {
    return {
      profile: DEFAULT_AGENT_PROFILE,
      profileDeclared: false,
      issue: 'missing',
    };
  }

  if (
    labelCount !== 1 ||
    declarations.length !== 1 ||
    !SUPPORTED_AGENT_PROFILES.includes(declarations[0])
  ) {
    return {
      profile: DEFAULT_AGENT_PROFILE,
      profileDeclared: true,
      issue: 'invalid',
    };
  }

  return {
    profile: declarations[0],
    profileDeclared: true,
    issue: null,
  };
}

function readRegularFileNoFollow(filePath, maxBytes) {
  const noFollow =
    typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  let descriptor;
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | noFollow);
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) {
      const error = new Error('not a regular file');
      error.code = 'NOT_REGULAR_FILE';
      throw error;
    }
    if (stat.size > maxBytes) {
      const error = new Error('file too large');
      error.code = 'FILE_TOO_LARGE';
      error.size = stat.size;
      throw error;
    }
    return {
      content: readFileSync(descriptor, 'utf8'),
      size: stat.size,
    };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function inspectPathComponents(root, relativePath) {
  const parts = relativePath.split(/[\\/]/).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) return { stat, symlink: current };
  }
  return { stat: lstatSync(path.join(root, relativePath)), symlink: null };
}

function auditPolicy(root, result) {
  const relativePath = POLICY_RELATIVE_PATH;
  const absolutePath = path.join(root, relativePath);
  let inspected;

  try {
    inspected = inspectPathComponents(root, relativePath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      addFinding(
        result.errors,
        'POLICY_MISSING',
        relativePath,
        'Repository-wide Copilot instruction file is missing.',
      );
      return;
    }
    addFinding(
      result.errors,
      'POLICY_UNREADABLE',
      relativePath,
      'Repository-wide Copilot instruction file cannot be inspected.',
    );
    return;
  }

  if (inspected.symlink) {
    addFinding(
      result.errors,
      'POLICY_PATH_SYMLINK',
      relativePath,
      'Policy path contains a symbolic link.',
    );
    return;
  }

  if (!inspected.stat.isFile()) {
    addFinding(
      result.errors,
      'POLICY_NOT_REGULAR_FILE',
      relativePath,
      'Policy must be a regular file.',
    );
    return;
  }

  result.policy.bytes = inspected.stat.size;
  if (inspected.stat.size > MAX_POLICY_BYTES) {
    addFinding(
      result.errors,
      'POLICY_TOO_LARGE',
      relativePath,
      `Policy exceeds ${MAX_POLICY_BYTES} bytes.`,
    );
    return;
  }

  let policyFile;
  try {
    policyFile = readRegularFileNoFollow(absolutePath, MAX_POLICY_BYTES);
    result.policy.bytes = policyFile.size;
  } catch (error) {
    if (error?.code === 'FILE_TOO_LARGE') {
      addFinding(
        result.errors,
        'POLICY_TOO_LARGE',
        relativePath,
        `Policy exceeds ${MAX_POLICY_BYTES} bytes.`,
      );
      return;
    }
    addFinding(
      result.errors,
      'POLICY_UNREADABLE',
      relativePath,
      'Repository-wide Copilot instruction file cannot be read.',
    );
    return;
  }
  const content = policyFile.content;

  const startCount = countOccurrences(content, POLICY_START_MARKER);
  const endCount = countOccurrences(content, POLICY_END_MARKER);
  const startIndex = content.indexOf(POLICY_START_MARKER);
  const endIndex = content.indexOf(POLICY_END_MARKER);

  if (
    startCount !== 1 ||
    endCount !== 1 ||
    startIndex === -1 ||
    endIndex <= startIndex
  ) {
    addFinding(
      result.errors,
      'POLICY_MARKERS_INVALID',
      relativePath,
      'Policy must contain one ordered start marker and one end marker.',
    );
    return;
  }

  const managedBlock = content.slice(
    startIndex + POLICY_START_MARKER.length,
    endIndex,
  );
  if (managedBlock.trim().length === 0) {
    addFinding(
      result.errors,
      'POLICY_BLOCK_EMPTY',
      relativePath,
      'Managed token-efficiency policy block is empty.',
    );
    return;
  }

  let rulesValid = true;
  for (const ruleId of REQUIRED_POLICY_RULE_IDS) {
    const marker = `<!-- ${ruleId} -->`;
    const count = countOccurrences(managedBlock, marker);
    if (count === 0) {
      rulesValid = false;
      addFinding(
        result.errors,
        'POLICY_RULE_MISSING',
        relativePath,
        `Managed policy rule ${ruleId} is missing.`,
      );
    } else if (count > 1) {
      rulesValid = false;
      addFinding(
        result.errors,
        'POLICY_RULE_DUPLICATED',
        relativePath,
        `Managed policy rule ${ruleId} appears more than once.`,
      );
    }
  }
  if (!rulesValid) return;

  result.policy.valid = true;
}

function collectAgentFiles(root, result) {
  const agentsRelativePath = '.github/agents';
  const agentsPath = path.join(root, agentsRelativePath);
  let rootStat;

  try {
    rootStat = lstatSync(agentsPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      addFinding(
        result.warnings,
        'AGENTS_DIRECTORY_UNREADABLE',
        agentsRelativePath,
        'Custom agent directory cannot be inspected.',
      );
    }
    return [];
  }

  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    addFinding(
      result.warnings,
      'AGENTS_DIRECTORY_UNSAFE',
      agentsRelativePath,
      'Custom agent path must be a regular directory, not a symbolic link.',
    );
    return [];
  }

  const files = [];
  const stack = [agentsPath];
  let scanLimitReached = false;

  while (stack.length > 0 && !scanLimitReached) {
    const directory = stack.pop();
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      addFinding(
        result.warnings,
        'AGENTS_DIRECTORY_UNREADABLE',
        path.relative(root, directory),
        'Custom agent directory cannot be read.',
      );
      continue;
    }

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath);

      if (entry.isSymbolicLink()) {
        addFinding(
          result.warnings,
          'AGENT_PATH_SYMLINK',
          relativePath,
          'Symbolic links are not inspected.',
        );
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        if (files.length >= MAX_AGENT_FILES) {
          scanLimitReached = true;
          break;
        }
        files.push({ absolutePath, relativePath });
      }
    }
  }

  if (scanLimitReached) {
    addFinding(
      result.warnings,
      'AGENT_SCAN_LIMIT_REACHED',
      agentsRelativePath,
      `Audit stopped after ${MAX_AGENT_FILES} custom agent files.`,
    );
  }

  return files;
}

function auditAgents(root, result) {
  const files = collectAgentFiles(root, result);

  for (const file of files) {
    const relativePath = toPosix(file.relativePath);
    const agent = {
      path: relativePath,
      profile: DEFAULT_AGENT_PROFILE,
      profileDeclared: false,
      duplicatePolicy: false,
    };
    result.agents.push(agent);

    let stat;
    try {
      stat = lstatSync(file.absolutePath);
    } catch {
      addFinding(
        result.warnings,
        'AGENT_UNREADABLE',
        relativePath,
        'Custom agent file cannot be inspected.',
      );
      continue;
    }

    if (!stat.isFile() || stat.size > MAX_AGENT_BYTES) {
      addFinding(
        result.warnings,
        stat.size > MAX_AGENT_BYTES ? 'AGENT_TOO_LARGE' : 'AGENT_NOT_REGULAR_FILE',
        relativePath,
        'Custom agent file was not read.',
      );
      continue;
    }

    let agentFile;
    try {
      agentFile = readRegularFileNoFollow(file.absolutePath, MAX_AGENT_BYTES);
    } catch {
      addFinding(
        result.warnings,
        'AGENT_UNREADABLE',
        relativePath,
        'Custom agent file cannot be read.',
      );
      continue;
    }
    const content = agentFile.content;
    const profile = parseAgentProfile(content);
    agent.profile = profile.profile;
    agent.profileDeclared = profile.profileDeclared;

    if (profile.issue === 'missing') {
      addFinding(
        result.warnings,
        'AGENT_PROFILE_MISSING',
        relativePath,
        `Agent has no token-efficiency profile; using ${DEFAULT_AGENT_PROFILE}.`,
      );
    } else if (profile.issue === 'invalid') {
      addFinding(
        result.warnings,
        'AGENT_PROFILE_INVALID',
        relativePath,
        `Agent token-efficiency profile is invalid; using ${DEFAULT_AGENT_PROFILE}.`,
      );
    }

    const duplicateScore = DUPLICATE_RULE_PATTERNS.reduce(
      (score, pattern) => score + (pattern.test(content) ? 1 : 0),
      0,
    );
    if (
      content.includes(POLICY_START_MARKER) ||
      content.includes(POLICY_END_MARKER) ||
      duplicateScore >= 2
    ) {
      agent.duplicatePolicy = true;
      addFinding(
        result.warnings,
        'AGENT_DUPLICATES_SHARED_POLICY',
        relativePath,
        'Agent appears to duplicate repository-wide response rules.',
      );
    }
  }

  result.agents.sort((a, b) => a.path.localeCompare(b.path));
}

export function auditRepository(rootInput = process.cwd()) {
  const root = path.resolve(rootInput);
  const result = {
    root,
    ok: false,
    policy: {
      path: POLICY_RELATIVE_PATH,
      bytes: 0,
      valid: false,
    },
    agents: [],
    errors: [],
    warnings: [],
  };

  let rootStat;
  try {
    rootStat = lstatSync(root);
  } catch {
    addFinding(
      result.errors,
      'ROOT_UNREADABLE',
      '.',
      'Repository root cannot be inspected.',
    );
    return result;
  }

  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    addFinding(
      result.errors,
      'ROOT_UNSAFE',
      '.',
      'Repository root must be a regular directory, not a symbolic link.',
    );
    return result;
  }

  auditPolicy(root, result);
  auditAgents(root, result);
  result.ok = result.errors.length === 0;
  return result;
}

function parseArguments(argv) {
  const options = { root: process.cwd(), hook: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--hook') {
      options.hook = true;
    } else if (argument === '--root') {
      const value = argv[index + 1];
      if (!value) throw new Error('--root requires a path');
      options.root = value;
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

function formatCliResult(result) {
  const profileCounts = SUPPORTED_AGENT_PROFILES.map((profile) => {
    const count = result.agents.filter(
      (agent) => agent.profile === profile,
    ).length;
    return `${profile}=${count}`;
  }).join(', ');
  const lines = [
    'Token efficiency audit',
    `Policy: ${result.policy.valid ? 'PASS' : 'FAIL'} (${result.policy.path})`,
    `Custom agents: ${result.agents.length}`,
    `Profiles: ${profileCounts}`,
  ];

  for (const finding of result.errors) {
    lines.push(`ERROR ${finding.code} ${finding.path}: ${finding.message}`);
  }
  for (const finding of result.warnings) {
    lines.push(`WARN ${finding.code} ${finding.path}: ${finding.message}`);
  }
  if (result.ok && result.warnings.length === 0) {
    lines.push('Result: PASS');
  } else if (result.ok) {
    lines.push('Result: PASS with warnings');
  } else {
    lines.push('Result: FAIL');
  }
  return `${lines.join('\n')}\n`;
}

function formatHookResult(result) {
  if (result.ok) return { continue: true };
  const codes = result.errors.map((finding) => finding.code).join(', ');
  return {
    continue: true,
    systemMessage:
      `Token-efficiency policy check failed (${codes}). ` +
      'Run: node .github/scripts/token-efficiency-audit.mjs',
  };
}

function printHelp() {
  process.stdout.write(
    'Usage: node .github/scripts/token-efficiency-audit.mjs ' +
      '[--root PATH] [--hook]\n',
  );
}

export function runCli(argv = process.argv.slice(2)) {
  const hookRequested = argv.includes('--hook');
  try {
    const options = parseArguments(argv);
    if (options.help) {
      printHelp();
      return 0;
    }
    const result = auditRepository(options.root);
    if (options.hook) {
      process.stdout.write(`${JSON.stringify(formatHookResult(result))}\n`);
      return 0;
    }
    process.stdout.write(formatCliResult(result));
    return result.ok ? 0 : 1;
  } catch {
    if (hookRequested) {
      process.stdout.write(
        `${JSON.stringify({
          continue: true,
          systemMessage:
            'Token-efficiency policy audit could not run. ' +
            'Run it manually for details.',
        })}\n`,
      );
      return 0;
    }
    process.stderr.write(
      'token-efficiency-audit: invalid arguments or audit failure.\n',
    );
    return 2;
  }
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  process.exitCode = runCli();
}
