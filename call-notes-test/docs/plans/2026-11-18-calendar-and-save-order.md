# Calendar And Safe Batch Save Implementation Plan

**Goal:** Update the isolated web test channel with concise summaries, correct same-customer batch ordering, a fixed review close control, and cloud-ready calendar/schedule views.

**Architecture:** Keep the queue record shape as the single view-model source. Calendar helpers accept plain record arrays, so a future cloud repository can replace IndexedDB without changing calendar rendering. No cloud synchronization is claimed or implemented in this change.

**Tech Stack:** Static HTML/CSS/JavaScript, IndexedDB browser adapter, Node built-in test runner.

---

### Task 1: Lock business rules with tests

**Files:**
- Modify: `call-notes-test/tests/summary-rules.test.mjs`
- Create: `call-notes-test/tests/batch-save-order.test.mjs`

Add assertions that summaries omit absent-information inventories and the current consultant name, while retaining other teachers when context supports them. Add a same-customer save test proving the newest call is written first and older calls append logs only.

### Task 2: Add cloud-ready calendar selectors

**Files:**
- Modify: `call-notes-test/queue-view.js`
- Create: `call-notes-test/tests/calendar-view.test.mjs`

Add pure helpers for day keys, visible records, date ranges, month cells, counts, chronological ordering, and display names. Exclude trash by default; include inbox and archive records.

### Task 3: Implement calendar and schedule UI

**Files:**
- Modify: `call-notes-test/index.html`
- Modify: `call-notes-test/renderer.js`
- Modify: `call-notes-test/style.css`

Add a Calendar sidebar page with 1-day, 3-day, 7-day, and month modes. Use recording time from filenames, show daily counts and names, and open existing draft review when available.

### Task 4: Improve review dialog close behavior

**Files:**
- Modify: `call-notes-test/index.html`
- Modify: `call-notes-test/renderer.js`
- Modify: `call-notes-test/style.css`

Add a sticky top-right close button and remove the bottom close button while keeping the confirm action.

### Task 5: Verify and publish only the test channel

Run all offline tests and syntax checks, visually inspect the local page at desktop and narrow widths, then publish only `call-notes-test/`. Confirm the public test URL serves the new cache version. Do not change the formal `call-notes/` channel.
