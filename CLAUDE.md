# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Proton (פרוטון) is an Electron + React desktop app for personal finance management, targeting Hebrew-speaking users (RTL UI, all UI text and most code comments are in Hebrew). All data is local — a single SQLite file via `better-sqlite3`, no cloud/backend. Distributed as a signed Windows installer via `electron-builder` + GitHub releases (`electron-updater` handles auto-update).

## Commands

```bash
npm run dev            # webpack --watch + electron, with wait-on for the bundle (main dev loop)
npm run webpack:watch  # webpack alone, if you don't need the Electron shell running
npm run webpack:build  # production bundle only
npm run dist           # production bundle + electron-builder -> dist-app/
node scripts/seed-demo.js            # seed 3 months of demo data into the live DB
node scripts/seed-demo.js --clean    # remove demo data only
```

There is no test suite, linter, or type checker configured in this repo — do not assume `npm test` or `npm run lint` exist.

`better-sqlite3` is a native module; after `npm install` on a fresh checkout it may need `npx electron-rebuild -f -w better-sqlite3` before Electron can load it (see README).

## Architecture

**No IPC layer for data access.** The `BrowserWindow` is created with `nodeIntegration: true, contextIsolation: false` (`electron/main.js`), so renderer code (everything under `src/`) calls `require('better-sqlite3')` and does direct, synchronous SQL — there is no repository/service/IPC-call boundary between UI and DB. `src/db/index.js` opens the single shared `Database` instance (WAL mode, foreign keys on) and every page requires it directly: `const db = require('../db/index.js')`. `electron/main.js` (the main process) only handles OS-level concerns that the renderer can't do itself: window/menu chrome, auto-update, and DB backup/restore/wipe file operations (`export-db`, `import-db`, `safe-delete-db` over `ipcMain.handle`).

**No JSX transform in practice.** Files use the `.jsx` extension and Babel's `@babel/preset-react` is wired into webpack, but the actual code is written with `React.createElement(...)` calls, not `<tag>` syntax — no page in `src/pages` uses JSX literals. Follow this convention (`React.createElement`, not `<div>`) when writing or editing components. Every file uses plain CommonJS (`require`/`module.exports`), not ES module `import`/`export`.

**Schema lives in code, not migration files.** `src/db/index.js` runs `CREATE TABLE IF NOT EXISTS` for the full schema on every startup, plus a sequence of `try { db.exec('ALTER TABLE ... ADD COLUMN ...') } catch {}` statements above it for incremental schema changes (the try/catch is the idempotency mechanism — it silently no-ops when the column already exists). When adding a column to an existing table, add a new guarded `ALTER TABLE` statement here rather than editing the `CREATE TABLE` block (existing installs already have the table). Default categories are seeded once, guarded by a row-count check.

**Page-per-feature, no router.** `src/App.jsx` holds `currentPage` state and switches between page components with plain `if` statements in `renderPage()` — there's no router library. Global `Alt+<key>` shortcuts (including Hebrew letter keys, e.g. `Alt+ק` for categories) are bound in a `keydown` listener in `App.jsx` and mapped to page names there. Each top-level screen is one file in `src/pages/` (e.g. `Transactions.jsx`, `Import.jsx`, `NetWorth.jsx`); some of these are large (Transactions.jsx and NetWorth.jsx are 1000+ lines) because each owns its full CRUD UI, modals, and query logic inline rather than splitting into subcomponents.

**Cross-entity linking via nullable FK columns on `Transactions`.** Transactions can be linked to the feature that generated them — `liability_id`, `insurance_id`, `recurring_id`, `settles_credit_card_id` — plus `parent_id`/`offset_group_id` for split and offset transactions. When touching transaction linking logic (splits, recurring-template-generated transactions, loan schedules), check all of these FK columns, not just the obvious one for the feature being edited.

**External price data** (`src/db/priceService.js`) fetches quotes from Yahoo Finance's unauthenticated chart endpoint (no API key), cached in the `Price_Cache` SQLite table with a 1-hour TTL, with manual price override as fallback. This is the only outbound network call in the app besides `electron-updater`'s GitHub release check.

**Dev backlog.** `הערות פיתוח.MD` (Hebrew) is a running TODO/notes list the user maintains manually, with `~~strikethrough~~` marking completed items. It's not architecture documentation — treat it as an informal backlog, not a spec.

## Data storage

The SQLite file lives outside the repo at `%APPDATA%\proton\proton.db` (`path.join(os.homedir(), 'AppData', 'Roaming', 'proton')`), overridable via the `PROTON_DB_PATH` env var (used by `scripts/seed-demo.js` to target a non-default location). Crash logs go to `crash.log` in the same directory (`crashLogger.js`, rotated at 5MB).
