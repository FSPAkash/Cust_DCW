# Change Log - Standard-First Cutover

Date: 2026-04-08

## Scope
- Implemented the one-shot cutover defined in `APP_CHANGE_PLAN.md`.
- Replaced pigment/order matching flow with standard-first inventory allocation flow.
- Preserved existing UI styling system; updated data wiring, labels, and business content.

## Files Changed

### 1) `backend/app.py`
- Replaced old in-memory pigment/order model with stitched dataset tables:
  - `inventory_lots`
  - `standard_profiles`
  - `lot_test_results`
  - `invoice_headers`
  - `invoice_lines`
- Added strict startup loading from:
  - `backend/stitched_outputs/inventory_lots.csv`
  - `backend/stitched_outputs/standard_profiles.csv`
  - `backend/stitched_outputs/lot_test_results.csv`
  - `backend/stitched_outputs/dummy_invoice_headers.csv`
  - `backend/stitched_outputs/dummy_invoice_lines.csv`
- Removed random sample fallback behavior. Missing/invalid stitched files now produce clear API errors.
- Added method routing rules by application:
  - `Paint -> method_i_b`
  - `Paint/Plastic -> method_i_b`
  - `Water Based -> method_ii`
  - `Construction -> method_ii`
- Added tolerance modes:
  - `strict`, `relaxed`, `review`
- Added new endpoints:
  - `GET /api/standards`
  - `GET /api/invoices`
  - `POST /api/analyze/standard`
- Implemented standard analysis engine:
  - invoice eligibility and support checks
  - lot candidate ranking by `fitDeToTarget`, then available qty, then lot id
  - greedy allocation with running lot depletion
  - full/partial/unfulfilled/unsupported outcomes
  - inventory before/after summaries and shortfall metrics
  - global unsupported invoice line reporting
- Retired old endpoints with explicit `410` responses:
  - `/api/match/pigment-to-orders`
  - `/api/database/pigments`
  - `/api/database/orders`
  - upload endpoints for pigments/orders

### 2) `frontend/src/Dashboard.jsx`
- Rewired startup data loading:
  - `GET /api/standards`
  - `GET /api/invoices`
- Replaced pigment analysis call with:
  - `POST /api/analyze/standard`
- Updated sidebar props to stitched-data counts.
- Updated result banner and component wiring to use standard-first response payload.

### 3) `frontend/src/components/PigmentSelector.jsx`
- Kept component/layout shell; repurposed behavior to standard selection.
- Updated user-facing text from pigment to standard.
- Dropdown now shows:
  - `standardCode`, `grade`, `inventoryQtyMt`, `lotCount`
- Preview card now shows standard metadata (not lot choice).
- Visual selector still works; swatches are deterministic per standard code.

### 4) `frontend/src/components/ProductionPanel.jsx`
- Replaced pigment-centric recommendation copy with standard-centric inventory analysis.
- Shows:
  - stock before
  - allocated qty
  - remaining qty
  - demand coverage
  - shortfall
  - invoice coverage statuses (full/partial/unfulfilled/unsupported)

### 5) `frontend/src/components/ResultsTabs.jsx`
- Kept tab shell, changed business content to:
  - `Eligible Invoices`
  - `Lot Candidates`
  - `Allocation`
  - `Inventory Analysis`
- Added tables for invoice eligibility, lot candidates, allocation outcomes, and unsupported lines.

### 6) `frontend/src/components/Sidebar.jsx`
- Replaced pigment/order stats with:
  - `Standards`
  - `Lots`
  - `Invoice Lines`
  - `Unsupported`
- Updated upload section language to reflect current mode:
  - stitched CSV auto-load active
  - workbook/zip upload redesign pending
- Added `Refresh Counts` action.

## Validation Performed
- Backend syntax check:
  - `python -m py_compile backend/app.py`
- Backend API smoke checks (Flask test client):
  - `GET /api/standards` -> 200
  - `GET /api/invoices` -> 200
  - `POST /api/analyze/standard` (`325`, `strict`) -> 200
- Frontend production build:
  - `npm run build` (in `frontend`) -> success

## Rollback Notes
- Primary rollback file is `backend/app.py` for API/model behavior.
- Frontend rollback files are:
  - `frontend/src/Dashboard.jsx`
  - `frontend/src/components/PigmentSelector.jsx`
  - `frontend/src/components/ProductionPanel.jsx`
  - `frontend/src/components/ResultsTabs.jsx`
  - `frontend/src/components/Sidebar.jsx`
- Reverting these files restores old pigment/order flow behavior.

---

## Correction Update - Model-Based Lot Matching Restored

Date: 2026-04-08 (follow-up correction)

### Why this correction was made
- The first cutover kept standard-first flow but simplified lot ranking too much.
- Requirement clarified: lot matching must explicitly use model-based methods (Euclidean, Cosine, KNN) and dL/da/dB relative to standard reference.

### Backend adjustments in `backend/app.py`
- Added model scoring over candidate lots (per invoice line):
  - `euclideanDeltaE`
  - `cosineSimilarity`
  - `cosineAngularDistance`
  - `knnDistance`
  - ranks: `euclideanRank`, `cosineRank`, `knnRank`
  - combined: `consensusScore`, `consensusRank`
- Candidate vector basis now uses lot `delta_l`, `delta_a`, `delta_b` (with fallback to absolute-reference delta when needed).
- Added invoice target delta derivation:
  - `targetDelta` from invoice target LAB minus method reference LAB.
- Allocation ordering changed to:
  - `consensusRank` first
  - then remaining lot qty
  - then stable lot code
- Allocation payload now includes selection reasoning fields per picked lot:
  - `consensusRank`, `consensusScore`, `euclideanDeltaE`, `cosineSimilarity`, `knnDistance`
- Added policy marker:
  - `lotSelectionPolicy: consensus_rank_then_remaining_qty`

### Frontend adjustments

#### `frontend/src/components/ResultsTabs.jsx`
- Candidate tab now displays model outputs for each lot:
  - dL/dA/dB
  - Euclidean/Cosine/KNN metrics
  - per-method ranks
  - consensus rank/score
- Allocation tab now shows lot selection reasoning:
  - consensus rank and key model metrics for each allocated lot
  - policy column

#### `frontend/src/components/ProductionPanel.jsx`
- Updated panel copy to explicitly mention model-driven lot ranking.
- Added action item indicating Euclidean + Cosine + KNN consensus usage.

### Validation performed for this correction
- `python -m py_compile backend/app.py` passed
- API smoke check on `/api/analyze/standard` confirmed model fields in:
  - `lotCandidatesByInvoiceLine`
  - `allocation[].allocations[]`
- `npm run build` in `frontend` passed

### Ranking UI follow-up
- Restored ranking-style presentation in candidate matching view:
  - each invoice line now shows a `Top 3 Ranked Lots` section
  - full candidate table now includes explicit rank column (`consensusRank`)
  - candidates are sorted by consensus rank and displayed in ranked order
- File changed:
  - `frontend/src/components/ResultsTabs.jsx`
- Validation:
  - `npm run build` in `frontend` passed

### Dynamic fulfillment controls follow-up
- Added interactive user decisions per ranked invoice line:
  - `Fulfill`
  - `Partial`
  - `Can't`
- Decisions are available in both:
  - `Eligible Invoices` tab
  - `Allocation` tab
- Added dynamic allocation simulation in dashboard:
  - recalculates lot consumption in ranked order using consensus-ranked candidate lots
  - updates allocation rows, inventory summary, and inventory analysis counts live after every decision change
  - supports full-only behavior (`Fulfill` = allocate only if full quantity can be met), partial behavior (`Partial`), and no allocation (`Can't`)
- Files changed:
  - `frontend/src/Dashboard.jsx`
  - `frontend/src/components/ResultsTabs.jsx`
- Validation:
  - `npm run build` in `frontend` passed

### Fulfillment action model correction
- Replaced three-action-per-line controls with one dynamic action button per invoice line.
- New action behavior:
  - shows `Fulfill` when full quantity is currently possible
  - shows `Partially Fulfill` when only partial quantity is possible
  - shows `Can't Fulfill` when no quantity is currently possible
- Action button is now single-choice and state-aware:
  - once action is applied, button text reflects applied outcome (e.g., `Fulfilled`)
  - lines without applied action remain in `pending` until user acts
- Allocation and inventory are recalculated live after each applied action in ranked order.
- Added reset control to clear all applied decisions and recalculate from baseline.
- Files changed:
  - `frontend/src/Dashboard.jsx`
  - `frontend/src/components/ResultsTabs.jsx`
- Validation:
  - `npm run build` in `frontend` passed

### Color preview correction (LAB -> HEX)
- Fixed standard swatch color logic to use real LAB conversion instead of hash-based placeholder colors.
- Backend now derives preview color from `standard_profiles` reference LAB (method priority: `method_i_b`, `method_ii`, `method_i_a`) and returns:
  - `previewMethodId`
  - `previewLab`
  - `previewHex`
- Frontend selector now uses backend `previewHex` for selected preview and visual chips.
- Files changed:
  - `backend/app.py`
  - `frontend/src/components/PigmentSelector.jsx`
- API verification:
  - `GET /api/standards` now returns red-toned preview HEX for `325`/`3249B` instead of hash colors.
