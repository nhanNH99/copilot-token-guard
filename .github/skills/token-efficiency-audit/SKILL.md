---
name: token-efficiency-audit
description: Audit shared GitHub Copilot token-efficiency policy and custom agent coverage. Use when checking whether repository-wide output rules are installed safely or duplicated across agents.
argument-hint: "[optional repository path]"
disable-model-invocation: true
---

# Token efficiency audit

Run the repository-local audit:

```bash
node .github/scripts/token-efficiency-audit.mjs
```

If the user supplies a repository path, run:

```bash
node .github/scripts/token-efficiency-audit.mjs --root "<repository-path>"
```

Report only:

1. Policy status.
2. Number of custom agents found and resolved profile counts.
3. Error and warning codes with affected relative paths.
4. Manual remediation required.

Do not edit files, install packages, access the network, inspect transcripts, or
read unrelated repository content. Do not claim the policy is active in VS Code
unless the user verifies it through Chat Diagnostics or response References.
