# CLAUDE.md

- Refactors must NOT change behavior. Tests pass before and after.
- Run: `node --test tests/*.test.js` after every change (`npm run check` also runs ESLint and the type check; `npm ci` once). Before shipping a UI change, also run the browser tests: `npm run e2e`.
- One ROADMAP.md step per branch (branch name: `step-N-short-name`).
- Small, focused commits with clear messages.
- Never put API keys or secrets in front-end code or in git.
- Ask before adding any dependency. Prefer no build step.
- Bug fixes: write a failing test that shows the bug FIRST, then fix it. The test stays in the suite.
- New features: one-paragraph spec first (problem it solves, how we know it works), approved before any code.
- Plan first. Do not write code until the plan is approved.
- When a step is done: tick it in ROADMAP.md, summarize what changed, list anything you were unsure about.

## Design (styles.css, v108)

- Every size and colour comes from the `:root` tokens: type scale `--fs-1`…`--fs-8` (11, 12, 13, 14, 18, 22, 34, 40), radii `--r-s` (controls) and `--r-l` (cards, blocks), tints `--good-*`, `--warn-*`, `--bad-*`, `--info-*`, `--accent-*` (text, bg, line). No new hex or rgba in a rule; add a token instead (the `:root` block itself holds the literal values; `tests/styles.test.js` fails on a token that points at itself). The only exceptions are the per-group colours of the Telegram tags and the nav chrome sizes.
- One pill (`.v-pill`, `.score-pill`, `.str-pill`, `.like-pill`, `.mood`, `.flow-label`, `.tag` share one shape; a class only sets its colour states). One block (`.flow-block` and friends share one box). One header (`details.section` and `details.fold` look the same). Three button sizes (default 36px, mini 30px, icon); inputs are the button height.
- Dark, dense, one accent (purple), system font, tabular numbers. No animation beyond the chevron turn, no gradients, no new fonts.
- A UI change is a refactor: CSS only where possible, `npm run e2e` before and after, screenshots in the PR.

## Session prompt (paste at the start of each session)

> Read CLAUDE.md, ROADMAP.md and docs/HANDOFF.md. Do the next unchecked step only. Show me the plan first and wait for my approval. Then implement it on a new branch, run the tests, tick the step in ROADMAP.md, and summarize what changed and anything you were unsure about.

## Before approving a plan, check

- Does it stay inside this one step?
- Does it add a dependency? If so, is it worth it?
- Could it change what users see or the numbers they get? If yes, where is the test for that?
- Is anything secret going into the front end or into git?
- For a bug fix: is there a failing test first? For a feature: is there an approved spec?
