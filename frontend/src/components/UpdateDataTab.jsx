import React, { useState, useEffect, useCallback, useMemo } from 'react';
import config from '../config';

const DATASET_DOCS = {
  inventory_lots: {
    title: 'Inventory lots',
    intro: 'The physical stock. Every drum or bag on the floor belongs here. If a lot is missing, the dashboard cannot allocate it.',
    tips: [
      'Keep lot numbers unique.',
      'Qty on hand must be in metric tons, as a number (e.g. 12.5, not "12.5 MT").',
      'Color family must be one of RED, YELLOW, ORANGE, BLACK.',
    ],
  },
  standard_profiles: {
    title: 'Standard profiles',
    intro: 'The base production LAB reference for each standard. Lot test uploads capture the method-specific dL / da / db change from this baseline.',
    tips: [
      'Reference L*, a*, b* should be the base no-test values for the standard.',
      'Method is currently the engine tag used to line this baseline up with lot test rows.',
    ],
  },
  lot_test_results: {
    title: 'Lot test results',
    intro: 'Method-specific QC deltas for every lot, per standard. This is where the tested dL / da / db changes belong.',
    tips: [
      'Lot number must already exist in Inventory lots.',
      'Method should match the QC test used to produce these dL / da / db values.',
      'dL, da, and db must all be numbers. Delta E is derived by the server.',
    ],
  },
};

function InfoDot({ hint }) {
  return (
    <span className="ud-info" title={hint} aria-label={hint}>i</span>
  );
}

function Stepper({ steps, current }) {
  return (
    <div className="ud-stepper">
      {steps.map((label, i) => {
        const idx = i + 1;
        const cls = idx < current ? 'done' : idx === current ? 'active' : 'pending';
        return (
          <React.Fragment key={label}>
            <div className={`ud-step ${cls}`}>
              <div className="ud-step-num">{idx}</div>
              <div className="ud-step-label">{label}</div>
            </div>
            {idx < steps.length && <div className={`ud-step-bar ${idx < current ? 'done' : ''}`} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// Retained for old CSV admin routes, but no longer surfaced in the admin workflow.
// eslint-disable-next-line no-unused-vars
function DatasetEditor({ dataset, username, onToast, onRefresh }) {
  const [mode, setMode] = useState('bulk'); // 'bulk' | 'single'
  const [file, setFile] = useState(null);
  const [applyMode, setApplyMode] = useState('append');
  const [validation, setValidation] = useState(null);
  const [busy, setBusy] = useState(false);
  const [row, setRow] = useState({});
  const docs = DATASET_DOCS[dataset.name] || { title: dataset.label, intro: '', tips: [] };

  const step = useMemo(() => {
    if (mode !== 'bulk') return 1;
    if (!file) return 1;
    if (!validation) return 2;
    return validation.ok ? 3 : 2;
  }, [mode, file, validation]);

  const downloadTemplate = async () => {
    try {
      const url = `${config.API_URL}/api/admin/dataset/${dataset.name}/template?username=${encodeURIComponent(username)}`;
      const res = await fetch(url, { headers: { 'X-Username': username } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${dataset.name}_template.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      onToast('Template download failed', 'error');
    }
  };

  const validate = async (chosen) => {
    setBusy(true);
    setValidation(null);
    try {
      const fd = new FormData();
      fd.append('file', chosen);
      fd.append('username', username);
      const res = await fetch(`${config.API_URL}/api/admin/dataset/${dataset.name}/validate`, {
        method: 'POST',
        headers: { 'X-Username': username },
        body: fd,
      });
      const data = await res.json();
      setValidation(data);
    } catch {
      onToast('Validation request failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    validate(f);
  };

  const apply = async () => {
    if (!file || !validation?.ok) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', applyMode);
      fd.append('username', username);
      const res = await fetch(`${config.API_URL}/api/admin/dataset/${dataset.name}/apply`, {
        method: 'POST',
        headers: { 'X-Username': username },
        body: fd,
      });
      const data = await res.json();
      if (data.success) {
        const deduped = Number(data.canonicalization?.deduplicatedRows || 0);
        const suffix = deduped > 0 ? ` (${deduped} duplicate row${deduped === 1 ? '' : 's'} collapsed by key)` : '';
        onToast(`${docs.title}: ${data.rowCount} rows now on file${suffix}`);
        setFile(null);
        setValidation(null);
        onRefresh();
      } else {
        onToast(data.message || 'Apply failed', 'error');
      }
    } catch {
      onToast('Network error', 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitRow = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${config.API_URL}/api/admin/dataset/${dataset.name}/row`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Username': username },
        body: JSON.stringify({ username, row }),
      });
      const data = await res.json();
      if (data.success) {
        const deduped = Number(data.canonicalization?.deduplicatedRows || 0);
        const suffix = deduped > 0 ? ` ${deduped} duplicate row${deduped === 1 ? '' : 's'} collapsed by key.` : '';
        onToast(`Row added. ${docs.title} now has ${data.rowCount} rows.${suffix}`);
        setRow({});
        onRefresh();
      } else {
        onToast((data.errors && data.errors[0]) || data.message || 'Could not add row', 'error');
      }
    } catch {
      onToast('Network error', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ud-panel">
      <div className="ud-panel-head">
        <div>
          <div className="ud-panel-title">{docs.title}</div>
          <div className="ud-panel-sub">{docs.intro}</div>
        </div>
        <div className="ud-panel-count">{dataset.rowCount} rows</div>
      </div>

      <div className="ud-tabs ud-subtabs">
        <button type="button" className={`ud-subtab ${mode === 'bulk' ? 'active' : ''}`} onClick={() => setMode('bulk')}>
          Bulk upload
        </button>
        <button type="button" className={`ud-subtab ${mode === 'single' ? 'active' : ''}`} onClick={() => setMode('single')}>
          Add single row
        </button>
      </div>

      {mode === 'bulk' ? (
        <>
          <Stepper steps={['Download template', 'Upload & validate', 'Apply']} current={step} />

          <div className="ud-grid-2">
            <div className="ud-card">
              <div className="ud-card-title">Step 1 - Download template</div>
              <p className="ud-card-body">
                Start from our template so the columns line up exactly. Fill it in with Excel or any spreadsheet tool, then save as CSV or XLSX.
              </p>
              <button type="button" className="btn btn-sm" onClick={downloadTemplate}>Download CSV template</button>
            </div>

            <div className="ud-card">
              <div className="ud-card-title">Step 2 - Upload your file</div>
              <p className="ud-card-body">Drop your filled-in CSV or XLSX here. We will check it before anything changes.</p>
              <label className="ud-drop">
                <input type="file" accept=".csv,.xlsx,.xls" onChange={onFile} />
                <span>{file ? file.name : 'Click to choose file (CSV / XLSX)'}</span>
              </label>
            </div>
          </div>

          {busy && <div className="ud-note">Working...</div>}

          {validation && (
            <div className={`ud-validation ${validation.ok ? 'ok' : 'bad'}`}>
              <div className="ud-validation-head">
                {validation.ok ? 'Looks good' : 'Needs attention'} - {validation.rowCount} rows
              </div>
              {validation.missingCols?.length > 0 && (
                <div className="ud-validation-item">Missing columns: {validation.missingCols.join(', ')}</div>
              )}
              {(validation.errors || []).map((e, i) => (
                <div className="ud-validation-item" key={i}>{e}</div>
              ))}
              {(validation.warnings || []).map((w, i) => (
                <div className="ud-validation-item" key={`w-${i}`}>{w}</div>
              ))}
              {validation.preview?.length > 0 && (
                <div className="ud-preview">
                  <div className="ud-preview-title">Preview (first {validation.preview.length} rows)</div>
                  <div className="ud-preview-scroll">
                    <table className="ud-preview-table">
                      <thead>
                        <tr>{validation.columns.map(c => <th key={c}>{c}</th>)}</tr>
                      </thead>
                      <tbody>
                        {validation.preview.map((r, i) => (
                          <tr key={i}>{validation.columns.map(c => <td key={c}>{r[c] ?? ''}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {validation?.ok && (
            <div className="ud-card ud-apply-card">
              <div className="ud-card-title">Step 3 - Apply</div>
              <div className="ud-apply-modes">
                <label>
                  <input type="radio" checked={applyMode === 'append'} onChange={() => setApplyMode('append')} />
                  <span>Append <InfoDot hint="Add these rows on top of the existing data. Nothing is deleted." /></span>
                </label>
                <label>
                  <input type="radio" checked={applyMode === 'replace'} onChange={() => setApplyMode('replace')} />
                  <span>Replace <InfoDot hint="Wipe the existing file and use only your new rows. Use with care." /></span>
                </label>
              </div>
              <button type="button" className="btn btn-primary" onClick={apply} disabled={busy}>
                {busy ? 'Applying...' : `Apply ${applyMode === 'append' ? '(append)' : '(replace all)'}`}
              </button>
            </div>
          )}

          {docs.tips.length > 0 && (
            <div className="ud-tips">
              <div className="ud-tips-title">Tips</div>
              <ul>{docs.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          )}
        </>
      ) : (
        <div className="ud-card">
          <div className="ud-card-title">Add one row</div>
          <p className="ud-card-body">Use this for a quick correction. Every field has a tooltip - hover the "i".</p>
          <div className="ud-form-grid">
            {dataset.columns.map(col => (
              <div className="ud-field" key={col.key}>
                <label className="ud-label">
                  {col.label} <InfoDot hint={col.hint} />
                </label>
                <input
                  className="form-input"
                  value={row[col.key] || ''}
                  onChange={(e) => setRow(prev => ({ ...prev, [col.key]: e.target.value }))}
                  placeholder={col.hint}
                />
              </div>
            ))}
          </div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={submitRow}>
            {busy ? 'Adding...' : 'Add row'}
          </button>
        </div>
      )}
    </div>
  );
}

function TestMethodPicker({ value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = React.useRef(null);
  const displayOptions = useMemo(() => (
    (options || [])
      .map((opt) => {
        if (typeof opt === 'string') {
          return { methodId: opt, label: opt };
        }
        const methodId = String(opt?.methodId || opt?.id || '').trim();
        if (!methodId) return null;
        const rawLabel = String(opt?.label || opt?.name || '').trim();
        return {
          methodId,
          label: rawLabel || methodId,
        };
      })
      .filter(Boolean)
  ), [options]);
  const selected = useMemo(() => (
    String(value || '').split(',').map(s => s.trim()).filter(Boolean)
  ), [value]);
  const labelOf = useCallback((id) => {
    const m = displayOptions.find(o => o.methodId === id);
    return m?.label || id;
  }, [displayOptions]);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const toggle = (methodId) => {
    const has = selected.includes(methodId);
    const next = has ? selected.filter(x => x !== methodId) : [...selected, methodId];
    onChange(next.join(','));
  };
  const summary = selected.length === 0
    ? <span style={{ color: '#9ca3af' }}>Select tests...</span>
    : selected.map(labelOf).join(', ');
  return (
    <div ref={wrapRef} className="ud-test-picker">
      <button
        type="button"
        className="form-input ud-test-picker-trigger"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ud-test-picker-summary">{summary}</span>
        <span className="ud-test-picker-caret" aria-hidden="true">{open ? 'v' : '>'}</span>
      </button>
      {open && (
        <div className="ud-test-picker-menu" role="listbox" aria-multiselectable="true">
          {displayOptions.length === 0 && (
            <div className="ud-test-picker-empty">No inventory-backed tests available.</div>
          )}
          {displayOptions.map(opt => {
            const checked = selected.includes(opt.methodId);
            return (
              <button
                key={opt.methodId}
                type="button"
                className={`ud-test-picker-option ${checked ? 'is-selected' : ''}`}
                title={opt.methodId}
                onClick={() => toggle(opt.methodId)}
              >
                <input
                  type="checkbox"
                  className="ud-test-picker-checkbox"
                  checked={checked}
                  readOnly
                  tabIndex={-1}
                  aria-hidden="true"
                />
                <span className="ud-test-picker-option-copy">
                  <span className="ud-test-picker-option-label">{opt.label}</span>
                  {opt.label !== opt.methodId && (
                    <span className="ud-test-picker-option-id">{opt.methodId}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InvoiceWizard({ username, standards, testMethods, caps, onToast, onAfterSave }) {
  const [mode, setMode] = useState('type'); // 'type' | 'image' | 'pdf'
  const [header, setHeader] = useState({ invoiceNumber: '', invoiceDate: '', customerName: '' });
  const [lines, setLines] = useState([{
    grade: '', standardCode: '', application: '', qtyMt: '',
    targetDeltaL: '', targetDeltaA: '', targetDeltaB: '',
    targetL: '', targetA: '', targetB: '', targetMethodId: '',
  }]);
  const [file, setFile] = useState(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [rawText, setRawText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [customers, setCustomers] = useState([]);

  useEffect(() => {
    fetch(`${config.API_URL}/api/admin/customers?username=${encodeURIComponent(username)}`, {
      headers: { 'X-Username': username },
    })
      .then(r => r.json())
      .then(d => { if (d.success) setCustomers(d.customers || []); })
      .catch(() => {});
  }, [username]);

  const step = (header.invoiceNumber && header.invoiceDate && header.customerName) ? (lines.some(l => l.grade && l.standardCode && l.qtyMt) ? 3 : 2) : 1;

  const emptyLine = () => ({
    grade: '', standardCode: '', application: '', qtyMt: '',
    targetDeltaL: '', targetDeltaA: '', targetDeltaB: '',
    targetL: '', targetA: '', targetB: '', targetMethodId: '',
  });
  const addLine = () => setLines(prev => [...prev, emptyLine()]);
  const updateLine = (i, patch) => setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const removeLine = (i) => setLines(prev => prev.filter((_, idx) => idx !== i));

  const applyStandardToLine = (i, code) => {
    const match = standards.find(s => s.standardCode === code);
    const lab = match?.previewLab || {};
    updateLine(i, {
      standardCode: code,
      grade: match?.grade && !['ALL', 'Multiple'].includes(match.grade) ? match.grade : '',
      targetL: lab.L ?? '',
      targetA: lab.a ?? '',
      targetB: lab.b ?? '',
      targetMethodId: '',
    });
  };

  const onUpload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setOcrBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('username', username);
      const res = await fetch(`${config.API_URL}/api/admin/requirements/ocr`, {
        method: 'POST',
        headers: { 'X-Username': username },
        body: fd,
      });
      const data = await res.json();
      if (data.success) {
        setHeader({
          invoiceNumber: data.header?.invoiceNumber || '',
          invoiceDate: data.header?.invoiceDate || '',
          customerName: data.header?.customerName || '',
        });
        if ((data.lines || []).length > 0) {
          setLines(data.lines.map(l => ({
            grade: l.grade || '',
            standardCode: l.standardCode || '',
            application: l.application || '',
            qtyMt: l.qtyMt ?? '',
            targetDeltaL: l.targetDeltaL ?? '',
            targetDeltaA: l.targetDeltaA ?? '',
            targetDeltaB: l.targetDeltaB ?? '',
            targetL: l.targetL ?? '',
            targetA: l.targetA ?? '',
            targetB: l.targetB ?? '',
            targetMethodId: l.targetMethodId || '',
          })));
        }
        setRawText(data.rawText || '');
        const sourceLabel = data.parserSource === 'openai+heuristic' ? 'AI-assisted extraction' : 'Extraction';
        const warning = Array.isArray(data.parseWarnings) && data.parseWarnings[0] ? ` ${data.parseWarnings[0]}` : '';
        onToast(`${sourceLabel} complete - review and correct before submitting.${warning}`);
      } else {
        onToast(data.message || 'OCR failed', 'error');
      }
    } catch {
      onToast('Network error during OCR', 'error');
    } finally {
      setOcrBusy(false);
    }
  };

  const submit = async () => {
    if (step < 3) { onToast('Fill in header and at least one line first', 'error'); return; }
    setSubmitting(true);
    try {
      const payload = {
        username,
        header,
        lines: lines
          .filter(l => l.grade && l.standardCode && l.qtyMt)
          .map(l => ({
            grade: l.grade,
            standardCode: l.standardCode,
            application: l.application,
            qtyMt: Number(l.qtyMt),
            targetDeltaL: l.targetDeltaL,
            targetDeltaA: l.targetDeltaA,
            targetDeltaB: l.targetDeltaB,
            targetL: l.targetL, targetA: l.targetA, targetB: l.targetB,
            targetMethodId: l.targetMethodId,
          })),
      };
      const res = await fetch(`${config.API_URL}/api/admin/requirements/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Username': username },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        onToast(`Requirement saved (${data.lineCount} lines).`);
        setHeader({ invoiceNumber: '', invoiceDate: '', customerName: '' });
        setLines([emptyLine()]);
        setFile(null);
        setRawText('');
        if (onAfterSave) await onAfterSave();
      } else {
        onToast(data.message || 'Save failed', 'error');
      }
    } catch {
      onToast('Network error', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ud-panel">
      <div className="ud-panel-head">
        <div>
          <div className="ud-panel-title">New customer order / requirement</div>
          <div className="ud-panel-sub">
            Type it, or upload a picture or PDF - we will read it and pre-fill the form so you can confirm.
          </div>
        </div>
      </div>

      <div className="ud-tabs ud-subtabs">
        <button type="button" className={`ud-subtab ${mode === 'type' ? 'active' : ''}`} onClick={() => setMode('type')}>Type it in</button>
        <button type="button" className={`ud-subtab ${mode === 'image' ? 'active' : ''}`} onClick={() => setMode('image')}>Upload image</button>
        <button type="button" className={`ud-subtab ${mode === 'pdf' ? 'active' : ''}`} onClick={() => setMode('pdf')}>Upload PDF</button>
      </div>

      {(mode === 'image' || mode === 'pdf') && (
        <div className="ud-card">
          <div className="ud-card-title">Step 1 - Upload {mode === 'image' ? 'a photo or scan (JPG/PNG)' : 'the PDF'}</div>
          <p className="ud-card-body">
            Our reader pulls out the requirement number, date, customer, and line items. It is rarely perfect - everything below is editable before you save.
          </p>
          {caps?.openaiInvoiceParser && (
            <p className="ud-card-body">
              Our AI will extract the requirement details and prefill the form.
            </p>
          )}
          <label className="ud-drop">
            <input
              type="file"
              accept={mode === 'image' ? 'image/*' : 'application/pdf'}
              onChange={onUpload}
            />
            <span>{file ? file.name : `Click to choose ${mode === 'image' ? 'image' : 'PDF'}`}</span>
          </label>
          {ocrBusy && <div className="ud-note">Reading the document...</div>}
          {rawText && (
            <details className="ud-raw">
              <summary>Show raw extracted text</summary>
              <pre>{rawText}</pre>
            </details>
          )}
        </div>
      )}

      <Stepper steps={['Requirement header', 'Requirement lines', 'Review & save']} current={step} />

      <div className="ud-card">
        <div className="ud-card-title">Requirement header</div>
        <div className="ud-form-grid ud-form-grid-3">
          <div className="ud-field">
            <label className="ud-label">Requirement number <InfoDot hint="Unique requirement number from the PO or paper copy." /></label>
            <input className="form-input" value={header.invoiceNumber} onChange={e => setHeader({ ...header, invoiceNumber: e.target.value })} placeholder="e.g. INV-4310" />
          </div>
          <div className="ud-field">
            <label className="ud-label">Requirement date <InfoDot hint="Date on the requirement. Any readable date format works." /></label>
            <input className="form-input" value={header.invoiceDate} onChange={e => setHeader({ ...header, invoiceDate: e.target.value })} placeholder="YYYY-MM-DD" />
          </div>
          <div className="ud-field">
            <label className="ud-label">Customer name <InfoDot hint="Exact customer name. Existing customers will auto-complete." /></label>
            <input className="form-input" list="ud-cust-list" value={header.customerName} onChange={e => setHeader({ ...header, customerName: e.target.value })} placeholder="Start typing..." />
            <datalist id="ud-cust-list">
              {customers.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
        </div>
      </div>

      <div className="ud-card">
        <div className="ud-card-title">Line items</div>
        {lines.map((l, i) => (
          <div className="ud-line" key={i}>
            <div className="ud-line-head">
              <span>Line {i + 1}</span>
              {lines.length > 1 && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => removeLine(i)}>Remove</button>
              )}
            </div>
            <div className="ud-form-grid ud-form-grid-4">
              <div className="ud-field">
                <label className="ud-label">Standard code <InfoDot hint="Pick the standard. Picking a standard auto-fills grade and target LAB." /></label>
                <input className="form-input" list={`ud-std-list-${i}`} value={l.standardCode}
                  onChange={e => applyStandardToLine(i, e.target.value)} placeholder="e.g. STD-RED-001" />
                <datalist id={`ud-std-list-${i}`}>
                  {standards.map(s => <option key={s.standardCode} value={s.standardCode} />)}
                </datalist>
              </div>
              <div className="ud-field">
                <label className="ud-label">Grade <InfoDot hint="Grade number - usually set automatically when you pick a standard." /></label>
                <input className="form-input" value={l.grade} onChange={e => updateLine(i, { grade: e.target.value })} />
              </div>
              <div className="ud-field">
                <label className="ud-label">Application <InfoDot hint="Where the pigment will be used. Used to pick the QC method." /></label>
                <input className="form-input" value={l.application} onChange={e => updateLine(i, { application: e.target.value })} placeholder="paint / plastic / water based" />
              </div>
              <div className="ud-field">
                <label className="ud-label">Qty (MT) <InfoDot hint="Metric tons ordered. Numbers only." /></label>
                <input className="form-input" type="number" step="0.01" value={l.qtyMt}
                  onChange={e => updateLine(i, { qtyMt: e.target.value })} placeholder="e.g. 2.5" />
              </div>
              <div className="ud-field">
                <label className="ud-label">dL <InfoDot hint="Requirement target dL against the current production standard." /></label>
                <input className="form-input" type="number" step="0.001" value={l.targetDeltaL}
                  onChange={e => updateLine(i, { targetDeltaL: e.target.value })} />
              </div>
              <div className="ud-field">
                <label className="ud-label">da <InfoDot hint="Requirement target da against the current production standard." /></label>
                <input className="form-input" type="number" step="0.001" value={l.targetDeltaA}
                  onChange={e => updateLine(i, { targetDeltaA: e.target.value })} />
              </div>
              <div className="ud-field">
                <label className="ud-label">db <InfoDot hint="Requirement target db against the current production standard." /></label>
                <input className="form-input" type="number" step="0.001" value={l.targetDeltaB}
                  onChange={e => updateLine(i, { targetDeltaB: e.target.value })} />
              </div>
              <div className="ud-field">
                <label className="ud-label">Test requirement <InfoDot hint="Optional. Pick inventory-backed tests required by this line. Leave empty when no test is named." /></label>
                <TestMethodPicker
                  value={l.targetMethodId}
                  options={testMethods}
                  onChange={(v) => updateLine(i, { targetMethodId: v })}
                />
              </div>
            </div>
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={addLine}>+ Add another line</button>
      </div>

      <div className="ud-card ud-apply-card">
        <div className="ud-card-title">Save</div>
        <p className="ud-card-body">Double-check the header and lines above. Once saved, this order appears on the dashboard as an open requirement.</p>
        <button type="button" className="btn btn-primary" disabled={submitting || step < 3} onClick={submit}>
          {submitting ? 'Saving...' : 'Save requirement'}
        </button>
      </div>
    </div>
  );
}

const STANDARD_COLORS = ['RED', 'YELLOW', 'ORANGE'];

function CurrentStandardsEditor({ username, onToast, onAfterSave }) {
  const [rows, setRows] = useState(STANDARD_COLORS.map(color => ({
    colorFamily: color,
    standardCode: '',
    grade: 'ALL',
    productionDate: '',
    referenceL: '',
    referenceA: '',
    referenceB: '',
  })));
  const [busy, setBusy] = useState(false);
  const [sourceState, setSourceState] = useState(null);

  const mergeRows = useCallback((incoming = []) => {
    const byColor = Object.fromEntries((incoming || []).map(r => [r.colorFamily, r]));
    setRows(STANDARD_COLORS.map(color => {
      const r = byColor[color] || {};
      return {
        colorFamily: color,
        standardCode: r.standardCode || '',
        grade: r.grade || 'ALL',
        productionDate: r.productionDate || '',
        referenceL: r.referenceL ?? '',
        referenceA: r.referenceA ?? '',
        referenceB: r.referenceB ?? '',
      };
    }));
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`${config.API_URL}/api/admin/current-standards?username=${encodeURIComponent(username)}`, {
        headers: { 'X-Username': username },
      });
      const data = await res.json();
      if (data.success) {
        mergeRows(data.standards || []);
        setSourceState(data.sourceState || null);
      } else {
        onToast(data.message || 'Current standards failed to load', 'error');
      }
    } catch {
      onToast('Network error loading current standards', 'error');
    } finally {
      setBusy(false);
    }
  }, [username, mergeRows, onToast]);

  useEffect(() => { load(); }, [load]);

  const update = (color, patch) => {
    setRows(prev => prev.map(r => (r.colorFamily === color ? { ...r, ...patch } : r)));
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        username,
        standards: rows
          .filter(r => r.standardCode.trim())
          .map(r => ({
            ...r,
            grade: r.grade || 'ALL',
            referenceL: r.referenceL === '' ? null : Number(r.referenceL),
            referenceA: r.referenceA === '' ? null : Number(r.referenceA),
            referenceB: r.referenceB === '' ? null : Number(r.referenceB),
          })),
      };
      const res = await fetch(`${config.API_URL}/api/admin/current-standards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Username': username },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        onToast('Current standards saved.');
        mergeRows(data.standards || []);
        if (onAfterSave) await onAfterSave();
      } else {
        onToast((data.errors && data.errors[0]) || data.message || 'Save failed', 'error');
      }
    } catch {
      onToast('Network error saving current standards', 'error');
    } finally {
      setBusy(false);
    }
  };

  const refreshInventory = async () => {
    setBusy(true);
    try {
      const res = await fetch(`${config.API_URL}/api/admin/inventory/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Username': username },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (data.success) {
        const sync = data.inventorySync || {};
        onToast(`Inventory refreshed${sync.inventoryRows ? ` (${sync.inventoryRows} lots)` : ''}.`);
        if (onAfterSave) await onAfterSave();
      } else {
        onToast(data.message || 'Inventory refresh failed', 'error');
      }
    } catch {
      onToast('Network error refreshing inventory', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ud-panel">
      <div className="ud-panel-head">
        <div>
          <div className="ud-panel-title">Current standard in production</div>
          <div className="ud-panel-sub">One active reference standard per color.</div>
        </div>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={refreshInventory}>
          Refresh inventory workbook
        </button>
      </div>

      <div className="ud-card">
        <div className="ud-form-grid ud-form-grid-4">
          {rows.map(r => (
            <React.Fragment key={r.colorFamily}>
              <div className="ud-field">
                <label className="ud-label">Color</label>
                <input className="form-input" value={r.colorFamily} disabled />
              </div>
              <div className="ud-field">
                <label className="ud-label">Standard code <InfoDot hint="The active production standard for this color." /></label>
                <input className="form-input" value={r.standardCode} onChange={e => update(r.colorFamily, { standardCode: e.target.value })} />
              </div>
              <div className="ud-field">
                <label className="ud-label">Grade <InfoDot hint="Use ALL when the standard is color-level rather than grade-specific." /></label>
                <input className="form-input" value={r.grade} onChange={e => update(r.colorFamily, { grade: e.target.value })} />
              </div>
              <div className="ud-field">
                <label className="ud-label">Date <InfoDot hint="Production-standard effective date." /></label>
                <input className="form-input" value={r.productionDate} onChange={e => update(r.colorFamily, { productionDate: e.target.value })} placeholder="YYYY-MM-DD" />
              </div>
              <div className="ud-field">
                <label className="ud-label">Reference L*</label>
                <input className="form-input" type="number" step="0.001" value={r.referenceL} onChange={e => update(r.colorFamily, { referenceL: e.target.value })} />
              </div>
              <div className="ud-field">
                <label className="ud-label">Reference a*</label>
                <input className="form-input" type="number" step="0.001" value={r.referenceA} onChange={e => update(r.colorFamily, { referenceA: e.target.value })} />
              </div>
              <div className="ud-field">
                <label className="ud-label">Reference b*</label>
                <input className="form-input" type="number" step="0.001" value={r.referenceB} onChange={e => update(r.colorFamily, { referenceB: e.target.value })} />
              </div>
              <div className="ud-field ud-field-action">
                <label className="ud-label">&nbsp;</label>
                <div className="ud-note">{r.standardCode ? 'Ready' : 'Not set'}</div>
              </div>
            </React.Fragment>
          ))}
        </div>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
          {busy ? 'Saving...' : 'Save current standards'}
        </button>
      </div>

      {sourceState?.inventorySync && (
        <div className="ud-note">
          Inventory workbook: {sourceState.inventorySync.reason || 'ready'}
          {sourceState.inventorySync.workbookModifiedAt ? ` - ${sourceState.inventorySync.workbookModifiedAt}` : ''}
        </div>
      )}
    </div>
  );
}

export default function UpdateDataTab({ user, onToast, onAfterChange }) {
  const [activeKey, setActiveKey] = useState('invoice');
  const [standards, setStandards] = useState([]);
  const [testMethods, setTestMethods] = useState([]);
  const [caps, setCaps] = useState({ ocr: false, pdfplumber: false, openaiInvoiceParser: false });
  const username = user.username || user.name;

  const refresh = useCallback(async () => {
    try {
      const [sRes, cRes, tRes] = await Promise.all([
        fetch(`${config.API_URL}/api/standards`),
        fetch(`${config.API_URL}/api/admin/capabilities`, { headers: { 'X-Username': username } }),
        fetch(`${config.API_URL}/api/admin/test-methods?username=${encodeURIComponent(username)}`, { headers: { 'X-Username': username } }),
      ]);
      const s = await sRes.json();
      const c = await cRes.json();
      const t = await tRes.json();
      if (s.success) setStandards(s.data || []);
      if (c.success) setCaps(c);
      if (t.success) setTestMethods(t.testMethods || []);
      if (onAfterChange) onAfterChange();
    } catch {
      onToast('Failed to load admin data', 'error');
    }
  }, [username, onToast, onAfterChange]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="ud-root">
      <div className="page-header">
        <h1 className="page-title">Update Data</h1>
        <p className="page-subtitle">Administrator workspace for incoming requirements and current production standards.</p>
      </div>

      {!caps.ocr && (
        <div className="ud-banner">
          OCR is not available on the server. Image and PDF upload will fall back to whatever text the file exposes.
          Install <code>pytesseract</code> and the Tesseract binary to enable scans.
        </div>
      )}

      {caps.ocr && !caps.openaiInvoiceParser && (
        <div className="ud-banner">
          OCR is available, but AI-assisted requirement parsing is off.
          {caps.openaiInvoiceError ? ` ${caps.openaiInvoiceError}` : ' Set OPENAI_API_KEY to improve field extraction from OCR text.'}
        </div>
      )}

      <div className="ud-tabs ud-toptabs">
        <button type="button" className={`ud-toptab ${activeKey === 'invoice' ? 'active' : ''}`} onClick={() => setActiveKey('invoice')}>
          New requirement / order
        </button>
        <button type="button" className={`ud-toptab ${activeKey === 'current-standard' ? 'active' : ''}`} onClick={() => setActiveKey('current-standard')}>
          Current standard
        </button>
      </div>

      {activeKey === 'invoice' ? (
        <InvoiceWizard username={username} standards={standards} testMethods={testMethods} caps={caps} onToast={onToast} onAfterSave={refresh} />
      ) : activeKey === 'current-standard' ? (
        <CurrentStandardsEditor username={username} onToast={onToast} onAfterSave={refresh} />
      ) : (
        <div className="ud-note">Loading...</div>
      )}
    </div>
  );
}
