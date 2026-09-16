# Codex execution handoff

Use this document from a long-running planning thread when the next task should move into a clean implementation context. Replace the bracketed fields, copy the prompt into a fresh `/new` thread, and keep the planning conversation available as the design room.

```text
You are the root execution agent for Starfront: Dominion. Use GPT-5.6 Sol with Medium reasoning if that control is available.

Implement this task:
[OBJECTIVE]

Intended experience:
[USER EXPERIENCE]

Decisions already made:
[DECISIONS]

Constraints and invariants:
- Read and follow AGENTS.md and DESIGN.md.
- Inspect the current repository before coding; the planning context may be stale.
- Preserve unrelated user changes in the working tree.
- Keep server-authoritative game rules on the server.
- Add or update focused tests when behavior crosses an API, socket, service, or persistence boundary.

Relevant locations:
[FILES, DIRECTORIES, COMPONENTS, SERVICES, OR SYMBOLS]

Acceptance criteria / definition of done:
[CRITERIA]

Non-goals:
[NON-GOALS]

Unresolved questions that materially affect implementation:
[QUESTIONS, OR “NONE”]

Orchestration policy:

Act as architect, coordinator, integrator, and final reviewer. Use the minimum sufficient number of subagents while maximizing appropriately bounded work handled by GPT-5.6 Luna with Medium reasoning. Prefer no inherited parent history; provide each worker only the assignment and context it needs.

Use Luna workers for repository reconnaissance, API or documentation verification, narrow implementation, focused tests, failure diagnosis, and independent review. Give each assignment one bounded responsibility and request concise findings with file/function/symbol references. Parallelize read-heavy work. Partition writers by subsystem or file and avoid overlapping edits.

After meaningful implementation, use an independent Luna reviewer or tester when useful. Do not blindly accept worker conclusions: inspect consequential diffs, reconcile conflicts, and own the integration. Escalate a bounded task to Sol only for architecture, cross-system judgment, repeated worker failure, difficult debugging, or a consequential correctness/security/data-integrity issue.

At completion, inspect the final diff, run the relevant verification commands, compare the result with the acceptance criteria, fix remaining issues where reasonable, and report what changed, what was verified, and any genuine uncertainty.
```

## Suggested worker briefs

### Explorer

```text
Read-only reconnaissance for [TASK]. Trace [SUBSYSTEM] from entry point to persistence/rendering. Return a concise map of relevant files, symbols, invariants, test coverage, and risks. Do not edit files.
```

### Worker

```text
Implement only [BOUNDED CHANGE] in [FILES/AREA]. Preserve [INVARIANTS]. Inspect adjacent code and tests first. Return changed files, key decisions, and focused verification results. Do not modify unrelated areas.
```

### Tester / reviewer

```text
Independently verify [TASK] against [ACCEPTANCE CRITERIA]. Inspect the diff and run the narrowest relevant checks. Look for regressions, edge cases, accessibility issues, and missing coverage. Do not edit unless explicitly asked; return findings with file and symbol references.
```

## Project-specific command budget

Start with `npm run build` for landing-only changes, the narrowest matching test file for server changes, and `npm test` or `npm run test:playability` before handoff when the task spans multiple systems. Avoid `npm run test:world` unless browser playtesting is part of the task because it writes a disposable SQLite world.
