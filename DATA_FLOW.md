# Data Flow Audit

System: Flask backend in [backend/app.py](backend/app.py) with a CRA React frontend.
Identity is carried per request by `username`, `X-Username`, or `?username=`.

## 1. Runtime Sources

| Source | Runtime role | Notes |
|---|---|---|
| [backend/Main inventory data.xlsx](backend/Main%20inventory%20data.xlsx) | Client-maintained inventory source | Parsed on startup/refresh into inventory lots and lot test results. All tabs are supported. |
| `standard_profiles.csv` | Admin-maintained current production standards | One current standard per color. Rows include `color_family`, `standard_code`, method references, and optional production date. |
| `invoice_headers` / `invoice_lines` CSVs | Current order demand | Invoices come from OCR/manual upload and include line-level `target_delta_l`, `target_delta_a`, `target_delta_b`. |
| [backend/Customer details.xlsx](backend/Customer%20details.xlsx) | Dev reference only | Not a runtime input. |

The parsed CSVs live under `backend/stitched_outputs/` and are loaded into `databases[...]` by `load_default_datasets()`.

## 2. Key Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/standards` | Returns dropdown options as standard codes. Each option also carries `colorFamily`, inventory qty, lot count, methods, and preview data. |
| `GET` | `/api/invoices` | Summarizes invoice coverage. Supported means the invoice color has inventory in the current color pool. |
| `POST` | `/api/analyze/standard` | Analyzes one selected standard. The backend resolves its color for invoices, keeps lots/tests for the selected standard inventory scope, then ranks lots by dL/dA/dB fit. |
| `POST` | `/api/invoices/commit` | Commits allocations, decrements inventory, updates invoice line status/outstanding qty, and appends audit rows. |
| `GET/POST` | `/api/admin/current-standards` | Admin reads or updates the current production standard for each color. |
| `POST` | `/api/admin/inventory/refresh` | Re-parses `Main inventory data.xlsx` into runtime CSVs. |
| `POST` | `/api/admin/invoice/ocr` | OCR/agent extracts invoice header and line draft, including dL/dA/dB where present. |
| `POST` | `/api/admin/invoice/manual` | Saves reviewed invoice lines with dL/dA/dB values. |

## 3. Main Matching Flow

```text
User selects a standard from the dropdown
  -> Dashboard POSTs /api/analyze/standard { standardCode, toleranceMode, applications }
  -> backend analyze_standard_core()

Backend:
  1. Resolve selected standardCode to colorFamily.
     The response still preserves the selected standardCode.

  2. Build the analysis pool:
       - open invoice lines for the selected standard's colorFamily
       - in-stock inventory lots for the selected standardCode
       - lot test rows for those selected lots and that same standardCode
       - legacy fallback: color-scoped inventory only if no exact standard inventory exists

  3. Resolve the QC method for each invoice line:
       if invoice target_method_id names one or more tests:
         use the named test requirement
       else:
         start with method_i_a and fall through the standard's available test list only when availability requires it

  4. Build the invoice target vector:
       preferred: invoice target_delta_l / target_delta_a / target_delta_b
       fallback: derive deltas from absolute invoice LAB and the reference profile

  5. Build candidate lot vectors from lot test dL / dA / dB for the resolved method.
       every candidate includes:
         - matchMethodId / matchedTestMethodId
         - availableTests
         - isSuperLot

  6. Score every lot against the invoice vector:
       - Euclidean delta E
       - cosine similarity
       - KNN distance on standardized dL/dA/dB vectors

  7. Convert the three method ranks into a consensus score/rank.

  8. Apply tolerance:
       strict <= 1.5
       relaxed <= 3.5
       review accepts all scored candidates

     Super-lot guard:
       lots with more than two available tests are tagged as super lots.
       A super lot is reserved unless:
         - the invoice names every test available on that super lot, or
         - non-super eligible stock cannot fulfill the invoice line.

  9. Allocate greedily from the live remaining inventory pool:
       perceptual band -> consensus rank -> remaining qty -> lot number
```

## 4. Matching Flow Page

[frontend/src/components/MatchingFlowTab.jsx](frontend/src/components/MatchingFlowTab.jsx) replays the same backend response:

- Step 1 shows that standard selection routes invoices by color while keeping inventory lots/tests scoped to the selected standard.
- Step 3 shows that invoice dL/dA/dB is the scoring target.
- Example A explains the per-line candidate ranking.
- Example B explains why live allocation can skip a highly ranked lot if earlier invoice lines consumed it.

## 5. Admin Data Flow

```text
Admin updates current standard
  -> POST /api/admin/current-standards
  -> standard_profiles.csv is rewritten
  -> Main inventory workbook is re-parsed against the new current standards
  -> /api/standards dropdown updates with the production standard code(s)

Client updates Main inventory data.xlsx
  -> app startup or POST /api/admin/inventory/refresh
  -> parse every tab with LOT/QTY/test-result layout
  -> write inventory_lots.csv and lot_test_results.csv

Admin uploads/reviews invoice
  -> OCR creates draft header + lines
  -> user reviews dL/dA/dB line targets
  -> manual save appends invoice headers/lines
```

## 6. Important Derived Values

| Field | Computed from | Used by |
|---|---|---|
| `targetDelta.source = invoice_delta_lab` | invoice line dL/dA/dB | Primary target vector for matching |
| `targetDelta.source = delta_from_standard` | invoice LAB minus reference LAB | Legacy fallback only |
| `candidate.euclideanDeltaE` | lot delta vector vs invoice delta vector | tolerance and rank |
| `candidate.cosineSimilarity` | same vectors | rank |
| `candidate.knnDistance` | standardized vectors | rank |
| `candidate.consensusRank` | Euclidean, cosine, and KNN ranks | primary lot ordering |
| `standard.colorFamily` | selected current standard metadata or inventory inference | invoice pool selection |
| `standard.inventoryScope` | exact standard match or legacy color fallback | inventory lot/test selection |
| `standard.sourceSheets` | workbook tabs represented by selected lots | audit visibility for `Main inventory data.xlsx` usage |
| `candidate.availableTests` | all test methods present for that lot | lot audit and super-lot tagging |
| `candidate.matchMethodId` | invoice test requirement or fallback method selected by availability | explains which test dL/dA/dB was used |
| `candidate.isSuperLot` | `availableTests.length > 2` | prevents over-consuming versatile lots |
