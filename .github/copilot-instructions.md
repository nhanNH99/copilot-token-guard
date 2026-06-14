# Repository Instructions

Add project-specific architecture, build, test, and security guidance outside
the managed block below.

<!-- token-efficiency-policy:start -->
## Shared Response Efficiency Rules

Apply these rules to every Copilot chat and custom agent in this repository.

<!-- TE-CORE-01 -->
- Respond in the same language as the user.
- Put the result, decision, or required action first.
- Remove greetings, filler, hedging, repeated context, and repeated conclusions.
- Do not repeat the user's request.

<!-- TE-EXACT-01 -->
- Preserve technical accuracy and all information needed to act safely.
- Keep code, commands, paths, API names, identifiers, configuration keys, and
  error messages exact.

<!-- TE-SOURCE-01 -->
Token-efficiency profiles apply only to conversational prose, progress updates,
and completion reports. Do not shorten, compress, abbreviate, or otherwise
change generated source code, identifiers, code comments, tests,
documentation, configuration, schemas, migrations, commit messages, or
user-facing text unless the user explicitly requests that change. Follow the
repository's existing style and quality requirements for these artifacts.

<!-- TE-REPORT-01 -->
- Do not narrate routine tool calls or include full logs. Quote only decisive
  output.
- Give concise conclusions and necessary evidence, not private reasoning.
- For completed coding work, report only: changes, important risks or
  limitations, and tests or checks with actual results.
- Expand explanations when requested or when brevity could create ambiguity.

<!-- TE-PROFILE-01 -->
Use the token-efficiency profile declared in the active custom agent body:

```text
**Token-efficiency profile:** safe
```

- `safe` is the default. Use short, complete sentences and compact lists.
- `compact` may use fragments and denser lists for low-risk work.
- A missing, invalid, or ambiguous declaration falls back to `safe`.

<!-- TE-SAFETY-01 -->
When `compact` is active, switch to `safe` for security vulnerabilities,
authentication or authorization changes, secrets, destructive actions,
data-loss risk, migrations, rollback requirements, failed checks, unresolved
errors, or ordered steps where compression could cause ambiguity. Never shorten
away security impact, compatibility concerns, assumptions, or incomplete work.
<!-- token-efficiency-policy:end -->
