# Detailed CRM Summary Rules Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make web summaries consistently retain actionable CRM details without copying filler from the transcript.

**Architecture:** Move the summary instruction into an exported constant so it can be tested directly. Keep the existing JSON fields and business safeguards, add a required-information checklist, and send a low temperature in the existing `qwen-plus` request for more stable results.

**Tech Stack:** Browser ES modules, Alibaba Bailian OpenAI-compatible API, Node.js built-in test runner.

---

### Task 1: Specify detailed summary behavior

**Files:**
- Create: `call-notes/tests/summary-rules.test.mjs`
- Modify: `call-notes/core.js`

**Step 1: Write the failing test**

Test that the exported instruction requires retaining residence, school, grade, scores, goals, course details, prices, objections, confirmed and unconfirmed facts, and next actions when they appear in the transcript.

**Step 2: Run test to verify it fails**

Run: `node --test call-notes/tests/summary-rules.test.mjs`

Expected: FAIL because `SUMMARY_RULES` is not exported yet.

**Step 3: Write minimal implementation**

Create `SUMMARY_RULES` in `call-notes/core.js`, preserve all existing intent, date, reminder, name, and safety rules, and use the constant in `Services.summarize`.

**Step 4: Run test to verify it passes**

Run: `node --test call-notes/tests/summary-rules.test.mjs`

Expected: PASS.

### Task 2: Stabilize repeated summaries

**Files:**
- Modify: `call-notes/tests/summary-rules.test.mjs`
- Modify: `call-notes/core.js`

**Step 1: Write the failing test**

Use a simulated API response and assert that the request keeps `qwen-plus`, JSON output, and sends `temperature: 0.1` without making a network request.

**Step 2: Run test to verify it fails**

Expected: FAIL because the current request does not set temperature.

**Step 3: Write minimal implementation**

Add `temperature: 0.1` only to the summary request. Do not change transcription, name extraction, Feishu access, or save behavior.

**Step 4: Run all offline tests**

Run: `node --check call-notes/core.js && node --test call-notes/tests/*.test.mjs && git diff --check`

Expected: all tests pass and no formatting errors are reported.

### Task 3: Publish and verify

**Files:**
- Modify: `call-notes/index.html`

**Step 1: Bump the browser asset version**

Update the version query for `browser-app.js` and its `core.js` import so existing browsers load the new summary rules.

**Step 2: Publish to `grace-planner/app-hub`**

Upload the tested files to the `main` branch through the authenticated GitHub connection.

**Step 3: Verify the public page**

Open the GitHub Pages URL, confirm the new script version is loaded, and do not call real AI or write Feishu data.
