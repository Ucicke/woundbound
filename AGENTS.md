<!-- GSD:project-start source:PROJECT.md -->

## Project

**Woundbound**

Woundbound — готический автобаттлер с менеджментом инвентаря для браузера, рассчитанный на джемовый MVP. Игрок ведёт отряд из четырёх обречённых героев через подземелье: разумные проклятые вещи сражаются самостоятельно, а погибшие герои превращаются в заводных кукол, которых нужно поддерживать ручным подзаводом. Игра рассчитана на любителей мрачного фэнтези, roguelite-забегов и тактических головоломок с инвентарём; среди ориентиров — Darkest Dungeon и Backpack Battles.

**Core Value:** Каждая гибель меняет состав и обязанности отряда, а игрок должен одновременно собирать работающие сочетания автономных вещей и не дать заводным куклам остановиться.

### Constraints

- **Платформа**: браузер — целевой формат джемовой версии.
- **Формат**: одиночный забег для джема; в текущей цели нужен полный маршрут на 10–12 комнат с боссом.
- **Неопределённый стек**: движок, язык и библиотеки ещё не выбраны; технические решения предстоит исследовать до построения плана.
- **Ограничение объёма**: сначала реализовать основной цикл и минимальный набор контента; точное расписание джема пока не задано.

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

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Phaser | 4.2.1 | Browser game framework: rendering, scenes, pointer/touch input, assets, audio, tweens | It is the most practical balance of a game-oriented API and simple web deployment for a small 2D game. It includes the scene and input systems this project needs, and supports TypeScript through bundled declarations. The latest official Phaser release page lists 4.2.1. **Confidence: MEDIUM** — Phaser 4 is current and officially supported, though its API ecosystem is newer than Phaser 3's. |
| TypeScript | 6.0.x | Typed combat model, inventory rules, room/run state | A strict, explicit domain model helps keep autonomous item rules, cooldowns, targeting, deaths, and wind-up state understandable. TypeScript 6.0 is a conservative choice for ecosystem compatibility during the TypeScript 7 transition; use explicit `types` and `rootDir` settings because TS 6 changes defaults. **Confidence: MEDIUM** — official TS docs now list 7.0 as available, but library compatibility with Phaser 4.2.1's declarations has not been verified here. |
| Vite | 8.3.7 | Development server, hot reload, production bundling | Phaser's official docs support Vite projects; Vite provides quick native-ESM development and HMR, then creates static files suitable for common web-game hosts. Official releases page identifies Vite 8.3 as the actively patched line. **Confidence: MEDIUM.** |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | 5.1.0 | Unit tests for combat and inventory model | Use for pure TypeScript rules: seeded choice, cooldown boundaries, target selection, adjacent-item modifiers, death/winding transitions, and run outcomes. It reuses Vite configuration and supports TypeScript. Requires Node >=22.12 and Vite >=6.4; the recommendation meets these requirements. **Confidence: MEDIUM.** |
| No additional runtime dependency | — | Grid placement, drag/drop, timers, save | Implement the small fixed inventory grid and drag/drop with Phaser pointer events; use a small seeded PRNG and fixed-step update in the simulation module. Native `localStorage` is enough if a local run-resume or settings save is needed. Avoid adding a UI framework or general-purpose ECS for this jam-sized game. **Confidence: MEDIUM** (engineering fit inferred from project scope and official API capabilities). |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Node.js | Run Vite and Vitest | Use Node 24.22.3 LTS or the latest Node 24 patch. It clears Vitest 5's Node >=22.12 requirement while favoring an LTS line. **Confidence: HIGH.** |
| npm | Package management and scripts | Keep `package-lock.json` committed for reproducible jam builds. Start from Phaser's official Vite TypeScript template or the official project creator, then remove anything unused. **Confidence: MEDIUM.** |

## Installation

# Core

# Supporting

# Optional official Phaser starter

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Phaser 4.2.1 | PixiJS 8.21.0 | Choose PixiJS when the project is primarily a custom-rendered visual experience and the team wants to own scene management, game-loop behavior, and more of the interaction architecture. PixiJS has strong rendering, assets, pointer events, and filters, but it is a rendering engine rather than a batteries-included game framework. **Confidence: MEDIUM.** |
| Phaser 4.2.1 | Godot 4.7.2 with GDScript | Choose Godot when editor-driven authoring and desktop/native builds matter as much as browser delivery. Godot's web export is viable, but produces a WASM-based export with hosting details such as MIME types; threaded export requires cross-origin isolation headers or its PWA workaround. Godot 4 C# projects cannot export to web, so use GDScript for this target. These deployment wrinkles cost time for a browser-first jam MVP. **Confidence: MEDIUM.** |
| TypeScript 6.0 | TypeScript 7.0 | Upgrade after checking Phaser's declaration compatibility and the wider toolchain. TS 7.0 is the current release, but it follows the native compiler transition; TS 6.0 is a cautious baseline for a time-boxed jam. **Confidence: MEDIUM.** |
| Vite 8.3.7 + Vitest 5.1.0 | Phaser's CDN build and manual browser testing | A one-file prototype that will not grow can skip bundling and tests. Woundbound's multiple scenes, content data, and rule interactions benefit from module imports and focused model tests even in a jam. **Confidence: MEDIUM.** |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Godot C# for the browser build | Official Godot docs state Godot 4 C# projects currently cannot export to web. | Phaser + TypeScript, or Godot + GDScript if choosing Godot. |
| Phaser Arcade or Matter physics for combat rules | The encounter is a lane-based, cooldown and effect simulation; there is no requirement for force, collision response, or rigid bodies. Physics adds setup and state that do not help implement item behavior. | A pure TypeScript simulation with explicit timers/events; let Phaser animate visual feedback. |
| React as the primary game UI layer | React is unnecessary for the small fixed game HUD and inventory board, and a dual DOM/canvas scene graph adds coordination work during drag/drop and animation. | Phaser's game objects and pointer input. Add a small DOM overlay only if browser-native text input or accessibility requires it. |
| A full ECS, multiplayer stack, or server runtime | There is one player, a short authored run, and no server requirement in the project brief. These systems would expand architecture and jam risk without delivering the core loop. | Plain TypeScript domain objects/modules and local run state. |
| Phaser 3 for a new greenfield build | Phaser 3 remains a reasonable choice for an existing codebase or a tutorial-dependent team, but official Phaser now lists Phaser 4 as its current framework and publishes Phaser 4 releases. Starting on 3 would add migration risk if the project continues. | Phaser 4.2.1; keep Phaser 3 only when a specific dependency or known team expertise makes it lower risk. |

## Stack Patterns by Variant

- Use Phaser 4 + TypeScript + Vite, with game UI in Phaser and a small DOM shell for title/loading/accessibility needs.
- Keep combat and inventory as pure TypeScript state, separate from Phaser scenes. Drive simulation in fixed time steps (e.g. 50 ms) and inject a seeded RNG so cooldown and target rules do not depend on frame rate or render order.
- Translate model events (`item-triggered`, `damage-applied`, `hero-died`, `doll-wound`) into Phaser animations, particles, speech bubbles, and sounds. Presentation should not mutate combat state directly except through explicit player commands such as winding a doll or moving an item.
- Reconsider Godot 4.7.2 + GDScript before adding significant Phaser-specific content. Keep web export constraints in view; test the target host early.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `phaser@4.2.1` | `vite@8.3.7` | Phaser's official project setup supports bundlers including Vite and its package ships TypeScript declarations. Prefer the official Phaser/Vite starter as the first compatibility check. |
| `vitest@5.1.0` | `vite@8.3.7`, `node@24.22.3` | Vitest 5 requires Vite >=6.4.0 and Node >=22.12.0. Both exceed the documented minimum. |
| `typescript@6.0.x` | `phaser@4.2.1` | Phaser publishes declarations. Compatibility is expected but should be confirmed by running the compiler on the starter, particularly if using Phaser's global `Phaser` namespace types. |

## Sources

- [Phaser 4.2.1 official release/download](https://phaser.io/download/release/v4.2.1) — current listed release, npm install, and supported hand-coded framework context.
- [Phaser installation docs](https://docs.phaser.io/phaser/getting-started/installation) — npm install and included TypeScript declarations.
- [Phaser project templates](https://docs.phaser.io/phaser/getting-started/project-templates) — official bundler templates include Vite and TypeScript variants.
- [Phaser input docs](https://docs.phaser.io/phaser/concepts/input) — unified mouse/touch/keyboard input and draggable game objects.
- [Phaser Arcade Physics docs](https://docs.phaser.io/phaser/concepts/physics/arcade) — limitations and intended simple physics use; used to assess why combat does not need physics.
- [PixiJS version list](https://pixijs.com/versions) — v8.21.0 current stable.
- [PixiJS introduction](https://pixijs.com/8.x/guides/getting-started/intro) and [renderers](https://pixijs.com/8.x/guides/components/renderers) — rendering, asset, event, WebGL/WebGPU scope and production renderer recommendations.
- [Godot 4.7.2 official download page](https://godotengine.org/download/) — latest stable version found.
- [Godot web export docs](https://docs.godotengine.org/en/latest/tutorials/export/exporting_for_web.html) and [feature list](https://docs.godotengine.org/en/stable/about/list_of_features.html) — export file/hosting requirements and C# limitation.
- [Vite releases](https://vite.dev/releases) and [Vite 8 announcement](https://vite.dev/blog/announcing-vite8) — current maintained Vite line and build/development direction.
- [TypeScript 6.0 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html) and [TypeScript download](https://www.typescriptlang.org/download/) — TS 6 changes and TS 7.0 availability.
- [Vitest 5.1 release](https://vitest.dev/blog/vitest-5-1) and [getting started](https://vitest.dev/guide/) — current version, Vite integration, and runtime requirements.
- [Node.js previous releases](https://nodejs.org/en/about/previous-releases) and [Node.js 24.22.3 release](https://nodejs.org/en/blog/release/v24.22.3) — Node 24 LTS status and current patch.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

## Clean Code: ub-mode

- After every task that changes code, review the changed code and its immediate surroundings against the `ub-mode` skill before considering the task complete. Read the locally available skill instructions; if the skill is not installed, use its source at https://github.com/unclebob/ub-mode. If neither is accessible, say so and apply the principles below using the available context.
- Fix the relevant violations found during that review as part of the same task. Each iteration should leave the touched code cleaner and easier to understand than it was: use clear names, small cohesive functions, explicit boundaries, and remove unnecessary duplication and complexity.
- Keep these improvements compatible with the requested behavior and appropriate to the scope of the task. Do not use the rule as a reason to rewrite unrelated parts of the project; report any larger issue that cannot be safely resolved in scope.
- Include the clean-code review in the normal completion checks, and verify the resulting changes as appropriate for their risk.

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

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
