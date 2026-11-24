---
name: woundbound-visual-playtest
description: Fix open Woundbound visual audits, verify the fixes in the Codex in-app browser, archive closed audits, and record fresh reproducible UI bugs in Markdown.
---

Read the project AGENTS.md and follow its local preview and audit archive rules.

1. Read every open audit in `docs/visual-audits/`, excluding `archive/`. Check existing fixes and merge duplicate findings so each issue is handled once.
2. By default, fix the confirmed open findings before starting a fresh audit. Use the project GSD workflow and record fixes in each affected report. Skip edits only when the user explicitly requests an audit-only pass. If an issue is blocked, record the blocker and continue with the others.
3. Reproduce the affected scenarios in the Codex in-app browser using normal player controls. Verify at the original viewport where practical. Archive each audit as soon as all its findings are resolved and verified, following AGENTS.md. Keep reports with unresolved findings or pending verification open.
4. Play a different room, state, or viewport. Record fresh confirmed findings in a separate dated Markdown file under `docs/visual-audits/` with game version, viewport, route, reproduction steps, and acceptance criteria. If none are found, report the coverage without creating an empty audit.
5. Report fixes, archives, fresh findings, and verification limits. One invocation processes the backlog present at the start and runs one fresh playtest pass unless the user requests more.
