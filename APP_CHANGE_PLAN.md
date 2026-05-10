# Standard-First App Change Plan

## Goal

The app should work from the **standard currently in production**.

The operator should not choose a lot.

The app should:

1. load selectable standards from our stitched data
2. find invoice lines that belong to that standard
3. use the matching methods to identify the **correct lots** for those invoice lines
4. allocate inventory from those ranked lots
5. show inventory coverage, shortfall, and lot-level reasoning

No UI styling, layout language, colors, or visual design direction should change. Only behavior, labels, data flow, and business logic should change.

---

## Current Codebase State

The app is already partially converted to the new workflow.

### Backend state right now

Current backend in [backend/app.py](c:/Users/AkashPatil/DCW%20SIOP/backend/app.py):

- already loads stitched CSVs from `backend/stitched_outputs`
- already exposes `/api/standards`
- already exposes `/api/invoices`
- already exposes `/api/analyze/standard`
- already retires old pigment/order endpoints
- already filters inventory by selected `standardCode`
- already resolves target method from application rules
- already builds candidate lots and performs greedy allocation

Current backend data sources are:

- [backend/stitched_outputs/inventory_lots.csv](c:/Users/AkashPatil/DCW%20SIOP/backend/stitched_outputs/inventory_lots.csv)
- [backend/stitched_outputs/standard_profiles.csv](c:/Users/AkashPatil/DCW%20SIOP/backend/stitched_outputs/standard_profiles.csv)
- [backend/stitched_outputs/lot_test_results.csv](c:/Users/AkashPatil/DCW%20SIOP/backend/stitched_outputs/lot_test_results.csv)
- [backend/stitched_outputs/dummy_invoice_headers.csv](c:/Users/AkashPatil/DCW%20SIOP/backend/stitched_outputs/dummy_invoice_headers.csv)
- [backend/stitched_outputs/dummy_invoice_lines.csv](c:/Users/AkashPatil/DCW%20SIOP/backend/stitched_outputs/dummy_invoice_lines.csv)

### Frontend state right now

Current frontend is also already partly converted:

- [frontend/src/Dashboard.jsx](c:/Users/AkashPatil/DCW%20SIOP/frontend/src/Dashboard.jsx) now loads standards and invoice summary
- [frontend/src/components/PigmentSelector.jsx](c:/Users/AkashPatil/DCW%20SIOP/frontend/src/components/PigmentSelector.jsx) is already repurposed into a standard selector
- [frontend/src/components/ResultsTabs.jsx](c:/Users/AkashPatil/DCW%20SIOP/frontend/src/components/ResultsTabs.jsx) already shows:
  - eligible invoice lines
  - lot candidates
  - allocation
  - inventory analysis
- [frontend/src/components/ProductionPanel.jsx](c:/Users/AkashPatil/DCW%20SIOP/frontend/src/components/ProductionPanel.jsx) already shows standard-level inventory coverage
- [frontend/src/components/Sidebar.jsx](c:/Users/AkashPatil/DCW%20SIOP/frontend/src/components/Sidebar.jsx) already shows standards, lots, invoice lines, and dataset mode

So this is no longer a greenfield cutover plan.

This is now a **correction plan for the already changed app**.

---

## What Is Still Wrong Or Incomplete

The app is now standard-first, which is correct.

But the core matching requirement is still incomplete.

### Main gap

Right now the backend mostly ranks candidate lots by:

- derived `fitDeToTarget`
- then available tonnage

That is not enough.

The matching methods need to remain in place because they are part of how the app identifies the **correct inventory lots**.

### Specific issue in current backend

In [backend/app.py](c:/Users/AkashPatil/DCW%20SIOP/backend/app.py), the current analysis flow:

- resolves the method correctly
- derives lot fit against the invoice target
- builds candidate lots
- sorts candidates

But it does **not yet run and preserve a full model-based ranking layer** comparable to the earlier Euclidean / Cosine / KNN approach.

What is missing right now:

- explicit Euclidean ranking across candidate lots
- explicit Cosine similarity ranking across candidate lots
- explicit KNN ranking across candidate lots
- a combined ranking / consensus layer for lot selection
- model metrics returned in the API payload
- frontend display of those model results for each lot candidate

### Business consequence

Without this, the app is doing standard-first allocation, but it is not yet doing the full model-driven lot matching needed to choose the best inventory when multiple lots exist for the same standard.

That is the main correction required.

---

## Required Data Model

The current stitched model is still the correct base:

- `inventory_lots`
  - `lot_id`, `lot_no`, `grade`, `standard_code`, `qty_mt_on_hand`, `color_family`

- `standard_profiles`
  - `standard_code`, `grade`, `method_id`, `reference_l`, `reference_a`, `reference_b`

- `lot_test_results`
  - `lot_no`, `standard_code`, `method_id`, `delta_l`, `delta_a`, `delta_b`, `delta_e`, `strength`, `absolute_l`, `absolute_a`, `absolute_b`

- `invoice_headers`

- `invoice_lines`
  - `invoice_line_id`, `invoice_id`, `grade`, `standard_code`, `application`, `qty_mt`, `target_method_id`, `target_l`, `target_a`, `target_b`

This data model should stay.

The correction is in **how matching is performed and returned**, not in abandoning the stitched structure.

---

## Required Matching Logic

This is the key requirement.

### Operator input

The factory-floor operator selects only:

- `standard currently in production`

That standard list must come from inventory-backed data.

### Inventory universe

Once a standard is selected:

- only lots belonging to that standard are considered candidate inventory

### Method-aware comparison

For each invoice line:

1. determine the relevant method from the application rule map
2. fetch each candidate lot's `dL`, `da`, `db` for that method
3. derive the lot's comparison values from the selected standard
4. compare that lot against the invoice requirement

### Matching methods must stay in place

The matching methods are required to identify the correct lots.

They are not optional diagnostics.

They should now run on **lot-versus-invoice** comparison inside the chosen standard.

Required models:

- Euclidean / Delta E
- Cosine similarity
- KNN

### Purpose of the models in the new app

The models must help:

- distinguish between multiple lots under the same standard
- prevent wrong inventory from being selected just because the standard matches
- support a stronger lot ranking than a single sort by `fitDeToTarget`

---

## Backend Changes Required From The Current State

The backend is already standard-first, so these are **adjustments**, not a rewrite.

### 1. Keep current standard-first endpoints

Keep:

- `/api/standards`
- `/api/invoices`
- `/api/analyze/standard`

Do not revert to pigment/order endpoints.

### 2. Upgrade candidate lot scoring to full model-based matching

Current logic in [backend/app.py](c:/Users/AkashPatil/DCW%20SIOP/backend/app.py) should be extended so that, for each invoice line:

1. gather all candidate lots for the selected standard and resolved method
2. compute comparison vectors using lot `dL`, `da`, `db` and / or derived absolute Lab
3. compute:
   - Euclidean / Delta E score
   - Cosine similarity
   - KNN distance / nearest-neighbor rank
4. compute a combined ranking or consensus score for each lot
5. use that combined ranking as the lot ordering for allocation

### 3. Return matching metrics in the API

`/api/analyze/standard` should return candidate lot data with model outputs, not just the current simplified fields.

Each candidate lot should include fields like:

- `euclideanDeltaE`
- `cosineSimilarity`
- `cosineAngularDistance`
- `knnDistance`
- `euclideanRank`
- `cosineRank`
- `knnRank`
- `consensusRank`
- `consensusScore`

The current fields should remain too:

- `fitDeToTarget`
- `fitBand`
- `availableQtyMt`
- `sourceStatus`
- `methodId`

### 4. Allocation must use the model-based ranking

Current greedy allocation should remain, but its lot ordering should come from:

- consensus ranking first
- then business tie-breakers such as available quantity and stable lot ordering

### 5. Keep method resolution central and configurable

The existing application-to-method rule map in [backend/app.py](c:/Users/AkashPatil/DCW%20SIOP/backend/app.py) is the correct pattern.

It should remain centralized and drive all matching.

### 6. Keep unsupported lines visible

Current unsupported-line handling is good and should remain.

Unsupported invoice lines should stay visible, but must never be treated as fulfillable.

### 7. Upload redesign is still pending

The backend is currently fixed to local stitched CSV loading.

That is acceptable for now, but the plan should still track later support for:

- stitched workbook upload
- or multi-file stitched dataset upload

This is not the main logic gap today.

---

## Frontend Changes Required From The Current State

The frontend already has the right structure.

No styling overhaul is needed.

The remaining work is to expose the model-driven reasoning clearly in the existing UI shell.

### 1. Keep the current standard selector shell

[frontend/src/components/PigmentSelector.jsx](c:/Users/AkashPatil/DCW%20SIOP/frontend/src/components/PigmentSelector.jsx) is already functioning as a standard selector.

Required adjustment:

- rename the component file later if desired for code clarity, but this is optional
- no visual redesign is needed

### 2. Expand candidate-lot presentation

[frontend/src/components/ResultsTabs.jsx](c:/Users/AkashPatil/DCW%20SIOP/frontend/src/components/ResultsTabs.jsx) currently shows basic candidate fields.

It should be extended to show the actual matching logic used to choose lots:

- Euclidean / Delta E
- Cosine similarity
- KNN distance
- consensus rank
- resolved method
- tolerance eligibility

This should happen inside the current tab structure, without changing styling language.

### 3. Allocation tab should explain lot choice

Current allocation output is useful, but it should also show why a lot was chosen.

For each allocation line, surface at least:

- chosen lot rank
- consensus score or best method rank
- fit DE
- method used

### 4. Inventory panel should mention model-driven selection

[frontend/src/components/ProductionPanel.jsx](c:/Users/AkashPatil/DCW%20SIOP/frontend/src/components/ProductionPanel.jsx) already summarizes stock and coverage.

It should be updated so its copy reflects:

- lots were selected through matching methods
- not just by standard membership

### 5. Sidebar is mostly fine

[frontend/src/components/Sidebar.jsx](c:/Users/AkashPatil/DCW%20SIOP/frontend/src/components/Sidebar.jsx) already reflects the new dataset.

No major UI changes are needed there.

---

## API Shape To Preserve And Extend

### `GET /api/standards`

Keep this endpoint.

It should continue returning:

- `standardCode`
- `grade`
- `inventoryQtyMt`
- `lotCount`
- `methods`
- `applications`

### `GET /api/invoices`

Keep this endpoint.

It remains useful for browsing invoice support coverage.

### `POST /api/analyze/standard`

Keep this endpoint as the main analysis endpoint.

It should be extended so its response includes:

- selected standard summary
- eligible invoice lines
- candidate lots with Euclidean / Cosine / KNN outputs
- consensus ranking per lot
- allocation result that uses that ranking
- inventory summary and shortfall

Example request:

```json
{
  "standardCode": "325",
  "toleranceMode": "strict"
}
```

---

## One-Shot Correction Set

This should now be treated as one correction to the already changed app, not as a brand-new migration.

The one-shot correction should land with all of the following true at the same time:

- the app remains standard-first
- the standard list still comes from data
- the current endpoints stay in place
- lot matching becomes explicitly model-based again
- Euclidean / Cosine / KNN are used to identify the correct lots
- allocation consumes that ranked lot list
- frontend surfaces those model metrics without changing the styling system

### Backend in the same correction

- keep current stitched CSV loading
- keep current endpoints
- upgrade `/api/analyze/standard` to compute Euclidean / Cosine / KNN on lot candidates
- add consensus ranking fields to the response
- make allocation depend on those rankings

### Frontend in the same correction

- keep current standard selector, tabs, and production panel structure
- add model metrics and ranking explanation to candidate-lot and allocation views
- keep existing styling and layout language

### Definition of done

This correction is complete only when:

- the technician selects a standard from data
- the app narrows inventory to that standard
- the app uses lot `dL`, `da`, and `db` with the resolved method to compare candidate lots
- Euclidean / Cosine / KNN are computed across candidate lots
- the app uses those methods to help choose the correct inventory
- the allocation result is based on that ranked lot set
- unsupported invoice lines remain visible but not fulfillable

---

## Immediate Build Target

The next correct version of the app should behave like this:

- operator selects `325` or `3249B`
- app shows invoice lines for that standard
- app evaluates all available lots for that standard using the matching methods
- app ranks those lots using model outputs
- app allocates from the best lots first
- app shows remaining stock and shortfall

That is the correct completion target for the already changed app.
