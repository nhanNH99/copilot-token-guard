---
name: react-jest-test-authoring
description: Plan and author behavior-focused React Jest tests with deterministic local lint, coverage, and approval gates. Use with the Jest Test Agent.
user-invocable: false
disable-model-invocation: false
---

# React Jest test authoring

Use the repository's existing Jest and React Testing Library conventions before
introducing new helpers or mocks.

## Planning rules

- Map each user-visible state and source branch to a test case.
- Prefer behavior assertions through roles, names, text, and interactions.
- Treat loading, empty, error, success, disabled, and permission states as
  separate cases when the component implements them.
- Mock network boundaries with the repository's MSW setup when available.
- Mock modules only when the real dependency is nondeterministic or outside the
  test boundary.

## Request file

After the user replies `oke`, the agent writes:

```json
{
  "schemaVersion": 1,
  "targets": [
    {
      "path": "src/components/Example.tsx"
    }
  ],
  "tests": [
    "src/components/Example.test.tsx"
  ],
  "artifacts": [
    "src/components/__mocks__/example.ts"
  ]
}
```

Omit `artifacts` when the plan does not create or change mocks, fixtures, or
test utilities.

For an unchanged legacy target, add exact positive line numbers:

```json
{
  "path": "src/components/Legacy.tsx",
  "requiredLines": [24, 37],
  "requiredBranchLines": [37]
}
```

The runner computes new and modified file gates from Git. Never put commands,
Jest arguments, or paths outside the repository in the request.

## Coverage interpretation

- New source file: statements, branches, functions, and lines are all 100%.
- Modified source file: every changed executable statement and every branch
  arm associated with changed source lines is covered.
- Unchanged legacy source: every approved required line and branch arm is
  covered.
- Passing coverage does not justify weak assertions. Each test must prove a
  behavior or contract.
