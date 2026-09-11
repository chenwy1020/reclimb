# Project Trash Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a 30-day recoverable “最近删除” workflow that hides deleted projects immediately, restores every association unchanged, and safely purges expired or explicitly discarded projects.

**Architecture:** Store trash state on the project while leaving project-scoped entities and material files untouched until purge. Centralize visibility selectors in shared code and all destructive cleanup in a main-process `ProjectTrashService`; only that service may bypass append-only deletion rules for whole-project purge. Upgrade database and backup format to 6 so 0.4 cannot silently reinterpret trashed projects as active.

**Tech Stack:** Electron, React, TypeScript, sql.js/SQLite, Zod, Vitest, React server rendering, electron-builder.

---

### Task 1: Define project trash state and visibility

**Files:**
- Create: `src/shared/projects.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/schemas.ts`
- Test: `tests/project-trash-state.test.ts`

**Step 1: Write the failing test**

Create project fixtures for active, paused and trashed projects. Assert that `visibleProjects` excludes trashed projects, `trashedProjects` orders newest deletion first, and `trashDaysRemaining` clamps to 0–30 days. Assert that a trashed project records its former status.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/project-trash-state.test.ts`

Expected: FAIL because the project trash selectors and fields do not exist.

**Step 3: Write minimal implementation**

Add optional `trashedAt` and `statusBeforeTrash: 'active' | 'paused'` to `Project`. Add `isTrashed`, `visibleProjects`, `trashedProjects`, and `trashDaysRemaining` with a shared 30-day constant. Extend the persisted project schema with these optional fields without changing existing projects.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/project-trash-state.test.ts`

Expected: PASS.

**Step 5: Commit**

Commit message: `feat: model recoverable project deletion`

### Task 2: Make whole-project database purge atomic

**Files:**
- Modify: `src/main/store.ts`
- Test: `tests/project-trash-store.test.ts`

**Step 1: Write the failing test**

Populate every project-scoped collection for two projects, including fragments and append-only teaching records. Call `deleteProjectRecords(projectId)` and assert that all rows and search terms for only the selected project disappear while the other project and global settings remain.

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/project-trash-store.test.ts`

Expected: FAIL because `deleteProjectRecords` is missing.

**Step 3: Write minimal implementation**

Add a store method that opens one existing outer transaction, deletes every row whose `project_id` matches, removes fragment search terms, and finally deletes the project row. Keep ordinary append-only `remove` behavior unchanged.

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/project-trash-store.test.ts tests/store.test.ts`

Expected: PASS.

**Step 5: Commit**

Commit message: `feat: purge complete project records atomically`

### Task 3: Implement trash, restore and safe file purge

**Files:**
- Create: `src/main/project-trash.ts`
- Modify: `src/main/diagnostics.ts`
- Test: `tests/project-trash-service.test.ts`

**Step 1: Write the failing tests**

Cover moving active and paused projects to trash, idempotent rejection, restoring the prior status, purging material directories and database rows, leaving other projects intact, refusing paths outside `workspace/materials/<materialId>`, rolling moved directories back when database deletion fails, removing expired projects only, and cleaning abandoned deletion staging directories.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/project-trash-service.test.ts`

Expected: FAIL because `ProjectTrashService` and diagnostic clearing do not exist.

**Step 3: Write minimal implementation**

Implement `trash`, `restore`, `purge`, `purgeExpired`, and `cleanStaging`. Validate resolved paths before every recursive operation. Move material folders to a workspace-local staging directory before the database transaction; roll them back on failure. After commit, remove staging and clear short-lived diagnostics. Never invoke a model or modify global settings.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/project-trash-service.test.ts tests/diagnostics.test.ts`

Expected: PASS.

**Step 5: Commit**

Commit message: `feat: safely trash and purge project files`

### Task 4: Expose guarded desktop actions and expiry cleanup

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/learning-service.ts`
- Test: `tests/project-trash-actions.test.ts`
- Test: `tests/service.test.ts`

**Step 1: Write the failing tests**

Exercise `project.trash`, `project.restore`, and `project.purge` through a testable action layer. Assert that learning, material and update operations reject trashed projects, the returned snapshot retains trash records for the settings panel, and startup expiry uses the same purge service. Verify all actions work with no key, no budget and no network.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/project-trash-actions.test.ts tests/service.test.ts`

Expected: FAIL because actions and guards are missing.

**Step 3: Write minimal implementation**

Add the three desktop actions, instantiate the trash service beside the learning service, purge expired items after opening the store, and make normal `requireProject` paths reject trashed projects. Preserve trash entries in the public snapshot so only the settings page can offer restore and purge.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/project-trash-actions.test.ts tests/service.test.ts`

Expected: PASS.

**Step 5: Commit**

Commit message: `feat: expose guarded project trash actions`

### Task 5: Add delete confirmation and recent-deletion management UI

**Files:**
- Create: `src/renderer/ProjectTrash.tsx`
- Modify: `src/renderer/AppModal.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/Materials.tsx`
- Modify: `src/renderer/HomePage.tsx`
- Modify: `src/renderer/Sidebar.tsx`
- Modify: `src/renderer/SettingsPage.tsx`
- Modify: `src/renderer/styles.css`
- Test: `tests/renderer-project-trash.test.ts`
- Test: `tests/renderer-route-v04.test.ts`
- Test: `tests/renderer-sidebar.test.ts`

**Step 1: Write the failing renderer tests**

Render the route page and assert a “删除项目” action is present. Render the confirmation with entity counts and assert the destructive action says “移到最近删除”. Render settings with trashed projects and assert deletion date, remaining days, restore and permanent delete controls. Assert home and sidebar selectors do not show trashed projects.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer-project-trash.test.ts tests/renderer-route-v04.test.ts tests/renderer-sidebar.test.ts`

Expected: FAIL because the controls and filtering are absent.

**Step 3: Write minimal implementation**

Add a dedicated delete modal rather than mixing deletion into target editing. Count project-scoped entities from the current snapshot, save drafts through the existing `run` path, and after success clear project/session/source selection before returning home. Add the recent-deletion panel to settings. Use shared selectors in every normal project list and show clear danger styling without relying on color alone.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer-project-trash.test.ts tests/renderer-route-v04.test.ts tests/renderer-sidebar.test.ts tests/renderer-draft-store.test.ts`

Expected: PASS.

**Step 5: Commit**

Commit message: `feat: manage recently deleted projects in the UI`

### Task 6: Upgrade database, backup and export semantics

**Files:**
- Modify: `src/main/store.ts`
- Modify: `src/main/backup.ts`
- Modify: `src/main/readable-export.ts`
- Test: `tests/migration.test.ts`
- Test: `tests/backup-v6.test.ts`
- Test: `tests/readable-export.test.ts`

**Step 1: Write the failing tests**

Assert that opening a version-5 database creates a `pre-0.4.1` backup and writes user version 6. Assert format-6 backup round-trips trash metadata and material files, format-5 backup remains accepted with projects visible, newer formats are rejected, and readable export excludes trashed projects unless a visible project is explicitly selected.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/migration.test.ts tests/backup-v6.test.ts tests/readable-export.test.ts`

Expected: FAIL on version and trash semantics.

**Step 3: Write minimal implementation**

Bump SQLite user version and backup format to 6, keep format 2–5 readers, add project trash fields to validation, and filter readable export through shared visibility selectors. Keep full backups complete, including recently deleted projects.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/migration.test.ts tests/backup-v2.test.ts tests/backup-v4.test.ts tests/backup-v5.test.ts tests/backup-v6.test.ts tests/backup.test.ts tests/readable-export.test.ts`

Expected: PASS.

**Step 5: Commit**

Commit message: `feat: preserve project trash in format six backups`

### Task 7: Version, documentation and full delivery verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Modify: `README.md`
- Create: `docs/使用说明-0.4.1.md`
- Create: `docs/验证记录-0.4.1.md`
- Create: `docs/开发与扩展-0.4.1.md`
- Create: `docs/IMPLEMENTATION-0.4.1.md`
- Modify: `scripts/source-files.mjs`
- Modify: `scripts/verify-delivery.mjs`
- Create or modify: desktop smoke and package verification scripts for 0.4.1

**Step 1: Add delivery assertions before production changes**

Extend the desktop smoke flow to create two projects, move one to recent deletion, verify it disappears from normal navigation, restore it, delete it again and permanently purge it without affecting the other project. Make package verification require these checks.

**Step 2: Run the focused smoke source test or script check and verify it fails**

Expected: FAIL because version 0.4.1 and the new controls/actions are not yet wired into delivery scripts.

**Step 3: Update version and documentation**

Set application version to 0.4.1, document recent deletion and recovery, preserve the user-modified `docs/使用说明-0.4.md` untouched, and update the source allowlist and delivery report names.

**Step 4: Run complete verification**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Run: development desktop smoke, then `npm run package`, packaged-app verification, `npm run package:source`, source audit and delivery verification.

Expected: all tests and desktop checks pass; no external model request occurs; source archive contains no private data.

**Step 5: Review and deliver**

Run `git diff --check`, review the complete branch, push `codex/v0.4.1-project-trash`, open a private PR, wait for Windows CI, merge after success, and publish a private `v0.4.1` prerelease with installer, source archive and SHA256 list.

Commit message: `chore: prepare Reclimb 0.4.1 delivery`
