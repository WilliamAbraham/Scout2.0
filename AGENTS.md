# Working Conventions

House rules for agents in this repo. These override default behavior.

## Interaction Format

- **Start every message with `hi boss.`**
- **End every message** with a couple of extremely concise sentences summarizing what the cycle just did. No preamble, no bullets — just what happened.

## Git

- **Commit every reasonable change** — small, atomic commits as work lands, not one dump at the end of a session. If a change stands on its own, commit it.
- **Never add yourself as a contributor.** No `Co-Authored-By: Claude` trailer on commits, no "Generated with Claude Code" line in PR bodies.
- Feature branches, PRs to the main branch. Run `yarn lint` and `yarn test` first.

## Documentation

- Keep relevant Markdown files current as work progresses, including `README.md`, `project.md`, `context.md`, and `AGENTS.md` when applicable.
- Update documentation in the same task when behavior, setup, conventions, decisions, verified status, or remaining work changes. Do not wait for a separate request to update it.
- Whenever changes are made, update the relevant Markdown context files and commit and push those updates to the working feature branch in the same task so teammates always have up-to-date context.
- Keep edits focused on the current work, replace stale information, and distinguish verified results from plans or assumptions. Respect read-only snapshots and the ownership boundaries above.

---

# Behavioral Guidelines

Adapted from [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md).

These bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First for Coding

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```less
1. [Step] → verify: [check]
2. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
