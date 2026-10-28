# Decision: safe `{{...}}` expression resolver

## Problem
Node configs contain expressions such as `{{nodes.http-1.output.body.title}}`. The engine must replace them with real values without running any user-supplied code (CLAUDE.md non-negotiable: no `eval`, no `Function`).

## Options considered
| Option | License (checked in repo, 2026-10-28) | Notes |
|---|---|---|
| [lodash `get`](https://github.com/lodash/lodash) | MIT | Walks a path safely, but it is a big dependency for one function, it follows inherited properties, and it does no template parsing. |
| [dot-prop](https://github.com/sindresorhus/dot-prop) | MIT | Small and maintained. ESM only. Blocks `__proto__`/`prototype`/`constructor` when **setting**; we only need **get** plus template parsing on top. |
| [jsonpath-plus](https://github.com/JSONPath-Plus/JSONPath) | MIT | A full query language with filter scripts. It had a critical RCE ([CVE-2024-21534](https://nvd.nist.gov/vuln/detail/CVE-2024-21534), CVSS 9.8, from evaluating script expressions through Node's `vm`), and an early fix was bypassed (CVE-2025-1302). It is far more power than we want. |
| [n8n expressions](https://github.com/n8n-io/n8n) | Sustainable Use License (source-available, **not** open source) | Studied the design only: `{{ }}` delimiters around real JavaScript, run in a sandbox. No code taken. Running real JS is exactly what we must avoid. |

## Choice
Our own small resolver in `backend/src/engine/expressions.js` (about 100 lines with comments). No new dependency.

Why: the work is tiny (split on dots, walk the object), and the part that matters for security is easy to see and test when we own it:
- Only three roots exist: `nodes`, `input` and `item`. Anything else is a validation error.
- A `nodes.<id>` reference must be followed by `output`.
- The walk uses `Object.hasOwn`, so inherited properties are never read. The keys `__proto__`, `prototype` and `constructor` are rejected outright.
- The `{{...}}` regex only *finds* the expressions. The text inside is treated as a path, never as code.

## What was borrowed
Ideas only: the `{{ }}` delimiter style (n8n, Mustache), and dot-prop's list of disallowed keys. No code was copied.

## Risks
- No filters or functions (`| upper`, math). A future need for them should get a small, whitelisted function table, never `eval`.
- A key that contains a dot cannot be addressed. That is acceptable: node ids cannot contain dots (schema regex), and API fields rarely do.
