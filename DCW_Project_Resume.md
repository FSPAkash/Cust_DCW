# DCW SIOP — Project Resume

**Role:** Sole developer and product owner
**Stack:** Python 3 / Flask, Pandas, scikit-learn, React (CRA), JavaScript (ES6+), HTML5/CSS3
**Domain:** Pigment manufacturing — Sales, Inventory & Operations Planning (SIOP) for a factory-floor color matching workflow
**Scope:** End-to-end design, build, and iteration of a standard-first inventory allocation tool that replaced a legacy pigment-to-order matching prototype

---

## Project Summary

Designed and shipped a production-grade internal web application that lets a factory-floor operator select the pigment standard currently running on the line and instantly see which inventory lots best satisfy open invoice demand, ranked by color-matching models (Euclidean / Cosine / KNN) with full allocation, shortfall, and commit workflows. Owned the full stack: backend API, matching engine, React dashboard, admin data-update console, OCR invoice intake, persistence, and deployment prep.

---

## Technical Contributions

### Backend — Flask API and Matching Engine ([backend/app.py](backend/app.py), 2275 LOC)

- Built a single-service Flask backend serving five stitched CSV datasets (`inventory_lots`, `standard_profiles`, `lot_test_results`, `invoice_headers`, `invoice_lines`) plus an append-only `commit_audit.csv` journal.
- Wrote `load_default_datasets()` / `prepare_df` / `canonicalize_dataset_df` to normalize text and numeric columns, coerce IDs, derive `delta_e = sqrt(dL² + da² + db²)` server-side, and dedupe by business key on every write.
- Implemented method routing per application: `Paint → method_i_b`, `Paint/Plastic → method_i_b`, `Water Based → method_ii`, `Construction → method_ii`.
- Implemented three tolerance modes — `strict` (ΔE ≤ 1.5), `relaxed` (ΔE ≤ 3.5), `review` (unbounded).
- Designed and shipped the core matching engine `rank_candidates()`:
  - Euclidean ΔE-to-target on lot dL/da/db vs invoice target delta
  - Cosine similarity with absolute-LAB fallback when either vector is zero
  - KNN distance on `StandardScaler`-normalized vectors
  - Consensus rank via ordinal sum of the three methods
- Built greedy allocation that consumes lots in consensus-rank order with live inventory depletion, produces full / partial / unfulfilled / unsupported outcomes, and returns before/after inventory summaries with shortfall metrics.
- Retired the legacy pigment/order endpoints with explicit `410 Gone` responses to prevent silent regressions in the frontend.
- Shipped endpoints:
  - `GET /api/standards`, `GET /api/invoices`, `GET /api/notifications`
  - `POST /api/analyze/standard`, `POST /api/invoices/commit`, `POST /api/demo/reset`
  - `POST /api/login`, `POST /api/logout`
  - Admin: `GET /api/admin/datasets`, `GET /api/admin/capabilities`, `GET /api/admin/dataset/<name>/template`, `POST /api/admin/dataset/<name>/validate|apply|row`, `GET /api/admin/customers`, `POST /api/admin/invoice/manual`, `POST /api/admin/invoice/ocr`
- Implemented header-, body-, form-, and query-based `username` identity resolution with `is_admin_request()` guard on every admin route.
- Added OCR invoice intake (pytesseract + pdfplumber + pdf2image) with regex-based parser that cross-references known standard codes from `standard_profiles` and returns a reviewable draft without persisting.
- Built atomic CSV writes with reload after every mutation so in-memory `databases[...]` and on-disk state stay aligned.
- Derived perceptual labels (`delta_e_label`) and LAB→HEX preview swatches (`lab_to_hex`) using method priority `method_i_b → method_ii → method_i_a` to replace a hash-based placeholder.
- Added gunicorn to [backend/requirements.txt](backend/requirements.txt) for production deployment.

### Frontend — React Dashboard ([frontend/src](frontend/src), ~3100 LOC across components)

- Built a standard-first dashboard in React (CRA) with no state manager — hooks + lifted state in [Dashboard.jsx](frontend/src/Dashboard.jsx) (791 LOC) as the single orchestrator.
- Implemented bootstrap flow: `Promise.all([/api/standards, /api/invoices, /api/notifications])` on mount, re-fetched after every mutation.
- Wrote [MatchingFlowTab.jsx](frontend/src/components/MatchingFlowTab.jsx) (492 LOC) — the main operator path — line-by-line ranked candidate view with dynamic fulfill / partial / can't-fulfill actions that recompute allocation live in ranked order.
- Wrote [ResultsTabs.jsx](frontend/src/components/ResultsTabs.jsx) (626 LOC) surfacing Eligible Invoices, Lot Candidates (with Euclidean / Cosine / KNN / consensus metrics and per-method ranks), Allocation, and Inventory Analysis.
- Repurposed `PigmentSelector.jsx` into a standard selector wired to backend `previewHex` / `previewLab` so swatches reflect real LAB conversion, not hash placeholders.
- Built [UpdateDataTab.jsx](frontend/src/components/UpdateDataTab.jsx) (645 LOC) — full admin console with:
  - CSV template download as blob (bypasses SPA router interception)
  - Two-step validate → apply upload with preview, warnings, and append/replace modes
  - Single-row manual append form
  - OCR invoice intake with editable draft review before commit
  - Customer-name autocomplete
- Built [ProductionPanel.jsx](frontend/src/components/ProductionPanel.jsx) showing stock-before, allocated, remaining, demand coverage, shortfall, and coverage status.
- Built [Sidebar.jsx](frontend/src/components/Sidebar.jsx) with standards / lots / invoice lines / unsupported counts and a Refresh Counts action.
- Built [Visualization3D.jsx](frontend/src/components/Visualization3D.jsx) for LAB-space lot visualization.
- Added [config.js](frontend/src/config.js) for `REACT_APP_API_URL` env-based backend targeting (dev vs production).
- Implemented client-side admin gating (`user.type === 'admin'`) while keeping server-side enforcement on every admin route.

### Data Engineering

- Owned the stitched dataset pipeline: joined source spreadsheets (`Main inventory data.xlsx`, `Customer details.xlsx`) into the five canonical CSVs under [backend/stitched_outputs/](backend/stitched_outputs/).
- Designed the business-key contract per dataset: `(lot_no, standard_code)` / `(standard_code, grade, method_id)` / `(lot_no, standard_code, method_id)` / `invoice_id` / `invoice_line_id`.
- Handled the invoice-file auto-pick seam (`bulk_*` preferred over `dummy_*`) so demo and production datasets could coexist.
- Shipped a demo-reset endpoint that restores inventory from a seed workbook and reopens all invoice lines for repeatable sales demos.

### Correctness, Persistence, and Deployment

- Diagnosed and wrote up a gist + localStorage merge bug (lost edits on reload, cross-device stomping) and the fix — per-key `_ts` freshness markers, session-local `dirtyKeys`, `null` on remote fetch failure, and `cache: 'no-store'` — documented in [PERSISTENCE_FIX.md](PERSISTENCE_FIX.md).
- Validated every backend change with `python -m py_compile backend/app.py` and Flask test-client smoke checks.
- Validated every frontend change with `npm run build` in [frontend/](frontend/).
- Wrote [DATA_FLOW.md](DATA_FLOW.md) — a full data-flow audit mapping every endpoint to its caller, every mutation to its follow-on reloads, and every derived field to its producer and consumer.
- Prepared production deployment: added gunicorn, split API URL by env, removed venv from repo, added `.gitignore`.

---

## Soft-Skill Contributions

### Product Ownership

- Translated a vague "we want to match pigments to orders" ask into a concrete standard-first workflow that matches how the operator actually works on the factory floor (operator picks the standard in production; the app does the rest).
- Wrote [APP_CHANGE_PLAN.md](APP_CHANGE_PLAN.md) — a multi-page one-shot correction plan that diagnosed what was wrong with the partially-migrated app, what to keep, what to extend, and an explicit definition of done.
- Pushed back on my own first cutover when it over-simplified lot ranking, and wrote a follow-up correction restoring full Euclidean / Cosine / KNN consensus matching — documented in [CHANGELOG.md](CHANGELOG.md).

### Communication & Documentation

- Maintained a running [CHANGELOG.md](CHANGELOG.md) capturing every material change with file list, scope, reasoning, and validation performed.
- Wrote the full data-flow audit ([DATA_FLOW.md](DATA_FLOW.md)) so a second developer could pick up the system without pairing.
- Wrote the persistence-fix postmortem ([PERSISTENCE_FIX.md](PERSISTENCE_FIX.md)) as a reusable checklist applicable to any dashboard with the same localStorage / remote-store pattern.

### Iteration & Feedback Loops

- Iterated the fulfillment UX from a three-button (Fulfill / Partial / Can't) per-line design to a single state-aware dynamic action button that self-labels based on current inventory ("Fulfill" → "Partially Fulfill" → "Can't Fulfill"), plus a reset-all control — after observing the three-button version was too cluttered.
- Added a live allocation simulator so operator decisions recompute inventory consumption and shortfall in ranked order, without a round-trip to the backend.
- Caught and fixed the hash-based swatch color bug (standard previews were visually wrong) by plumbing real LAB→HEX through the API.

### Quality Discipline

- Held a strict "no silent fallback" rule — missing or malformed stitched files raise clear API errors rather than returning random sample data.
- Kept the old pigment/order endpoints alive as `410 Gone` responses with explicit messages so legacy callers fail loudly, not silently.
- Validated every backend + frontend change with a two-step smoke: `py_compile` / test-client call on the backend, `npm run build` on the frontend.

---

## Selected Outcomes

- Replaced a lot-centric prototype with a standard-first flow that matches factory-floor reality.
- Cut operator decision time from "read the spreadsheet and guess" to "pick a standard and review a ranked list."
- Shipped a reproducible demo path (seed workbook + `/api/demo/reset`) that lets stakeholders rerun scenarios without data contamination.
- Delivered an admin console that lets non-engineers update inventory, standards, QC results, and invoices (manual or OCR) without touching CSVs directly.

---

## Tooling & Practices

Git (feature branches, clean commit history on `main`), Pandas, scikit-learn (`StandardScaler`, KNN, cosine), Flask test client, `python -m py_compile`, `npm run build`, markdown-driven design docs, CSV-first data contracts, atomic write + reload pattern, per-request identity instead of session state.
