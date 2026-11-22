# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project
**FridgeWise — "What should I cook today?"**: a student group project. It's a small web app for managing fridge contents, tracking expiry dates and suggesting recipes from what's on hand, giving priority to items that expire soon. The MVP scope comes from the group's spec (written in Hebrew). The app UI is in **English**.

## Tech constraints
- **Plain HTML/CSS/JavaScript only.** There's no build step, framework, npm or bundler: Node and Python aren't installed on the dev machine. Don't add dependencies or tooling.
- The app has to run by double-clicking `index.html` (`file://`), so:
  - use classic `<script>` tags, **not** ES modules (`type="module"` fails on `file://`)
  - make no `fetch()` calls for local files
- Use ES5-style code (`var`, `function`) to match the existing files.
- Data is stored in `localStorage` under the key `fridgewise.v1` (spec §11: local storage in v1). Wrap every storage access in try/catch.

## Structure
| File | Role |
|---|---|
| `index.html` | App shell: Fridge and Cook screens, tab bar, add/edit `<dialog>`, toast |
| `styles.css` | Mobile-first styles. Colours are CSS variables on `:root`, with dark mode via `prefers-color-scheme` |
| `js/data.js` | Static data: `FW.CATEGORIES`, `FW.PRODUCTS` (autocomplete + default shelf life), `FW.ALIASES`, `FW.STAPLES`, `FW.RECIPES` |
| `js/storage.js` | `FW.storage.load()` / `save()` |
| `js/logic.js` | Pure functions with no DOM access: `daysLeft`, `status`, `daysLabel`, `normalize`, `scoreRecipes`, `findProduct` |
| `js/app.js` | Rendering and event wiring (one IIFE, delegated click handler using `data-*` attributes) |

Script load order matters: `data.js` → `storage.js` → `logic.js` → `app.js`. Everything hangs off the global `window.FW`.

## Key rules (from the spec)
- **Expiry colours (§6.3):** green when more than 3 days are left, orange at 1–3 days, red when it expires today or has already expired. The threshold is `SOON_DAYS` in `logic.js`.
- **Never suggest expired food:** items with `daysLeft < 0` are not counted as available. Items expiring today still count.
- **Recipe score** = % of required ingredients you have, plus 5 for each optional ingredient you have, plus an urgency bonus (+40 for an item expiring today, +30 for one expiring in 1–3 days).
- Pantry basics (`FW.STAPLES`) are assumed to be at home and are never shown as missing.
- Ingredient names are matched after `normalize()` using `FW.ALIASES`. Generic "cheese" can be satisfied by several kinds of cheese (`GENERIC` in `logic.js`).
- **Retention ideas (§7.3):** autocomplete with default expiry dates, a recipe hint after 2–3 items, one-tap ✓ / −1 with Undo, and a gentle reminder after 3 days without updates. Keep these when changing the UI.

## Common tasks
- **Add a recipe:** append to `FW.RECIPES` in `js/data.js` with `{ id, name, minutes, tags, ingredients: [{ n, opt? }], steps }`. Ingredient names must be lowercase canonical names. If a product's name differs from the ingredient name, add an alias to `FW.ALIASES`.
- **Add a product:** append to `FW.PRODUCTS` with `{ name, category, shelf, unit }`. `category` must be one of the entries in `FW.CATEGORIES`.
- Escape any user-entered text with `esc()` before inserting it into HTML.

## Testing
There's no test framework. To test manually, open `index.html`, click **Load sample fridge** (the "Daniel" scenario from the spec) and press **What Should I Cook Today?**. Expected result:
- The cottage cheese pan pie ranks first.
- The pasta recipe lists pasta and garlic as missing.

Also check at phone width (375px) and in dark mode.

## Out of scope for the MVP (spec §9–10)
AI agent, barcode scanning, push notifications, automatic shopping list, shared fridge, cloud sync, calories. Don't add these unless asked.

## Git
- Remote: `https://github.com/adansaabni-web/group-` (public), branch `main`.
- `.gitignore` excludes `.claude/`, `FridgeWise.zip`, `.env*` and key files. Never commit secrets or personal data.
