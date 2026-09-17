# Starfront: Dominion agent instructions

## Project role

Starfront: Dominion is a turn-based multiplayer space strategy game. The server is Express + Socket.IO with SQLite persistence. The legacy game client lives in `client/`; the public React landing page lives in `web/`.

## Working agreements

- Treat the current working tree as user-owned. Inspect `git status` before changing files and never reset, checkout, or discard unrelated work.
- Before coding, inspect the current repository and trace the relevant client/server path. Do not assume a planning conversation describes the current implementation.
- Keep architectural decisions and cross-system rules in `DESIGN.md` or a focused document under `docs/`. Keep transient reasoning in the conversation.
- Prefer small, bounded changes. Avoid multiple workers editing the same subsystem at the same time.
- Preserve the existing deep-space visual language, accessibility behavior, and responsive interaction contracts documented in `DESIGN.md`.
- For frontend work, use native controls, visible focus states, reduced-motion support, and explicit text for status—not color alone.
- For game logic, keep authoritative rules on the server and add or update focused tests for behavior that crosses a route, service, socket, or persistence boundary.
- Do not add fixtures to normal startup. Use disposable test worlds or in-memory databases for tests.

## Validation

Use the narrowest relevant checks first, then broaden when practical:

- `npm run build` for the React landing page.
- `npm test` for the full Node test suite.
- `npm run test:playability` for movement, lane, authentication, and turn-gate coverage.
- `npm run test:world` only when a disposable deterministic browser-playtest world is needed.

When a pre-existing or unrelated test fails, report it clearly and do not rewrite unrelated code to make the task appear clean.

## Efficient agent orchestration

The root execution agent owns architecture, integration, consequential decisions, the final diff, and final verification. Delegate bounded work to the minimum sufficient number of Luna Medium workers:

- explorer: read-only repository reconnaissance and execution-path tracing;
- worker: a narrow implementation in an isolated area;
- tester: focused tests and failure diagnosis;
- reviewer: independent diff and acceptance-criteria audit.

Prefer workers with no inherited conversation history. Give each worker a compact assignment, relevant paths, constraints, and a requested output. Use recent history only when it is genuinely necessary; do not fork the entire parent conversation by default. Parallelize read-heavy investigation, but serialize or partition overlapping edits. Separate implementation from independent verification when the change is meaningful.

Do not create ordinary top-level threads as a workaround for subagents. For a new execution context, use the handoff template in `docs/codex-execution-handoff.md` and start a fresh `/new` thread.

## Delegation Preference

For non-trivial implementation work, prefer delegating clearly bounded coding tasks to `worker` agents rather than having the root agent implement all changes directly.

The root agent should primarily own architecture, task decomposition, integration, conflict resolution, difficult debugging, and final verification.

Use the root agent for direct implementation when:
- the change is very small;
- the implementation is tightly coupled and would be inefficient to delegate;
- workers have failed or produced conflicting results;
- the task requires architectural judgment throughout.

Otherwise, push suitable implementation work to `worker` agents.