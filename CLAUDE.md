# CLAUDE.md

- Refactors must NOT change behavior. Tests pass before and after.
- Run: `node --test tests/*.test.js` after every change. Before shipping a UI change, also run the browser tests: `npm i --no-save playwright` once, then `node tests/e2e/run.js`.
- One ROADMAP.md step per branch (branch name: `step-N-short-name`).
- Small, focused commits with clear messages.
- Never put API keys or secrets in front-end code or in git.
- Ask before adding any dependency. Prefer no build step.
- Bug fixes: write a failing test that shows the bug FIRST, then fix it. The test stays in the suite.
- New features: one-paragraph spec first (problem it solves, how we know it works), approved before any code.
- Plan first. Do not write code until the plan is approved.
- When a step is done: tick it in ROADMAP.md, summarize what changed, list anything you were unsure about.

## Session prompt (paste at the start of each session)

> Read CLAUDE.md and ROADMAP.md. Do the next unchecked step only. Show me the plan first and wait for my approval. Then implement it on a new branch, run the tests, tick the step in ROADMAP.md, and summarize what changed and anything you were unsure about.

## Before approving a plan, check

- Does it stay inside this one step?
- Does it add a dependency? If so, is it worth it?
- Could it change what users see or the numbers they get? If yes, where is the test for that?
- Is anything secret going into the front end or into git?
- For a bug fix: is there a failing test first? For a feature: is there an approved spec?
