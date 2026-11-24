<!-- GSD:project-start source:PROJECT.md -->

## Project

Woundbound is a gothic browser autobattler with grid inventory. Four heroes descend through 10–12 rooms toward a boss. Cursed items fight automatically. Fallen heroes return as wind-up puppets that the player must keep running.

Runtime: Phaser 4, TypeScript, and Vite. Run `npm run typecheck` and focused Vitest tests for code changes.

<!-- GSD:project-end -->

## Non-negotiable Rendering Constraint

- Render all visible gameplay and game interaction in Phaser Canvas (or raw Canvas 2D when explicitly chosen). Do not build gameplay UI, inventory, battle scenes, dialogs, or controls with HTML/DOM elements. HTML is only the empty browser mount shell; no DOM overlay.
- Phaser owns rendering, pointer/touch input, keyboard input, scenes, and presentation timing. Keep simulation rules in pure TypeScript modules.

## Game Versioning

- Before publishing each playable update, increment the version in `package.json` and the root package entries in `package-lock.json`. Use npm's three-part semantic version format.
- Update `GAME_VERSION` in `src/version.ts` in the same change. Its first three components must match the package version; the fourth is a build component, initially `0`. The player-facing version always has four components.
- Do not increase the version for documentation-only or other changes that do not produce a playable update.

## Generated Item Sprite Cutouts

- Request true transparent backgrounds for generated item sprites. If the generator cannot return reliable alpha, use a flat saturated chroma background (magenta or acid green), never a baked checkerboard or pale grey/white background.
- Keep the untouched generated source and remove the background before atlas packing. The cutout must remove matching background pixels inside closed shapes as well as around the outside silhouette; inspect holes, loops, and thin edges for stray white pixels.
  - When color-key cleanup would erase real highlights, use a per-sprite transparent override instead of globally removing pale pixels. Preserve metallic and glass glints.
- Before wiring a new atlas into Phaser, inspect the sliced sprites over a dark background and run the asset validator. Do not accept an atlas just because its frame boundaries are transparent.
- Diablo is only a reference for varied item kinds (weapons, protection, charms, relics, tools, supplies). Never translate its equipment slots into Woundbound: items stay freely placeable shapes in the backpack grid. A class theme is descriptive and may guide starter curation, but it never restricts who can carry or receive an item.
- For class atlases, generate a transparent 4×4 sheet with one complete distinct object per cell, then trim and pack into transparent 512px frames. Preserve the generated silhouette and aspect ratio in all inventory, reward, and drag previews; inspect at actual gameplay size.

## Combat Actor Atlas Overlap

- Check semantic content inside every actor frame, not only transparent outer borders: the generated hero-4 death pose spills into the rat row of the 6×8, 256px-frame atlas. Keep the first 111px of the rat row transparent in all six frames, leave the untouched source sheet intact, and run `node scripts/validate-pixel-assets.mjs --actors`; its rat-row spill guard catches regressions.
- Whenever a spritesheet is generated, sliced, repacked, or edited, run `node scripts/validate-pixel-assets.mjs <option>` before using it in game. Choose `--actors` for combat actors, `--class-items` for the four runtime item atlases, or `--puppet-deaths` for the final-death puppet atlas and its matching portrait cutouts. If a sheet has no matching validator, add coverage before wiring or changing it. Also inspect every frame visually over a dark background at gameplay size to catch clipped silhouettes, neighboring-frame bleed, bad centering, and transparency artifacts that structural checks cannot detect.

## Local Browser Preview on Windows

- For visual QA, use only the Codex built-in in-app browser. Do not launch or use Chrome for this project; access the live Vite URL through the in-app browser.
- If the Browser skill is absent from the session catalog, check the installed `openai-bundled/browser` plugin and its documentation before concluding that the in-app browser is unavailable. Its `scripts/browser-client.mjs` can be loaded through `node_repl`; `setupBrowserRuntime(...)` may return the agent object directly instead of defining a global `agent`. List the returned agent's browsers and select the `iab` backend. Do not use a Chrome backend as a substitute.
- If Vite reports `ready` but the Codex in-app browser times out on `localhost` or `127.0.0.1`, do not assume the browser is isolated and do not change the game, dependencies, firewall, or bind address. The known cause is the command sandbox blocking loopback access.
- Run the dev server with command-specific elevated permission so Codex can access local loopback. Prefer `npm run dev -- --host 127.0.0.1 --port <free-port> --strictPort`, then open the exact `http://127.0.0.1:<free-port>/` URL in the in-app browser and keep that server process running.
- Check whether the chosen port is occupied first. `--strictPort` prevents Vite from silently choosing another port and leaving the browser pointed at the wrong one. Use the exec command's `require_escalated` permission for this local server only; do not switch to `--host 0.0.0.0`, weaken firewall/security settings, or replace Vite with another server as a workaround.
- This loopback troubleshooting was confirmed in `C:\p\Indie_Game_Forge\games\rus_vs_yashcher\AGENTS.md` on 2026-11-08. The earlier Woundbound preview used the default sandbox and fell back to port 5176; its timeout did not establish that the browser could not reach Windows localhost.

## Visual Audit Archives

- Use the project skill [woundbound-visual-playtest](.claude/skills/woundbound-visual-playtest/SKILL.md) for a repeatable visual audit and fix pass.

- When closing a visual audit, record the fixes and verification in the same Markdown file, then move it and its supporting screenshots into `docs/visual-audits/archive/<audit-name>/` in the same task. Preserve links to the screenshots.
- Keep audits with outstanding findings or required verification in `docs/visual-audits/` unless the user explicitly requests archiving them.

## Clean Code: ub-mode

- After every task that changes code, review the changed code and its immediate surroundings against the `ub-mode` skill before considering the task complete. Read the locally available skill instructions; if the skill is not installed, use its source at https://github.com/unclebob/ub-mode. If neither is accessible, say so and apply the principles below using the available context.
- Fix the relevant violations found during that review as part of the same task. Each iteration should leave the touched code cleaner and easier to understand than it was: use clear names, small cohesive functions, explicit boundaries, and remove unnecessary duplication and complexity.
- Keep these improvements compatible with the requested behavior and appropriate to the scope of the task. Do not use the rule as a reason to rewrite unrelated parts of the project; report any larger issue that cannot be safely resolved in scope.
- Include the clean-code review in the normal completion checks, and verify the resulting changes as appropriate for their risk.

## Serena Language-Server Initialization

- For source-code work, call `initial_instructions` once, then activate the project and await that call before requesting symbols. Do not run `activate_project` and symbol tools in parallel.
- Project activation may finish while language-server startup is still queued. Before symbol queries, check `get_current_config` and wait until `Language server status: ready`.
- If a Serena symbol tool reports that the language-server manager is not initialized, stop further symbol queries and report the error. If the user asks for diagnosis, inspect the referenced Serena log and current config; retry symbol queries sequentially once the server is ready.
- The `InitializeRequestParams` / `clientInfo` warning was non-fatal in the observed startup race; the symbol query ran before asynchronous language-server initialization completed.

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `$gsd-fast` for a trivial task inline, with no subagents and no PLAN.md
- `$gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `$gsd-debug` for investigation and bug fixing
- `$gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `$gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
