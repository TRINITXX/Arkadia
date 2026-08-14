# Inactive Project Recent Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep inactive projects compact, reveal a project's recent Claude discussions only after its row is clicked, and preview a clicked transcript directly in the main terminal area.

**Architecture:** Reuse the existing `list_claude_sessions` backend index, project resolution rules, and `ModernConversationView`. Do not scan sessions merely because Inactive is visible: clicking a project opens a single-project accordion and triggers the one-shot index load. Clicking a title then mounts the modern transcript reader in the main pane, while the explicit `Reprendre` action remains the only place that launches `ccd --resume`.

**Tech Stack:** React 18, TypeScript, Vitest, Tauri invoke API, Tailwind CSS.

## Global Constraints

- Only the Inactive project rows lose their visible path subtitle.
- Show no discussions in the default Inactive list.
- Clicking a project reveals its two most recent discussions and closes any other project's discussion list.
- Clicking the open project again closes its discussion list.
- Each `Voir plus` reveals exactly two more discussions; `Voir moins` collapses the list to two.
- Clicking a discussion previews it directly in the main terminal area with an explicit resume button.
- Do not open the global `Sessions récentes` overlay from a project discussion.
- Do not add a second transcript reader or a second resume implementation.

---

### Task 1: Derive sidebar sessions and two-row pagination

**Files:**
- Modify: `src/lib/sessionsIndex.ts`
- Test: `src/lib/sessionsIndex.test.ts`

**Interfaces:**
- Produces: `recentSessionsByProject(sessions, projects): Record<string, ClaudeSession[]>`
- Produces: `nextSidebarSessionCount(shown, total): number`
- Produces: `toggleSidebarSessionProject(openProjectId, clickedProjectId): string | null`

- [ ] **Step 1: Write failing tests** proving sessions are attached with the existing longest-prefix project rule, sorted newest-first, and revealed two at a time.
- [ ] **Step 2: Run `npm run test -- src/lib/sessionsIndex.test.ts`** and confirm failure because the helpers do not exist.
- [ ] **Step 3: Implement the minimal pure helpers** using `resolveProjectTarget` and literal session-id membership.
- [ ] **Step 4: Run `npm run test -- src/lib/sessionsIndex.test.ts`** and confirm the focused tests pass.

### Task 2: Connect the Inactive sidebar to the existing session reader

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Sidepanel.tsx`

**Interfaces:**
- Consumes: the three session helpers from Task 1.
- Produces: `Sidepanel` props for per-project sessions and `onOpenSession(session)`.
- Produces: a read-only `ClaudeSession` preview state in `App`.

- [ ] **Step 1: Load the session index in `Sidepanel` only after a project click** and derive per-project lists with the tested helper.
- [ ] **Step 2: Keep every project collapsed by default**, load the index only after a project click, render its first two session-title buttons, and paginate by two.
- [ ] **Step 3: Render the clicked transcript with `ModernConversationView` in the main terminal area** without opening `SessionsOverlay`.
- [ ] **Step 4: Keep the existing `Reprendre` and already-open-session behavior unchanged.**

### Task 3: Verify the integrated change

**Files:**
- Verify only; no additional production files expected.

- [ ] **Step 1: Run `npm run test -- src/lib/sessionsIndex.test.ts`.**
- [ ] **Step 2: Run `npx tsc --noEmit`.**
- [ ] **Step 3: Run `npm run lint`.**
- [ ] **Step 4: Run `npm run test`.**
- [ ] **Step 5: Inspect `git diff --check` and the final scoped diff.**
