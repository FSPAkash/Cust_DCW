"""
Standard-first Flask backend.
Loads stitched CSV datasets and performs inventory-backed requirement allocation.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple
import io
import json
import os
import re
import shutil
import uuid

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

try:
    import pytesseract
    from PIL import Image
    OCR_AVAILABLE = True
except Exception:  # pylint: disable=broad-except
    OCR_AVAILABLE = False

try:
    import pdfplumber
    PDFPLUMBER_AVAILABLE = True
except Exception:  # pylint: disable=broad-except
    PDFPLUMBER_AVAILABLE = False

try:
    from pdf2image import convert_from_bytes
    PDF2IMAGE_AVAILABLE = True
except Exception:  # pylint: disable=broad-except
    PDF2IMAGE_AVAILABLE = False

try:
    from dotenv import load_dotenv
except Exception:  # pylint: disable=broad-except
    load_dotenv = None

try:
    from openai import OpenAI
    OPENAI_SDK_AVAILABLE = True
except Exception:  # pylint: disable=broad-except
    OpenAI = None
    OPENAI_SDK_AVAILABLE = False

app = Flask(__name__)
app.secret_key = "standard-first-secret-2026"
CORS(app, supports_credentials=True)

OCR_BINARY_PATH = ""
OCR_ERROR = None
OPENAI_ERROR = None

USER_CREDENTIALS = {
    "Akash": {"password": "a123", "type": "user", "name": "Akash"},
    "Anirudh": {"password": "a456", "type": "user", "name": "Anirudh"},
    "Sanjay": {"password": "s789", "type": "user", "name": "Sanjay"},
    "Sushant": {"password": "s123", "type": "user", "name": "Sushant"},
    "Naina": {"password": "n123", "type": "user", "name": "Naina"},
    "admin": {"password": "admin123", "type": "admin", "name": "Administrator"},
}

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
if load_dotenv is not None:
    load_dotenv(ROOT_DIR / ".env")
    load_dotenv(BASE_DIR / ".env")
STITCHED_DIR = BASE_DIR / "stitched_outputs"
SEED_DATASET_FILE = STITCHED_DIR / "stitched_dataset.xlsx"
SEED_INVENTORY_SHEET = "inventory_lots"
BULK_INVOICE_HEADERS_FILE = STITCHED_DIR / "bulk_dummy_invoice_headers_240.csv"
BULK_INVOICE_LINES_FILE = STITCHED_DIR / "bulk_dummy_invoice_lines_240.csv"
SMALL_INVOICE_HEADERS_FILE = STITCHED_DIR / "dummy_invoice_headers.csv"
SMALL_INVOICE_LINES_FILE = STITCHED_DIR / "dummy_invoice_lines.csv"


def pick_dataset_file(preferred: Path, fallback: Path) -> Path:
    return preferred if preferred.exists() else fallback


DATASET_FILES = {
    "inventory_lots": STITCHED_DIR / "inventory_lots.csv",
    "standard_profiles": STITCHED_DIR / "standard_profiles.csv",
    "lot_test_results": STITCHED_DIR / "lot_test_results.csv",
    "invoice_headers": pick_dataset_file(BULK_INVOICE_HEADERS_FILE, SMALL_INVOICE_HEADERS_FILE),
    "invoice_lines": pick_dataset_file(BULK_INVOICE_LINES_FILE, SMALL_INVOICE_LINES_FILE),
}
MAIN_INVENTORY_FILE = BASE_DIR / "Main inventory data.xlsx"
INVENTORY_SYNC_META_FILE = STITCHED_DIR / ".main_inventory_mtime"
COMMIT_AUDIT_FILE = STITCHED_DIR / "commit_audit.csv"
COMMIT_AUDIT_COLS = [
    "commit_id", "committed_at_utc", "username", "standard_code",
    "invoice_line_id", "invoice_number", "customer_name", "lot_no",
    "allocated_qty_mt", "method_id", "consensus_rank", "delta_e",
    "resulting_status",
]

REQUIRED_COLS = {
    "inventory_lots": ["lot_id", "lot_no", "grade", "standard_code", "qty_mt_on_hand", "color_family"],
    "standard_profiles": ["standard_code", "grade", "method_id", "reference_l", "reference_a", "reference_b"],
    "lot_test_results": ["lot_no", "standard_code", "method_id", "delta_l", "delta_a", "delta_b", "source_status"],
    "invoice_headers": ["invoice_id", "invoice_number", "invoice_date", "customer_name"],
    "invoice_lines": [
        "invoice_line_id", "invoice_id", "grade", "standard_code", "application",
        "qty_mt", "target_method_id", "target_l", "target_a", "target_b",
    ],
}
DATASET_UNIQUE_KEYS = {
    "inventory_lots": ["lot_no", "standard_code"],
    "standard_profiles": ["standard_code", "grade", "method_id"],
    "lot_test_results": ["lot_no", "standard_code", "method_id"],
}

APPLICATION_METHOD_RULES = {
    "paint": "method_i_b",
    "paint/plastic": "method_i_b",
    "paint / plastic": "method_i_b",
    "paint application": "method_i_b",
    "water based": "method_ii",
    "asbestos": "method_ii",
    "construction": "method_iv_a",
    "concrete": "method_iv_a",
    "cement": "method_iii",
}
TOLERANCES = {"strict": 1.5, "relaxed": 3.5, "review": float("inf")}
DEFAULT_TOLERANCE = "strict"
DEFAULT_METHOD = "method_i_a"
BASE_TEST_METHOD = "method_i_a"
SUPER_LOT_TEST_THRESHOLD = 2
PERCEPTUAL_LABELS = [
    {"key": "imperceptible", "label": "imperceptible difference", "blurb": "Indistinguishable to the human eye."},
    {"key": "slight", "label": "slight difference", "blurb": "Visible only to a trained observer under ideal light."},
    {"key": "noticeable", "label": "noticeable difference", "blurb": "Perceptible side-by-side; acceptable for most uses."},
    {"key": "distinct", "label": "distinct", "blurb": "Clearly different colors at a glance."},
    {"key": "obvious", "label": "obvious mismatch", "blurb": "Two different colors. Use only with customer approval."},
]

databases: Dict[str, pd.DataFrame | None] = {
    "inventory_lots": None,
    "standard_profiles": None,
    "lot_test_results": None,
    "invoice_headers": None,
    "invoice_lines": None,
}
dataset_state: Dict[str, Any] = {"loaded": False, "loaded_at_utc": None, "error": None}
source_data_state: Dict[str, Any] = {
    "loaded": False,
    "loaded_at_utc": None,
    "error": None,
    "currentStandards": [],
    "sourceFiles": {
        "inventory": str(MAIN_INVENTORY_FILE),
    },
}
PREVIEW_METHOD_PRIORITY = ["method_i_b", "method_ii", "method_i_a"]
COLOR_FAMILY_FALLBACK = {
    "RED": "#a73a33",
    "YELLOW": "#c7a028",
    "ORANGE": "#b9632b",
    "BLACK": "#2f2f33",
}
CURRENT_STANDARD_METHODS = [
    "method_i_a",
    "method_i_b",
    "method_ii",
    "method_iii",
    "method_iv_a",
    "method_iv_b",
    "method_v_a",
    "method_v_b",
    "method_vi_a",
    "method_vi_b",
]
METHOD_DISPLAY_LABELS = {
    "method_i_a": "Alk MT",
    "method_i_b": "Alk RT",
    "method_ii": "Asbestos",
    "method_iii": "Cement",
    "method_iv_a": "Silica / Con A",
    "method_iv_b": "Silica / Con B",
    "method_v_a": "Alk A MT",
    "method_v_b": "Alk A RT",
    "method_vi_a": "Alk B MT",
    "method_vi_b": "Alk B RT",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _tesseract_candidates() -> List[Path]:
    candidates: List[Path] = []
    seen: set[str] = set()

    def add(path_str: str | None) -> None:
        if not path_str:
            return
        path = Path(path_str.strip('"')).expanduser()
        key = str(path).lower()
        if key not in seen:
            candidates.append(path)
            seen.add(key)

    add(os.environ.get("TESSERACT_CMD"))
    which_path = shutil.which("tesseract")
    add(which_path)

    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    program_files_x86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    user_profile = os.environ.get("USERPROFILE", "")

    add(str(Path(program_files) / "Tesseract-OCR" / "tesseract.exe"))
    add(str(Path(program_files_x86) / "Tesseract-OCR" / "tesseract.exe"))
    if local_app_data:
        add(str(Path(local_app_data) / "Programs" / "Tesseract-OCR" / "tesseract.exe"))
    if user_profile:
        add(str(Path(user_profile) / "AppData" / "Local" / "Programs" / "Tesseract-OCR" / "tesseract.exe"))

    return candidates


def refresh_ocr_capability() -> bool:
    global OCR_AVAILABLE, OCR_BINARY_PATH, OCR_ERROR  # pylint: disable=global-statement

    if "pytesseract" not in globals():
        OCR_AVAILABLE = False
        OCR_BINARY_PATH = ""
        OCR_ERROR = "pytesseract import failed"
        return False

    last_error = "Tesseract binary not found."
    for candidate in _tesseract_candidates():
        try:
            if candidate.exists():
                pytesseract.pytesseract.tesseract_cmd = str(candidate)
            else:
                continue
            pytesseract.get_tesseract_version()
            OCR_AVAILABLE = True
            OCR_BINARY_PATH = str(candidate)
            OCR_ERROR = None
            return True
        except Exception as exc:  # pylint: disable=broad-except
            last_error = str(exc)

    try:
        pytesseract.get_tesseract_version()
        OCR_AVAILABLE = True
        OCR_BINARY_PATH = text(getattr(pytesseract.pytesseract, "tesseract_cmd", "")) or text(shutil.which("tesseract"))
        OCR_ERROR = None
        return True
    except Exception as exc:  # pylint: disable=broad-except
        OCR_AVAILABLE = False
        OCR_BINARY_PATH = ""
        OCR_ERROR = str(exc) or last_error
        return False


def text(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    return "" if s.lower() == "nan" else s


def openai_invoice_model() -> str:
    if load_dotenv is not None:
        load_dotenv(ROOT_DIR / ".env", override=False)
        load_dotenv(BASE_DIR / ".env", override=True)
    return text(os.environ.get("OPENAI_INVOICE_MODEL")) or "gpt-4.1-mini"


def invoice_parser_capability() -> Dict[str, Any]:
    error = None
    enabled = True
    if not OPENAI_SDK_AVAILABLE:
        enabled = False
        error = "openai Python SDK is not installed."
    elif not text(os.environ.get("OPENAI_API_KEY")):
        enabled = False
        error = "OPENAI_API_KEY is not set."
    return {
        "enabled": enabled,
        "model": openai_invoice_model(),
        "error": error,
    }


def openai_invoice_client() -> OpenAI | None:
    global OPENAI_ERROR  # pylint: disable=global-statement

    capability = invoice_parser_capability()
    if not capability["enabled"]:
        OPENAI_ERROR = capability["error"]
        return None
    OPENAI_ERROR = None
    return OpenAI(api_key=text(os.environ.get("OPENAI_API_KEY")))


def app_key(v: Any) -> str:
    s = text(v).lower().replace("_", " ")
    s = " ".join(s.split())
    return s.replace(" / ", "/")


def num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except TypeError:
        pass
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def norm_key(v: Any) -> str:
    s = text(v).lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def color_key(v: Any) -> str:
    s = text(v).upper()
    for color in COLOR_FAMILY_FALLBACK:
        if color in s:
            return color
    return ""


def parse_excel_date(v: Any) -> pd.Timestamp | None:
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except TypeError:
        pass
    parsed = pd.to_datetime(v, dayfirst=True, errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed


def method_id_from_text(v: Any, method_counts: Dict[str, int] | None = None) -> str:
    key = norm_key(v)
    if not key:
        return ""
    direct = key.replace(" ", "_")
    if direct in CURRENT_STANDARD_METHODS:
        return direct
    patterns = [
        ("method vi b", "method_vi_b"),
        ("method via", "method_vi_a"),
        ("method vi a", "method_vi_a"),
        ("method v b", "method_v_b"),
        ("method v a", "method_v_a"),
        ("method iv b", "method_iv_b"),
        ("method iv a", "method_iv_a"),
        ("method iii", "method_iii"),
        ("method ii", "method_ii"),
        ("method i b", "method_i_b"),
        ("method i a", "method_i_a"),
        ("alk mt", "method_i_a"),
        ("alk rt", "method_i_b"),
        ("asbestos", "method_ii"),
        ("asb", "method_ii"),
        ("cement", "method_iii"),
        ("cem", "method_iii"),
        ("silica con a", "method_iv_a"),
        ("silica con b", "method_iv_b"),
    ]
    for marker, method_id in patterns:
        if marker in key:
            return method_id
    if "method iv" in key:
        if method_counts is None:
            return "method_iv_a"
        count = method_counts.get("method_iv", 0) + 1
        method_counts["method_iv"] = count
        return "method_iv_a" if count == 1 else "method_iv_b"
    if "method i" in key:
        if method_counts is None:
            return "method_i_a"
        count = method_counts.get("method_i", 0) + 1
        method_counts["method_i"] = count
        return "method_i_a" if count == 1 else "method_i_b"
    return ""


def metric_key_from_text(v: Any) -> str:
    key = norm_key(v)
    if key in ("dl", "d l"):
        return "delta_l"
    if key in ("da", "d a"):
        return "delta_a"
    if key in ("db", "d b"):
        return "delta_b"
    if key in ("de", "d e", "delta e"):
        return "delta_e"
    if key == "strength":
        return "strength"
    return ""


def infer_color_family(sheet_name: Any, grade: Any = "", standard_code: Any = "") -> str:
    for candidate in (sheet_name, standard_code, grade):
        ck = color_key(candidate)
        if ck:
            return ck
    # The current client workbook only contains red inventory when no explicit
    # color column or sheet name is present.
    return "RED"


def current_standard_lookup(profiles: pd.DataFrame | None) -> Dict[str, Dict[Any, str]]:
    by_color: Dict[str, str] = {}
    by_color_grade: Dict[Tuple[str, str], str] = {}
    by_grade: Dict[str, str] = {}
    if profiles is None or profiles.empty:
        return {"byColor": by_color, "byColorGrade": by_color_grade, "byGrade": by_grade}

    for _, row in profiles.iterrows():
        code = text(row.get("standard_code"))
        grade = text(row.get("grade")).upper()
        color = text(row.get("color_family")).upper()
        if not code:
            continue
        if grade and grade != "ALL":
            by_grade.setdefault(grade, code)
        if color:
            by_color.setdefault(color, code)
            if grade and grade != "ALL":
                by_color_grade.setdefault((color, grade), code)
    return {"byColor": by_color, "byColorGrade": by_color_grade, "byGrade": by_grade}


def resolve_inventory_standard(grade: Any, color_family: Any, profiles: pd.DataFrame | None) -> str:
    grade_key = text(grade).upper()
    color = text(color_family).upper()
    lookup = current_standard_lookup(profiles)
    if color and grade_key and (color, grade_key) in lookup["byColorGrade"]:
        return lookup["byColorGrade"][(color, grade_key)]
    if color and color in lookup["byColor"]:
        return lookup["byColor"][color]
    if grade_key and grade_key in lookup["byGrade"]:
        return lookup["byGrade"][grade_key]
    return color or "CURRENT"


def current_standards_from_profiles(profiles: pd.DataFrame | None, inv: pd.DataFrame | None = None) -> List[Dict[str, Any]]:
    if profiles is None or profiles.empty:
        return []
    inventory_color_by_standard: Dict[str, str] = {}
    if inv is not None and not inv.empty and {"standard_code", "color_family"}.issubset(inv.columns):
        for _, row in inv.iterrows():
            code = text(row.get("standard_code"))
            color = text(row.get("color_family")).upper()
            if code and color:
                inventory_color_by_standard.setdefault(code, color)

    rows: List[Dict[str, Any]] = []
    grouped = profiles.copy()
    if "color_family" not in grouped.columns:
        grouped["color_family"] = ""
    if "production_date" not in grouped.columns:
        grouped["production_date"] = ""
    for (color, code), scoped in grouped.groupby(["color_family", "standard_code"], dropna=False):
        standard_code = text(code)
        if not standard_code:
            continue
        color_family = text(color).upper() or inventory_color_by_standard.get(standard_code, "")
        if not color_family:
            color_family = infer_color_family("", scoped.iloc[0].get("grade"), standard_code)
        grade_values = sorted({text(v) for v in scoped.get("grade", []).tolist() if text(v)})
        grade = grade_values[0] if len(grade_values) == 1 else ("Multiple" if grade_values else "ALL")
        preview = choose_preview_profile(profiles, standard_code, grade_values[0] if grade_values else "")
        rows.append(
            {
                "colorFamily": color_family,
                "standardCode": standard_code,
                "grade": grade,
                "productionDate": text(scoped.get("production_date", pd.Series([""])).iloc[0]),
                "referenceL": preview["L"],
                "referenceA": preview["a"],
                "referenceB": preview["b"],
                "methods": sorted({text(v) for v in scoped.get("method_id", []).tolist() if text(v)}),
            }
        )
    rows.sort(key=lambda r: (r["colorFamily"], r["standardCode"]))
    return rows


def lab_to_hex(l_star: float, a_star: float, b_star: float) -> str:
    """Convert CIE LAB to sRGB hex (D65/2deg)."""
    y = (l_star + 16.0) / 116.0
    x = y + (a_star / 500.0)
    z = y - (b_star / 200.0)

    def f_inv(t: float) -> float:
        if t > 0.206893034:
            return t ** 3
        return (t - (16.0 / 116.0)) / 7.787

    x = 95.047 * f_inv(x)
    y = 100.000 * f_inv(y)
    z = 108.883 * f_inv(z)

    x /= 100.0
    y /= 100.0
    z /= 100.0

    r = (3.2406 * x) + (-1.5372 * y) + (-0.4986 * z)
    g = (-0.9689 * x) + (1.8758 * y) + (0.0415 * z)
    b = (0.0557 * x) + (-0.2040 * y) + (1.0570 * z)

    def gamma_correct(c: float) -> float:
        if c <= 0.0031308:
            return 12.92 * c
        return (1.055 * (c ** (1.0 / 2.4))) - 0.055

    r = min(1.0, max(0.0, gamma_correct(r)))
    g = min(1.0, max(0.0, gamma_correct(g)))
    b = min(1.0, max(0.0, gamma_correct(b)))

    return "#{:02x}{:02x}{:02x}".format(int(round(r * 255)), int(round(g * 255)), int(round(b * 255)))


def choose_preview_profile(
    profiles: pd.DataFrame,
    standard_code: str,
    grade: str,
) -> Dict[str, Any]:
    """Pick a representative profile row and return LAB + HEX preview."""
    scoped = profiles[
        (profiles["standard_code"] == standard_code)
        & (profiles["grade"] == grade)
    ].copy()
    if scoped.empty:
        scoped = profiles[profiles["standard_code"] == standard_code].copy()
    if scoped.empty:
        return {"methodId": None, "L": None, "a": None, "b": None, "hex": None}

    for method in PREVIEW_METHOD_PRIORITY:
        row = scoped[scoped["method_id"] == method]
        if row.empty:
            continue
        candidate = row.iloc[0]
        l_star, a_star, b_star = num(candidate.get("reference_l")), num(candidate.get("reference_a")), num(candidate.get("reference_b"))
        if None not in (l_star, a_star, b_star):
            return {
                "methodId": method,
                "L": l_star,
                "a": a_star,
                "b": b_star,
                "hex": lab_to_hex(l_star, a_star, b_star),
            }

    for _, candidate in scoped.iterrows():
        l_star, a_star, b_star = num(candidate.get("reference_l")), num(candidate.get("reference_a")), num(candidate.get("reference_b"))
        if None not in (l_star, a_star, b_star):
            return {
                "methodId": text(candidate.get("method_id")),
                "L": l_star,
                "a": a_star,
                "b": b_star,
                "hex": lab_to_hex(l_star, a_star, b_star),
            }

    return {"methodId": None, "L": None, "a": None, "b": None, "hex": None}
    try:
        if pd.isna(v):
            return None
    except TypeError:
        pass
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def dataset_guard() -> Tuple[bool, Any]:
    if dataset_state["loaded"]:
        return True, None
    return False, (
        jsonify(
            {
                "success": False,
                "message": "Stitched dataset failed to load.",
                "error": dataset_state["error"],
                "requiredFiles": {k: str(v) for k, v in DATASET_FILES.items()},
            }
        ),
        500,
    )


def prepare_df(name: str, df: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in REQUIRED_COLS[name] if c not in df.columns]
    if missing:
        raise ValueError(f"{name}.csv missing columns: {', '.join(missing)}")

    x = df.copy()
    if name == "invoice_lines":
        if "fulfillment_status" not in x.columns:
            x["fulfillment_status"] = "open"
        if "outstanding_qty_mt" not in x.columns:
            x["outstanding_qty_mt"] = x.get("qty_mt", 0.0)
        if "last_partial_at" not in x.columns:
            x["last_partial_at"] = ""
        for c in ("target_delta_l", "target_delta_a", "target_delta_b"):
            if c not in x.columns:
                x[c] = np.nan
    for c in ["standard_code", "grade", "lot_no", "invoice_id", "invoice_line_id", "method_id"]:
        if c in x.columns:
            x[c] = x[c].apply(text)
    if "application" in x.columns:
        x["application"] = x["application"].apply(text)
    if "target_method_id" in x.columns:
        x["target_method_id"] = x["target_method_id"].apply(text)
    if "source_status" in x.columns:
        x["source_status"] = x["source_status"].apply(text)
    if "color_family" in x.columns:
        x["color_family"] = x["color_family"].apply(text).str.upper()
    if "production_date" in x.columns:
        x["production_date"] = x["production_date"].apply(text)
    if "customer_name" in x.columns:
        x["customer_name"] = x["customer_name"].apply(text)
    if "invoice_number" in x.columns:
        x["invoice_number"] = x["invoice_number"].apply(text)
    if "invoice_date" in x.columns:
        x["invoice_date"] = x["invoice_date"].apply(text)

    for c in ["qty_mt_on_hand", "qty_mt", "outstanding_qty_mt", "delta_l", "delta_a", "delta_b", "delta_e", "strength", "absolute_l", "absolute_a", "absolute_b",
              "target_l", "target_a", "target_b", "target_delta_l", "target_delta_a", "target_delta_b", "reference_l", "reference_a", "reference_b"]:
        if c in x.columns:
            x[c] = pd.to_numeric(x[c], errors="coerce")
    if "qty_mt_on_hand" in x.columns:
        x["qty_mt_on_hand"] = x["qty_mt_on_hand"].fillna(0.0)
    if "qty_mt" in x.columns:
        x["qty_mt"] = x["qty_mt"].fillna(0.0)
    if "outstanding_qty_mt" in x.columns:
        x["outstanding_qty_mt"] = x["outstanding_qty_mt"].where(x["outstanding_qty_mt"].notna(), x.get("qty_mt", 0.0))
    if "fulfillment_status" in x.columns:
        x["fulfillment_status"] = x["fulfillment_status"].apply(text).replace("", "open")
    if "last_partial_at" in x.columns:
        x["last_partial_at"] = x["last_partial_at"].apply(text)
    if "inventory_match_status" in x.columns:
        x["inventory_match_status"] = x["inventory_match_status"].apply(text)

    if name == "lot_test_results" and {"delta_l", "delta_a", "delta_b"}.issubset(x.columns):
        dl = pd.to_numeric(x["delta_l"], errors="coerce")
        da = pd.to_numeric(x["delta_a"], errors="coerce")
        db = pd.to_numeric(x["delta_b"], errors="coerce")
        computed = np.sqrt(dl.pow(2) + da.pow(2) + db.pow(2)).round(4)
        x["delta_e"] = computed.where(computed.notna(), x.get("delta_e"))
    return x


def canonicalize_dataset_df(name: str, df: pd.DataFrame) -> Tuple[pd.DataFrame, Dict[str, Any]]:
    """Normalize datasets and collapse duplicate business keys by keeping the latest row."""
    x = prepare_df(name, df)
    keys = DATASET_UNIQUE_KEYS.get(name, [])
    summary = {
        "keyColumns": keys,
        "strategy": None,
        "inputRows": int(len(x)),
        "outputRows": int(len(x)),
        "deduplicatedRows": 0,
    }
    if not keys or x.empty:
        return x, summary

    x = x.copy()
    x["_row_order"] = np.arange(len(x))
    before = len(x)
    x = (
        x.drop_duplicates(subset=keys, keep="last")
        .sort_values("_row_order")
        .drop(columns=["_row_order"])
        .reset_index(drop=True)
    )
    after = len(x)
    summary.update(
        {
            "strategy": f"keep_latest_by_{'_'.join(keys)}",
            "outputRows": int(after),
            "deduplicatedRows": int(before - after),
        }
    )
    return x, summary


RESETTABLE_DATASETS = ("inventory_lots", "invoice_lines")


def baseline_path_for(name: str) -> Path:
    src = DATASET_FILES[name]
    return src.with_suffix(src.suffix + ".baseline")


def load_seed_inventory_lots() -> pd.DataFrame:
    if not SEED_DATASET_FILE.exists():
        raise FileNotFoundError(f"Missing seed dataset: {SEED_DATASET_FILE}")
    seed_df = pd.read_excel(SEED_DATASET_FILE, sheet_name=SEED_INVENTORY_SHEET)
    return prepare_df("inventory_lots", seed_df)


def _inventory_workbook_synced_mtime() -> float | None:
    if not INVENTORY_SYNC_META_FILE.exists():
        return None
    try:
        return float(text(INVENTORY_SYNC_META_FILE.read_text(encoding="utf-8")))
    except Exception:  # pylint: disable=broad-except
        return None


def _remember_inventory_workbook_mtime(mtime: float) -> None:
    try:
        INVENTORY_SYNC_META_FILE.write_text(str(mtime), encoding="utf-8")
    except Exception:  # pylint: disable=broad-except
        pass


def _find_row_containing(df: pd.DataFrame, token: str) -> Tuple[int, int] | None:
    wanted = norm_key(token)
    for r in range(len(df)):
        for c, value in enumerate(df.iloc[r].tolist()):
            if norm_key(value) == wanted:
                return r, c
    return None


def _parse_inventory_sheet(sheet_name: str, df: pd.DataFrame, profiles: pd.DataFrame | None) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    lot_pos = _find_row_containing(df, "LOT")
    if lot_pos is None:
        return [], []

    lot_row_idx, lot_label_col = lot_pos
    grade_row_idx = None
    for r in range(max(0, lot_row_idx - 3), lot_row_idx + 1):
        for value in df.iloc[r].tolist():
            if norm_key(value) == "grade":
                grade_row_idx = r
                break
        if grade_row_idx is not None:
            break
    if grade_row_idx is None:
        grade_row_idx = max(0, lot_row_idx - 1)

    qty_row_idx = None
    for r in range(lot_row_idx + 1, min(len(df), lot_row_idx + 5)):
        row_keys = {norm_key(v) for v in df.iloc[r].tolist()}
        if "qty mt" in row_keys or "qty" in row_keys:
            qty_row_idx = r
            break
    if qty_row_idx is None:
        return [], []

    data_cols: List[int] = []
    for c in range(lot_label_col + 1, df.shape[1]):
        lot_no = text(df.iat[lot_row_idx, c])
        grade = text(df.iat[grade_row_idx, c])
        if lot_no and grade and norm_key(lot_no) not in ("lot", "qty mt", "qty"):
            data_cols.append(c)
    if not data_cols:
        return [], []

    inv_rows: List[Dict[str, Any]] = []
    by_col: Dict[int, Dict[str, str]] = {}
    for c in data_cols:
        lot_no = text(df.iat[lot_row_idx, c])
        grade = text(df.iat[grade_row_idx, c])
        qty = num(df.iat[qty_row_idx, c])
        color_family = infer_color_family(sheet_name, grade)
        standard_code = resolve_inventory_standard(grade, color_family, profiles)
        lot_id = f"LOT-{lot_no}"
        by_col[c] = {
            "lot_id": lot_id,
            "lot_no": lot_no,
            "grade": grade,
            "standard_code": standard_code,
            "color_family": color_family,
        }
        inv_rows.append(
            {
                "lot_id": lot_id,
                "lot_no": lot_no,
                "grade": grade,
                "standard_code": standard_code,
                "qty_mt_on_hand": qty if qty is not None else 0.0,
                "color_family": color_family,
                "source_sheet": sheet_name,
            }
        )

    metric_rows: Dict[Tuple[str, str, str], Dict[str, Any]] = {}
    current_method = ""
    method_counts: Dict[str, int] = {}
    current_label = ""
    for r in range(qty_row_idx + 1, len(df)):
        row = df.iloc[r]
        explicit_method = method_id_from_text(row.get(0), method_counts)
        if explicit_method:
            current_method = explicit_method
        label = text(row.get(1)) or current_label
        if text(row.get(1)):
            current_label = text(row.get(1))

        metric = ""
        for c in range(0, min(4, df.shape[1])):
            metric = metric_key_from_text(row.get(c))
            if metric:
                break
        if not metric or not current_method:
            continue

        for c in data_cols:
            value = num(row.get(c))
            if value is None:
                continue
            lot_meta = by_col[c]
            key = (lot_meta["lot_no"], lot_meta["standard_code"], current_method)
            metric_rows.setdefault(
                key,
                {
                    **lot_meta,
                    "method_id": current_method,
                    "method_label": METHOD_DISPLAY_LABELS.get(current_method, label),
                    "source_status": "workbook",
                    "source_sheet": sheet_name,
                },
            )[metric] = value

    test_rows = []
    for row in metric_rows.values():
        if not any(num(row.get(c)) is not None for c in ("delta_l", "delta_a", "delta_b")):
            continue
        test_rows.append(row)
    return inv_rows, test_rows


def parse_main_inventory_workbook(path: Path, profiles: pd.DataFrame | None) -> Tuple[pd.DataFrame, pd.DataFrame]:
    all_inv: List[Dict[str, Any]] = []
    all_tests: List[Dict[str, Any]] = []
    workbook = pd.ExcelFile(path)
    for sheet_name in workbook.sheet_names:
        raw = pd.read_excel(path, sheet_name=sheet_name, header=None, dtype=object)
        inv_rows, test_rows = _parse_inventory_sheet(sheet_name, raw, profiles)
        all_inv.extend(inv_rows)
        all_tests.extend(test_rows)

    if not all_inv:
        raise ValueError(f"No LOT/QTY inventory layout found in {path.name}")

    inv_df = pd.DataFrame(all_inv)
    tests_df = pd.DataFrame(all_tests)
    for col in REQUIRED_COLS["lot_test_results"]:
        if col not in tests_df.columns:
            tests_df[col] = np.nan
    inv_df, _ = canonicalize_dataset_df("inventory_lots", inv_df)
    tests_df, _ = canonicalize_dataset_df("lot_test_results", tests_df)
    return inv_df, tests_df


def sync_inventory_workbook_if_changed(profiles: pd.DataFrame | None, force: bool = False) -> Dict[str, Any]:
    if not MAIN_INVENTORY_FILE.exists():
        return {"synced": False, "reason": "missing", "path": str(MAIN_INVENTORY_FILE)}
    mtime = MAIN_INVENTORY_FILE.stat().st_mtime
    last_synced = _inventory_workbook_synced_mtime()
    if (
        not force
        and last_synced is not None
        and abs(last_synced - mtime) < 0.001
        and DATASET_FILES["inventory_lots"].exists()
        and DATASET_FILES["lot_test_results"].exists()
    ):
        return {"synced": False, "reason": "unchanged", "path": str(MAIN_INVENTORY_FILE)}

    inv_df, tests_df = parse_main_inventory_workbook(MAIN_INVENTORY_FILE, profiles)
    _atomic_write_csv(inv_df, DATASET_FILES["inventory_lots"])
    _atomic_write_csv(tests_df, DATASET_FILES["lot_test_results"])
    _remember_inventory_workbook_mtime(mtime)
    return {
        "synced": True,
        "reason": "forced" if force else "changed",
        "path": str(MAIN_INVENTORY_FILE),
        "inventoryRows": int(len(inv_df)),
        "lotTestRows": int(len(tests_df)),
        "workbookModifiedAt": datetime.fromtimestamp(mtime, timezone.utc).replace(microsecond=0).isoformat(),
    }


def ensure_baselines() -> None:
    for name in RESETTABLE_DATASETS:
        src = DATASET_FILES[name]
        bl = baseline_path_for(name)
        if src.exists() and not bl.exists():
            try:
                bl.write_bytes(src.read_bytes())
            except Exception:  # pylint: disable=broad-except
                pass


def load_default_datasets() -> None:
    try:
        loaded: Dict[str, pd.DataFrame] = {}
        profile_path = DATASET_FILES["standard_profiles"]
        profiles_for_inventory = None
        if profile_path.exists():
            profiles_for_inventory, _ = canonicalize_dataset_df("standard_profiles", pd.read_csv(profile_path))
        inventory_sync = sync_inventory_workbook_if_changed(profiles_for_inventory)
        for name, path in DATASET_FILES.items():
            if not path.exists():
                raise FileNotFoundError(f"Missing required dataset: {path}")
            loaded[name], _ = canonicalize_dataset_df(name, pd.read_csv(path))
        databases.update(loaded)
        dataset_state.update({"loaded": True, "loaded_at_utc": now_iso(), "error": None})
        source_data_state.update({
            "loaded": True,
            "loaded_at_utc": now_iso(),
            "error": None,
            "currentStandards": current_standards_from_profiles(loaded.get("standard_profiles"), loaded.get("inventory_lots")),
            "inventorySync": inventory_sync,
        })
        ensure_baselines()
    except Exception as exc:  # pylint: disable=broad-except
        for k in databases:
            databases[k] = None
        dataset_state.update({"loaded": False, "loaded_at_utc": None, "error": str(exc)})
        source_data_state.update({"loaded": False, "loaded_at_utc": None, "error": str(exc)})


# -- ANALYSIS HELPERS INSERT POINT --
def parse_required_methods(value: Any) -> List[str]:
    raw = text(value)
    if not raw:
        return []
    out: List[str] = []
    chunks = re.split(r"[,;|]+|\band\b", raw, flags=re.IGNORECASE)
    for chunk in chunks:
        method_id = method_id_from_text(chunk)
        if method_id and method_id not in out:
            out.append(method_id)
    if not out:
        method_id = method_id_from_text(raw)
        if method_id:
            out.append(method_id)
    return out


def ordered_methods(methods: List[str]) -> List[str]:
    seen: set[str] = set()
    ordered: List[str] = []
    for method_id in CURRENT_STANDARD_METHODS:
        if method_id in methods and method_id not in seen:
            ordered.append(method_id)
            seen.add(method_id)
    for method_id in sorted(methods):
        if method_id not in seen:
            ordered.append(method_id)
            seen.add(method_id)
    return ordered


def method_selection_order(line: Dict[str, Any], available_methods: List[str]) -> Tuple[List[str], str, List[str], bool]:
    required = parse_required_methods(line.get("target_method_id"))
    if required:
        # Highest method in CURRENT_STANDARD_METHODS hierarchy wins, since each
        # successive test refines the previous one's dL/da/db. Methods not in
        # the catalog rank below the listed ones (preserve relative input order).
        rank = {m: i for i, m in enumerate(CURRENT_STANDARD_METHODS)}
        ordered_required = sorted(
            required,
            key=lambda m: (-(rank.get(m, -1)), required.index(m)),
        )
        available = [m for m in ordered_required if m in available_methods]
        return (available or ordered_required), "invoice_line_test_requirement", ordered_required, True

    ordered_available = ordered_methods(available_methods)
    if BASE_TEST_METHOD in ordered_available:
        ordered_available = [BASE_TEST_METHOD] + [m for m in ordered_available if m != BASE_TEST_METHOD]
    return ordered_available, "base_test_then_availability", [], False


def delta_e_label(d_e: float | None) -> Dict[str, str]:
    """CIE-standard qualitative label for a delta-E value."""
    if d_e is None or (isinstance(d_e, float) and np.isnan(d_e)):
        return {"key": "unknown", "label": "no data", "blurb": "No measurable color delta."}
    if d_e <= 0.5:
        return {"key": "imperceptible", "label": "imperceptible difference",
                "blurb": "Indistinguishable to the human eye."}
    if d_e <= 1.0:
        return {"key": "slight", "label": "slight difference",
                "blurb": "Visible only to a trained observer under ideal light."}
    if d_e <= 2.0:
        return {"key": "noticeable", "label": "noticeable difference",
                "blurb": "Perceptible side-by-side; acceptable for most uses."}
    if d_e <= 3.5:
        return {"key": "distinct", "label": "distinct",
                "blurb": "Clearly different colors at a glance."}
    return {"key": "obvious", "label": "obvious mismatch",
            "blurb": "Two different colors. Use only with customer approval."}


def fit_band(d_e: float | None) -> str:
    if d_e is None or np.isnan(d_e):
        return "unknown"
    if d_e <= 1.0:
        return "excellent"
    if d_e <= 1.5:
        return "strict_fit"
    if d_e <= 3.5:
        return "relaxed_fit"
    return "weak_fit"


def in_tolerance(d_e: float | None, mode: str) -> bool:
    if mode == "review":
        return True
    if d_e is None or np.isnan(d_e):
        return False
    return d_e <= TOLERANCES.get(mode, TOLERANCES[DEFAULT_TOLERANCE])


def fit_delta_e(test_row: Dict[str, Any], line_row: Dict[str, Any]) -> float | None:
    tl, ta, tb = num(line_row.get("target_l")), num(line_row.get("target_a")), num(line_row.get("target_b"))
    al, aa, ab = num(test_row.get("absolute_l")), num(test_row.get("absolute_a")), num(test_row.get("absolute_b"))
    if None not in (tl, ta, tb, al, aa, ab):
        return float(np.sqrt((al - tl) ** 2 + (aa - ta) ** 2 + (ab - tb) ** 2))
    return num(test_row.get("delta_e"))


def target_delta_vector(line_row: Dict[str, Any], reference_lab: Dict[str, float | None]) -> Tuple[np.ndarray | None, str]:
    """Compute invoice target vector in dL/da/db space against standard reference."""
    dl, da, db = num(line_row.get("target_delta_l")), num(line_row.get("target_delta_a")), num(line_row.get("target_delta_b"))
    if None not in (dl, da, db):
        return np.array([dl, da, db], dtype=float), "invoice_delta_lab"

    tl, ta, tb = num(line_row.get("target_l")), num(line_row.get("target_a")), num(line_row.get("target_b"))
    rl, ra, rb = reference_lab.get("L"), reference_lab.get("a"), reference_lab.get("b")
    if None not in (tl, ta, tb, rl, ra, rb):
        return np.array([tl - rl, ta - ra, tb - rb], dtype=float), "delta_from_standard"
    if None not in (tl, ta, tb):
        return np.array([tl, ta, tb], dtype=float), "absolute_target_fallback"
    return None, "missing_target_lab"


def lot_delta_vector(test_row: Dict[str, Any], reference_lab: Dict[str, float | None]) -> np.ndarray | None:
    """Compute lot vector in dL/da/db space; fallback from absolute vs reference when needed."""
    dl, da, db = num(test_row.get("delta_l")), num(test_row.get("delta_a")), num(test_row.get("delta_b"))
    if None not in (dl, da, db):
        return np.array([dl, da, db], dtype=float)

    al, aa, ab = num(test_row.get("absolute_l")), num(test_row.get("absolute_a")), num(test_row.get("absolute_b"))
    rl, ra, rb = reference_lab.get("L"), reference_lab.get("a"), reference_lab.get("b")
    if None not in (al, aa, ab, rl, ra, rb):
        return np.array([al - rl, aa - ra, ab - rb], dtype=float)
    return None


def safe_cosine_and_angle(
    query_vec: np.ndarray,
    lot_vec: np.ndarray,
    query_abs_vec: np.ndarray | None = None,
    lot_abs_vec: np.ndarray | None = None,
) -> Tuple[float | None, float | None]:
    """Compute cosine similarity with dL/da/db vectors and absolute-Lab fallback."""
    use_query = query_vec
    use_lot = lot_vec

    query_norm = float(np.linalg.norm(query_vec))
    lot_norm = float(np.linalg.norm(lot_vec))

    if (query_norm == 0.0 or lot_norm == 0.0) and query_abs_vec is not None and lot_abs_vec is not None:
        abs_q_norm = float(np.linalg.norm(query_abs_vec))
        abs_l_norm = float(np.linalg.norm(lot_abs_vec))
        if abs_q_norm > 0.0 and abs_l_norm > 0.0:
            use_query = query_abs_vec
            use_lot = lot_abs_vec
            query_norm = abs_q_norm
            lot_norm = abs_l_norm

    if query_norm == 0.0 and lot_norm == 0.0:
        return 1.0, 0.0
    if query_norm == 0.0 or lot_norm == 0.0:
        return 0.0, 90.0

    cosine = float(np.dot(use_query, use_lot) / (query_norm * lot_norm))
    cosine = max(-1.0, min(1.0, cosine))
    angle = float(np.degrees(np.arccos(cosine)))
    return cosine, angle


def assign_rank(cands: List[Dict[str, Any]], metric_key: str, rank_key: str, higher_better: bool = False) -> None:
    """Assign deterministic rank for metric, placing missing metrics last."""
    present = []
    missing = []
    for cand in cands:
        value = cand.get(metric_key)
        if value is None or (isinstance(value, float) and np.isnan(value)):
            missing.append(cand)
        else:
            present.append(cand)

    present.sort(
        key=lambda c: (c[metric_key], c["lotNo"]) if not higher_better else (-c[metric_key], c["lotNo"])
    )
    ordered = present + sorted(missing, key=lambda c: c["lotNo"])
    for rank, cand in enumerate(ordered, start=1):
        cand[rank_key] = rank


def model_score_and_rank(
    cands: List[Dict[str, Any]],
    target_vec: np.ndarray | None,
    target_abs_vec: np.ndarray | None,
) -> List[Dict[str, Any]]:
    """Compute Euclidean, Cosine, KNN, and consensus ranking for lot candidates."""
    if not cands:
        return cands

    for cand in cands:
        cand["euclideanDeltaE"] = None
        cand["cosineSimilarity"] = None
        cand["cosineAngularDistance"] = None
        cand["knnDistance"] = None
        cand["euclideanRank"] = None
        cand["cosineRank"] = None
        cand["knnRank"] = None
        cand["consensusRank"] = None
        cand["consensusScore"] = None

    valid = [cand for cand in cands if cand.get("_deltaVector") is not None and target_vec is not None]

    if valid:
        for cand in valid:
            dvec = cand["_deltaVector"]
            cand["euclideanDeltaE"] = round(float(np.linalg.norm(dvec - target_vec)), 4)
            cosine, angle = safe_cosine_and_angle(
                target_vec,
                dvec,
                query_abs_vec=target_abs_vec,
                lot_abs_vec=cand.get("_absoluteVector"),
            )
            cand["cosineSimilarity"] = round(float(cosine), 6) if cosine is not None else None
            cand["cosineAngularDistance"] = round(float(angle), 4) if angle is not None else None

        if len(valid) == 1:
            valid[0]["knnDistance"] = valid[0]["euclideanDeltaE"]
        else:
            vectors = np.array([cand["_deltaVector"] for cand in valid], dtype=float)
            query = target_vec.reshape(1, -1)
            scaler = StandardScaler()
            vectors_scaled = scaler.fit_transform(vectors)
            query_scaled = scaler.transform(query)
            knn = NearestNeighbors(n_neighbors=len(valid), metric="euclidean")
            knn.fit(vectors_scaled)
            distances, indices = knn.kneighbors(query_scaled)
            for pos, idx in enumerate(indices[0]):
                valid[idx]["knnDistance"] = round(float(distances[0][pos]), 6)

    assign_rank(cands, "euclideanDeltaE", "euclideanRank", higher_better=False)
    assign_rank(cands, "cosineSimilarity", "cosineRank", higher_better=True)
    assign_rank(cands, "knnDistance", "knnRank", higher_better=False)

    total = len(cands)
    for cand in cands:
        p_e = total - cand["euclideanRank"] + 1
        p_c = total - cand["cosineRank"] + 1
        p_k = total - cand["knnRank"] + 1
        cand["consensusScore"] = round(((p_e + p_c + p_k) / (3 * total)) * 100.0, 3)

    ranked = sorted(
        cands,
        key=lambda c: (
            -c["consensusScore"],
            c["euclideanRank"],
            -c["availableQtyMt"],
            c["lotNo"],
        ),
    )
    for rank, cand in enumerate(ranked, start=1):
        cand["consensusRank"] = rank
    return ranked


def invoice_index() -> pd.DataFrame:
    lines = databases["invoice_lines"].copy()
    headers = databases["invoice_headers"][["invoice_id", "customer_name", "invoice_date", "invoice_number"]].copy()
    x = lines.merge(headers, on="invoice_id", how="left", suffixes=("", "_h"))
    if "invoice_number_h" in x.columns:
        x["invoice_number"] = x["invoice_number"].where(x["invoice_number"].notna(), x["invoice_number_h"])
        x.drop(columns=["invoice_number_h"], inplace=True)
    return x


def supported_standards() -> set[str]:
    inv = databases["inventory_lots"]
    return {
        text(v)
        for v in inv.loc[inv["qty_mt_on_hand"] > 0, "standard_code"].tolist()
        if text(v)
    }


def supported_colors() -> set[str]:
    inv = databases["inventory_lots"]
    if inv is None or inv.empty or "color_family" not in inv.columns:
        return set()
    return {
        text(v).upper()
        for v in inv.loc[inv["qty_mt_on_hand"] > 0, "color_family"].tolist()
        if text(v)
    }


def color_for_analysis_selector(selector: Any) -> str:
    key = text(selector).upper()
    if not key:
        return ""
    if key in COLOR_FAMILY_FALLBACK:
        return key

    inv = databases.get("inventory_lots")
    if inv is not None and not inv.empty and {"standard_code", "color_family"}.issubset(inv.columns):
        matched = inv[inv["standard_code"].apply(lambda v: text(v).upper()) == key]
        colors = sorted({text(v).upper() for v in matched.get("color_family", []).tolist() if text(v)})
        if len(colors) == 1:
            return colors[0]

    profiles = databases.get("standard_profiles")
    if profiles is not None and not profiles.empty and {"standard_code", "color_family"}.issubset(profiles.columns):
        matched = profiles[profiles["standard_code"].apply(lambda v: text(v).upper()) == key]
        colors = sorted({text(v).upper() for v in matched.get("color_family", []).tolist() if text(v)})
        if len(colors) == 1:
            return colors[0]
    return key


def current_standard_code_for_color(color_family: Any) -> str:
    color = text(color_family).upper()
    if not color:
        return ""
    profiles = databases.get("standard_profiles")
    if profiles is not None and not profiles.empty and {"standard_code", "color_family"}.issubset(profiles.columns):
        scoped = profiles[profiles["color_family"].apply(lambda v: text(v).upper()) == color].copy()
        codes = sorted({text(v) for v in scoped.get("standard_code", []).tolist() if text(v)})
        if len(codes) == 1:
            return codes[0]

    inv = databases.get("inventory_lots")
    if inv is not None and not inv.empty and {"standard_code", "color_family"}.issubset(inv.columns):
        scoped = inv[inv["color_family"].apply(lambda v: text(v).upper()) == color].copy()
        codes = sorted({text(v) for v in scoped.get("standard_code", []).tolist() if text(v)})
        if len(codes) == 1:
            return codes[0]
    return ""


def build_standards_payload() -> List[Dict[str, Any]]:
    inv = databases["inventory_lots"]
    lot_tests = databases["lot_test_results"]
    lines = databases["invoice_lines"]
    profiles = databases["standard_profiles"]
    in_stock = inv[inv["qty_mt_on_hand"] > 0].copy()

    def scoped_inventory(color_family: str, standard_code: str) -> Tuple[pd.DataFrame, str]:
        color = text(color_family).upper()
        code = text(standard_code).upper()
        if code and "standard_code" in in_stock.columns:
            scoped = in_stock[in_stock["standard_code"].apply(lambda v: text(v).upper()) == code].copy()
            if not scoped.empty:
                return scoped, "standard"
        if color and "color_family" in in_stock.columns:
            scoped = in_stock[in_stock["color_family"].apply(lambda v: text(v).upper()) == color].copy()
            if not scoped.empty:
                return scoped, "color_fallback"
        return in_stock.iloc[0:0].copy(), "empty"

    def invoice_applications(color_family: str, standard_code: str) -> List[str]:
        if lines is None or lines.empty:
            return []
        color = text(color_family).upper()
        code = text(standard_code).upper()
        scoped = lines
        if color and "color_family" in scoped.columns:
            scoped = scoped[scoped["color_family"].apply(lambda v: text(v).upper()) == color]
        elif code and "standard_code" in scoped.columns:
            scoped = scoped[scoped["standard_code"].apply(lambda v: text(v).upper()) == code]
        return sorted({text(v) for v in scoped.get("application", pd.Series([], dtype=str)).tolist() if text(v)})

    def append_payload(
        out: List[Dict[str, Any]],
        seen: set[Tuple[str, str]],
        standard_code: str,
        color_family: str,
        grade_hint: str = "",
        production_date: str = "",
        method_hint: List[str] | None = None,
    ) -> None:
        std = text(standard_code)
        color = text(color_family).upper() or color_for_analysis_selector(std)
        if not std:
            return
        key = (std.upper(), color)
        if key in seen:
            return
        seen.add(key)

        scoped_inv, inventory_scope = scoped_inventory(color, std)
        lot_nos = set(scoped_inv["lot_no"].apply(text).tolist()) if "lot_no" in scoped_inv.columns else set()
        inventory_qty = float(scoped_inv["qty_mt_on_hand"].sum()) if "qty_mt_on_hand" in scoped_inv.columns else 0.0
        lot_count = int(scoped_inv["lot_no"].nunique()) if "lot_no" in scoped_inv.columns else 0
        inventory_standard_codes = (
            sorted({text(v) for v in scoped_inv["standard_code"].tolist() if text(v)})
            if "standard_code" in scoped_inv.columns
            else []
        )
        grades = (
            sorted({text(v) for v in scoped_inv["grade"].tolist() if text(v)})
            if "grade" in scoped_inv.columns
            else []
        )
        source_sheets = (
            sorted({text(v) for v in scoped_inv["source_sheet"].tolist() if text(v)})
            if "source_sheet" in scoped_inv.columns
            else []
        )
        grade = text(grade_hint) or (grades[0] if len(grades) == 1 else ("Multiple" if grades else "ALL"))

        method_ids: List[str] = []
        if lot_nos and "lot_no" in lot_tests.columns and "method_id" in lot_tests.columns:
            test_mask = lot_tests["lot_no"].apply(text).isin(lot_nos)
            if inventory_scope == "standard" and "standard_code" in lot_tests.columns:
                test_mask &= lot_tests["standard_code"].apply(lambda v: text(v).upper()) == std.upper()
            elif color and "color_family" in lot_tests.columns:
                test_mask &= lot_tests["color_family"].apply(lambda v: text(v).upper()) == color
            method_ids = sorted({text(v) for v in lot_tests.loc[test_mask, "method_id"].tolist() if text(v)})
        if not method_ids:
            method_ids = sorted({text(v) for v in (method_hint or []) if text(v)})

        preview_grade = grade if grade not in ("Multiple", "ALL") else (grades[0] if grades else "")
        preview = choose_preview_profile(profiles, std, preview_grade)
        preview_hex = preview["hex"] or COLOR_FAMILY_FALLBACK.get(color, "#888888")
        out.append(
            {
                "standardCode": std,
                "currentStandardCode": std,
                "inventoryStandardCodes": inventory_standard_codes,
                "inventoryScope": inventory_scope,
                "sourceSheets": source_sheets,
                "grade": grade,
                "productionDate": text(production_date),
                "inventoryQtyMt": round(inventory_qty, 3),
                "lotCount": lot_count,
                "methods": method_ids,
                "applications": invoice_applications(color, std),
                "colorFamily": color,
                "analysisMode": "standard_color",
                "analysisKey": color or std,
                "previewMethodId": preview["methodId"],
                "previewLab": {
                    "L": round(float(preview["L"]), 3) if preview["L"] is not None else None,
                    "a": round(float(preview["a"]), 3) if preview["a"] is not None else None,
                    "b": round(float(preview["b"]), 3) if preview["b"] is not None else None,
                },
                "previewHex": preview_hex,
            }
        )

    out: List[Dict[str, Any]] = []
    seen: set[Tuple[str, str]] = set()

    current_rows = current_standards_from_profiles(profiles, inv)
    for row in current_rows:
        append_payload(
            out,
            seen,
            text(row.get("standardCode")),
            text(row.get("colorFamily")).upper(),
            text(row.get("grade")),
            text(row.get("productionDate")),
            row.get("methods") if isinstance(row.get("methods"), list) else [],
        )

    if not out and not in_stock.empty and "standard_code" in in_stock.columns:
        for std, scoped in in_stock.groupby("standard_code", dropna=False):
            standard_code = text(std)
            if not standard_code:
                continue
            colors = sorted({text(v).upper() for v in scoped.get("color_family", pd.Series([], dtype=str)).tolist() if text(v)})
            color_family = colors[0] if len(colors) == 1 else color_for_analysis_selector(standard_code)
            grades = sorted({text(v) for v in scoped.get("grade", pd.Series([], dtype=str)).tolist() if text(v)})
            grade = grades[0] if len(grades) == 1 else ("Multiple" if grades else "ALL")
            append_payload(out, seen, standard_code, color_family, grade)

    return sorted(out, key=lambda r: (text(r.get("colorFamily")), text(r.get("standardCode"))))


def analyze_standard_core(standard_code: str, tolerance_mode: str, app_filters: List[str]) -> Dict[str, Any]:
    inv = databases["inventory_lots"]
    tests = databases["lot_test_results"]
    profiles = databases["standard_profiles"]
    selected_standard_code = text(standard_code)
    selected_standard_key = selected_standard_code.upper()
    color_family = color_for_analysis_selector(selected_standard_code)

    in_stock = inv[inv["qty_mt_on_hand"] > 0].copy()
    lots = in_stock[
        in_stock["standard_code"].apply(lambda v: text(v).upper()) == selected_standard_key
    ].copy()
    inventory_scope = "standard"
    if lots.empty:
        lots = in_stock[
            in_stock["color_family"].apply(lambda v: text(v).upper()) == color_family
        ].copy()
        inventory_scope = "color_fallback"
    if lots.empty:
        raise ValueError(f"Standard '{selected_standard_code}' has no inventory-backed lots.")

    lot_nos = set(lots["lot_no"].tolist())
    remaining = {text(r["lot_no"]): float(r["qty_mt_on_hand"]) for _, r in lots.iterrows()}
    lots_meta = {
        text(r["lot_no"]): {
            "lotId": text(r.get("lot_id")), "lotNo": text(r.get("lot_no")), "grade": text(r.get("grade")),
            "standardCode": text(r.get("standard_code")), "colorFamily": text(r.get("color_family")),
            "sourceSheet": text(r.get("source_sheet")),
            "qtyBeforeMt": round(float(r.get("qty_mt_on_hand", 0.0)), 3),
        }
        for _, r in lots.iterrows()
    }

    merged = invoice_index()
    if "color_family" not in merged.columns:
        merged["color_family"] = ""
    lines = merged[
        (merged["color_family"].apply(lambda v: text(v).upper()) == color_family)
        & (merged.get("fulfillment_status", "open") == "open")
        & (merged.get("outstanding_qty_mt", merged["qty_mt"]).fillna(0) > 0)
    ].copy()
    if app_filters:
        lines["_ak"] = lines["application"].apply(app_key)
        lines = lines[lines["_ak"].isin(app_filters)]

    tests_mask = tests["lot_no"].isin(lot_nos)
    if inventory_scope == "standard" and "standard_code" in tests.columns:
        tests_mask &= tests["standard_code"].apply(lambda v: text(v).upper()) == selected_standard_key
    elif "color_family" in tests.columns:
        tests_mask &= tests["color_family"].apply(lambda v: text(v).upper()) == color_family
    tests_sc = tests[tests_mask].copy()
    available_tests_by_lot: Dict[str, List[str]] = {}
    if not tests_sc.empty:
        for lot_no, scoped in tests_sc.groupby("lot_no", dropna=False):
            available_tests_by_lot[text(lot_no)] = ordered_methods(
                sorted({text(v) for v in scoped["method_id"].tolist() if text(v)})
            )
    available_methods_for_standard = ordered_methods(
        sorted({text(v) for v in tests_sc["method_id"].tolist() if text(v)})
    )
    profile_lookup: Dict[str, Dict[str, float | None]] = {}
    current_standard_code = current_standard_code_for_color(color_family) or selected_standard_code
    profile_scope = profiles.copy()
    if current_standard_code:
        profile_scope = profile_scope[profile_scope["standard_code"] == current_standard_code].copy()
    elif "color_family" in profile_scope.columns:
        profile_scope = profile_scope[profile_scope["color_family"].apply(lambda v: text(v).upper()) == color_family].copy()
    for _, p in profile_scope.iterrows():
        profile_lookup[text(p.get("method_id"))] = {
            "L": num(p.get("reference_l")),
            "a": num(p.get("reference_a")),
            "b": num(p.get("reference_b")),
        }

    line_rows: List[Dict[str, Any]] = []
    lot_candidates_by_line: Dict[str, List[Dict[str, Any]]] = {}

    for _, lr in lines.iterrows():
        line = lr.to_dict()
        line_id = text(line.get("invoice_line_id"))
        original_qty = float(line.get("qty_mt", 0.0) or 0.0)
        outstanding_raw = line.get("outstanding_qty_mt")
        if outstanding_raw is None or (isinstance(outstanding_raw, float) and pd.isna(outstanding_raw)):
            outstanding_raw = original_qty
        qty = float(outstanding_raw or 0.0)
        last_partial_at = text(line.get("last_partial_at"))
        is_partially_fulfilled = bool(last_partial_at) and qty + 1e-9 < original_qty
        method_order, method_source, required_methods, has_explicit_test = method_selection_order(
            line, available_methods_for_standard
        )
        if not method_order:
            method_order = [BASE_TEST_METHOD]
        required_method_set = set(required_methods)

        def build_method_pack(candidate_method_id: str) -> Dict[str, Any]:
            t = tests_sc[tests_sc["method_id"] == candidate_method_id].copy()
            reference = profile_lookup.get(candidate_method_id, {"L": None, "a": None, "b": None})
            target, target_source = target_delta_vector(line, reference)
            target_abs = None
            tl, ta, tb = num(line.get("target_l")), num(line.get("target_a")), num(line.get("target_b"))
            if None not in (tl, ta, tb):
                target_abs = np.array([tl, ta, tb], dtype=float)

            cand_by_lot: Dict[str, Dict[str, Any]] = {}
            for _, tr in t.iterrows():
                trd = tr.to_dict()
                lot_no = text(trd.get("lot_no"))
                fde = fit_delta_e(trd, line)
                lot_vec = lot_delta_vector(trd, reference)
                available_tests = available_tests_by_lot.get(lot_no, [])
                is_super_lot = len(available_tests) > SUPER_LOT_TEST_THRESHOLD
                cand_by_lot[lot_no] = {
                    "lotId": text(trd.get("lot_id")) or lots_meta.get(lot_no, {}).get("lotId", ""),
                    "lotNo": lot_no,
                    "grade": text(trd.get("grade")) or lots_meta.get(lot_no, {}).get("grade", ""),
                    "methodId": text(trd.get("method_id")),
                    "matchMethodId": candidate_method_id,
                    "matchedTestMethodId": candidate_method_id,
                    "availableTests": available_tests,
                    "availableTestCount": len(available_tests),
                    "isSuperLot": is_super_lot,
                    "superLot": is_super_lot,
                    "superLotPolicy": "not_super_lot",
                    "superLotReason": "",
                    "sourceStatus": text(trd.get("source_status")),
                    "sourceSheet": lots_meta.get(lot_no, {}).get("sourceSheet", ""),
                    "deltaL": round(float(trd["delta_l"]), 6) if pd.notna(trd.get("delta_l")) else None,
                    "deltaA": round(float(trd["delta_a"]), 6) if pd.notna(trd.get("delta_a")) else None,
                    "deltaB": round(float(trd["delta_b"]), 6) if pd.notna(trd.get("delta_b")) else None,
                    "deltaEFromTest": round(float(trd["delta_e"]), 4) if pd.notna(trd.get("delta_e")) else None,
                    "fitDeToTarget": round(float(fde), 4) if fde is not None and not np.isnan(fde) else None,
                    "fitBand": None,
                    "meetsTolerance": False,
                    "isEligibleForTolerance": False,
                    "availableQtyMt": round(float(lots_meta.get(lot_no, {}).get("qtyBeforeMt", 0.0)), 3),
                    "liveAvailableQtyMt": round(float(lots_meta.get(lot_no, {}).get("qtyBeforeMt", 0.0)), 3),
                    "strength": round(float(trd["strength"]), 4) if pd.notna(trd.get("strength")) else None,
                    "_deltaVector": lot_vec,
                    "_absoluteVector": (
                        np.array(
                            [
                                num(trd.get("absolute_l")),
                                num(trd.get("absolute_a")),
                                num(trd.get("absolute_b")),
                            ],
                            dtype=float,
                        )
                        if None
                        not in (
                            num(trd.get("absolute_l")),
                            num(trd.get("absolute_a")),
                            num(trd.get("absolute_b")),
                        )
                        else None
                    ),
                }

            method_cands: List[Dict[str, Any]] = model_score_and_rank(list(cand_by_lot.values()), target, target_abs)

            for cand in method_cands:
                tolerance_metric = cand["euclideanDeltaE"] if cand["euclideanDeltaE"] is not None else cand["fitDeToTarget"]
                cand["meetsTolerance"] = in_tolerance(tolerance_metric, tolerance_mode)
                cand["isEligibleForTolerance"] = cand["meetsTolerance"]
                cand["fitBand"] = fit_band(tolerance_metric)
                cand["perceptual"] = delta_e_label(tolerance_metric)

            non_super_eligible_qty = sum(
                c["availableQtyMt"] for c in method_cands if c["meetsTolerance"] and not c["isSuperLot"]
            )
            for cand in method_cands:
                if cand["isSuperLot"] and not cand["meetsTolerance"]:
                    cand["superLotPolicy"] = "super_lot_out_of_tolerance"
                if not cand["isSuperLot"] or not cand["meetsTolerance"]:
                    continue
                invoice_mentions_all_tests = bool(required_method_set) and set(cand["availableTests"]).issubset(required_method_set)
                no_other_lot_can_fulfill = non_super_eligible_qty + 1e-9 < qty
                cand["superLotAllowedByInvoiceTests"] = invoice_mentions_all_tests
                cand["superLotAllowedByAvailability"] = no_other_lot_can_fulfill
                if invoice_mentions_all_tests:
                    cand["superLotPolicy"] = "allowed_invoice_mentions_all_tests"
                elif no_other_lot_can_fulfill:
                    cand["superLotPolicy"] = "allowed_no_other_lot_can_fulfill"
                else:
                    cand["isEligibleForTolerance"] = False
                    cand["superLotPolicy"] = "reserved_non_super_lot_can_fulfill"
                    cand["superLotReason"] = "Super lot reserved because non-super eligible stock can fulfill this requirement."

            method_elig = [c for c in method_cands if c["isEligibleForTolerance"]]
            method_best = min(
                (
                    c["euclideanDeltaE"] if c["euclideanDeltaE"] is not None else c["fitDeToTarget"]
                    for c in method_elig
                    if c["euclideanDeltaE"] is not None or c["fitDeToTarget"] is not None
                ),
                default=None,
            )
            return {
                "methodId": candidate_method_id,
                "cands": method_cands,
                "eligible": method_elig,
                "eligibleQty": sum(c["availableQtyMt"] for c in method_elig),
                "nonSuperEligibleQty": non_super_eligible_qty,
                "bestFit": method_best,
                "referenceLab": reference,
                "targetVec": target,
                "targetVecSource": target_source,
                "targetAbsVec": target_abs,
            }

        method_packs = [build_method_pack(mid) for mid in method_order]
        if has_explicit_test:
            selected_pack = (
                next((p for p in method_packs if p["eligibleQty"] + 1e-9 >= qty), None)
                or next((p for p in method_packs if p["cands"]), None)
                or method_packs[0]
            )
        else:
            selected_pack = (
                next((p for p in method_packs if p["nonSuperEligibleQty"] + 1e-9 >= qty), None)
                or next((p for p in method_packs if p["eligibleQty"] + 1e-9 >= qty), None)
                or next((p for p in method_packs if p["cands"]), None)
                or method_packs[0]
            )
            method_source = "base_test_method" if selected_pack["methodId"] == BASE_TEST_METHOD else "availability_method_fallback"

        method_id = selected_pack["methodId"]
        reference_lab = selected_pack["referenceLab"]
        target_vec = selected_pack["targetVec"]
        target_vec_source = selected_pack["targetVecSource"]
        cands = selected_pack["cands"]
        elig = selected_pack["eligible"]
        elig_qty = selected_pack["eligibleQty"]
        best_fit = selected_pack["bestFit"]

        if target_vec is None:
            s_stat, s_reason = "unsupported_missing_invoice_delta", "Requirement line is missing dL / da / dB target values."
        elif not cands:
            checked = ", ".join(method_order)
            s_stat, s_reason = "unsupported_no_method_results", f"No lot test results for checked method(s): {checked}."
        elif not elig:
            s_stat, s_reason = "unsupported_out_of_tolerance", f"Candidates exist but none fit '{tolerance_mode}' mode."
        else:
            s_stat, s_reason = "supported", None

        line_rows.append(
            {
                "invoiceLineId": line_id,
                "invoiceId": text(line.get("invoice_id")),
                "invoiceNumber": text(line.get("invoice_number")),
                "invoiceDate": text(line.get("invoice_date")),
                "customerName": text(line.get("customer_name")),
                "productDescription": text(line.get("product_description")),
                "application": text(line.get("application")),
                "grade": text(line.get("grade")),
                "standardCode": text(line.get("standard_code")),
                "colorFamily": text(line.get("color_family")).upper(),
                "qtyMt": round(qty, 3),
                "originalQtyMt": round(original_qty, 3),
                "outstandingQtyMt": round(qty, 3),
                "isPartiallyFulfilled": is_partially_fulfilled,
                "lastPartialAt": last_partial_at,
                "targetMethodId": text(line.get("target_method_id")),
                "requiredTestMethods": required_methods,
                "hasExplicitTestRequirement": has_explicit_test,
                "methodSelectionOrder": method_order,
                "resolvedMethodId": method_id,
                "resolvedMethodSource": method_source,
                "resolvedTestMethodId": method_id,
                "matchingModels": ["euclidean", "cosine", "knn", "consensus"],
                "targetLab": {"L": num(line.get("target_l")), "a": num(line.get("target_a")), "b": num(line.get("target_b"))},
                "invoiceTargetDelta": {
                    "dL": num(line.get("target_delta_l")),
                    "dA": num(line.get("target_delta_a")),
                    "dB": num(line.get("target_delta_b")),
                },
                "referenceLab": reference_lab,
                "targetDelta": {
                    "dL": round(float(target_vec[0]), 6) if target_vec is not None else None,
                    "dA": round(float(target_vec[1]), 6) if target_vec is not None else None,
                    "dB": round(float(target_vec[2]), 6) if target_vec is not None else None,
                    "source": target_vec_source,
                },
                "inventoryMatchStatus": text(line.get("inventory_match_status")),
                "candidateLotCount": len(cands),
                "eligibleCandidateLotCount": len(elig),
                "estimatedEligibleQtyMt": round(float(elig_qty), 3),
                "estimatedCoverageRatio": round((elig_qty / qty), 3) if qty > 0 else 0.0,
                "bestFitDe": round(float(best_fit), 4) if best_fit is not None else None,
                "supportStatus": s_stat,
                "supportReason": s_reason,
                "isSupported": s_stat == "supported",
            }
        )
        for cand in cands:
            if "_deltaVector" in cand:
                del cand["_deltaVector"]
            if "_absoluteVector" in cand:
                del cand["_absoluteVector"]
        lot_candidates_by_line[line_id] = cands

    supported = [r for r in line_rows if r["isSupported"]]
    unsupported = [r for r in line_rows if not r["isSupported"]]
    supported.sort(key=lambda r: (
        0 if r.get("isPartiallyFulfilled") else 1,
        -r["estimatedCoverageRatio"],
        r["bestFitDe"] if r["bestFitDe"] is not None else float("inf"),
        r["qtyMt"],
        r["invoiceLineId"],
    ))
    for i, r in enumerate(supported, start=1):
        r["fulfillabilityRank"] = i
    for r in unsupported:
        r["fulfillabilityRank"] = None

    alloc_rows: List[Dict[str, Any]] = []
    for line in supported + unsupported:
        need = float(line["qtyMt"])
        left = need
        current_candidates = lot_candidates_by_line.get(line["invoiceLineId"], [])
        for cand in current_candidates:
            cand["liveAvailableQtyMt"] = round(float(remaining.get(cand["lotNo"], 0.0)), 3)
        line["liveEligibleQtyMt"] = round(
            float(
                sum(
                    cand["liveAvailableQtyMt"]
                    for cand in current_candidates
                    if cand.get("isEligibleForTolerance")
                )
            ),
            3,
        )
        alloc = {
            "invoiceLineId": line["invoiceLineId"],
            "invoiceId": line["invoiceId"],
            "invoiceNumber": line["invoiceNumber"],
            "customerName": line["customerName"],
            "application": line["application"],
            "resolvedMethodId": line["resolvedMethodId"],
            "lotSelectionPolicy": "perceptual_then_consensus_then_remaining_qty",
            "qtyRequestedMt": round(need, 3),
            "qtyAllocatedMt": 0.0,
            "shortfallMt": round(need, 3),
            "coverageStatus": "unsupported" if not line["isSupported"] else "unfulfilled",
            "allocations": [],
            "isSupported": line["isSupported"],
            "supportStatus": line["supportStatus"],
            "supportReason": line["supportReason"],
            "fulfillabilityRank": line["fulfillabilityRank"],
            "liveEligibleQtyMt": line.get("liveEligibleQtyMt", 0.0),
        }

        if line["isSupported"] and need > 0:
            elig = [c for c in current_candidates if c["isEligibleForTolerance"]]
            _PERCEPT_ORDER = {"imperceptible": 0, "slight": 1, "noticeable": 2, "distinct": 3, "obvious": 4, "unknown": 5}
            elig.sort(
                key=lambda c: (
                    _PERCEPT_ORDER.get((c.get("perceptual") or {}).get("key"), 5),
                    c["consensusRank"] if c["consensusRank"] is not None else float("inf"),
                    -remaining.get(c["lotNo"], 0.0),
                    c["lotNo"],
                )
            )
            for c in elig:
                lot_no = c["lotNo"]
                available = remaining.get(lot_no, 0.0)
                if available <= 0 or left <= 0:
                    continue
                take = min(left, available)
                remaining[lot_no] = round(available - take, 6)
                left -= take
                alloc["allocations"].append(
                    {
                        "lotId": c["lotId"], "lotNo": lot_no, "allocatedQtyMt": round(float(take), 3),
                        "fitDeToTarget": c["fitDeToTarget"], "fitBand": c["fitBand"], "methodId": c["methodId"],
                        "matchMethodId": c.get("matchMethodId") or c["methodId"],
                        "matchedTestMethodId": c.get("matchedTestMethodId") or c["methodId"],
                        "availableTests": c.get("availableTests", []),
                        "availableTestCount": c.get("availableTestCount", 0),
                        "isSuperLot": c.get("isSuperLot", False),
                        "superLotPolicy": c.get("superLotPolicy", ""),
                        "euclideanDeltaE": c["euclideanDeltaE"], "cosineSimilarity": c["cosineSimilarity"],
                        "knnDistance": c["knnDistance"], "consensusRank": c["consensusRank"],
                        "consensusScore": c["consensusScore"], "perceptual": c.get("perceptual"),
                    }
                )
            given = need - left
            alloc["qtyAllocatedMt"] = round(float(given), 3)
            alloc["shortfallMt"] = round(float(max(left, 0.0)), 3)
            alloc["coverageStatus"] = "full" if left <= 0 else ("partial" if given > 0 else "unfulfilled")

        alloc_rows.append(alloc)

    lot_breakdown = []
    for lot_no in sorted(lots_meta):
        before = lots_meta[lot_no]["qtyBeforeMt"]
        after = round(float(remaining.get(lot_no, before)), 3)
        lot_breakdown.append({**lots_meta[lot_no], "qtyAllocatedMt": round(before - after, 3), "qtyRemainingMt": after})

    total_before = round(float(sum(v["qtyBeforeMt"] for v in lots_meta.values())), 3)
    total_after = round(float(sum(remaining.values())), 3)
    total_allocated = round(total_before - total_after, 3)
    full = sum(1 for r in alloc_rows if r["coverageStatus"] == "full")
    partial = sum(1 for r in alloc_rows if r["coverageStatus"] == "partial")
    unfulfilled = sum(1 for r in alloc_rows if r["coverageStatus"] == "unfulfilled")
    unsupported_count = sum(1 for r in alloc_rows if r["coverageStatus"] == "unsupported")
    demand = round(sum(r["qtyRequestedMt"] for r in alloc_rows if r["isSupported"]), 3)
    shortfall = round(sum(r["shortfallMt"] for r in alloc_rows if r["isSupported"]), 3)

    all_lines = invoice_index()
    if "color_family" not in all_lines.columns:
        all_lines["color_family"] = ""
    unsupported_global = all_lines[
        ~all_lines["color_family"].apply(lambda v: text(v).upper()).isin(supported_colors())
    ].copy()
    unsupported_rows = [
        {
            "invoiceLineId": text(r.get("invoice_line_id")),
            "invoiceId": text(r.get("invoice_id")),
            "invoiceNumber": text(r.get("invoice_number")),
            "customerName": text(r.get("customer_name")),
            "grade": text(r.get("grade")),
            "standardCode": text(r.get("standard_code")),
            "colorFamily": text(r.get("color_family")).upper(),
            "application": text(r.get("application")),
            "qtyMt": round(float(r.get("qty_mt", 0.0) or 0.0), 3),
            "inventoryMatchStatus": text(r.get("inventory_match_status")),
        }
        for _, r in unsupported_global.iterrows()
    ]

    profile_methods = sorted({text(v) for v in tests_sc["method_id"].tolist() if text(v)})
    standard_grades = sorted({text(v) for v in lots["grade"].tolist() if text(v)})
    standard_grade = standard_grades[0] if len(standard_grades) == 1 else ("Multiple" if standard_grades else "")
    color_family = text(lots.iloc[0].get("color_family")).upper()
    inventory_standard_codes = sorted({text(v) for v in lots["standard_code"].tolist() if text(v)})
    source_sheets = sorted({text(v) for v in lots.get("source_sheet", pd.Series([], dtype=str)).tolist() if text(v)})
    display_standard = selected_standard_code or current_standard_code or (
        inventory_standard_codes[0] if len(inventory_standard_codes) == 1 else color_family
    )
    preview = choose_preview_profile(profiles, display_standard, standard_grades[0] if standard_grades else standard_grade)
    preview_hex = preview["hex"] or COLOR_FAMILY_FALLBACK.get(color_family.upper(), "#888888")

    return {
        "standard": {
            "standardCode": display_standard,
            "analysisMode": "standard_color",
            "analysisKey": color_family,
            "currentStandardCode": current_standard_code,
            "inventoryStandardCodes": inventory_standard_codes,
            "inventoryScope": inventory_scope,
            "sourceSheets": source_sheets,
            "grade": standard_grade,
            "toleranceMode": tolerance_mode,
            "lotCount": int(lots["lot_no"].nunique()),
            "inventoryQtyMt": total_before,
            "methodRules": APPLICATION_METHOD_RULES,
            "applicationsFilter": app_filters,
            "profileMethods": profile_methods,
            "colorFamily": color_family,
            "previewMethodId": preview["methodId"],
            "previewLab": {
                "L": round(float(preview["L"]), 3) if preview["L"] is not None else None,
                "a": round(float(preview["a"]), 3) if preview["a"] is not None else None,
                "b": round(float(preview["b"]), 3) if preview["b"] is not None else None,
            },
            "previewHex": preview_hex,
        },
        "inventorySummary": {"totalBeforeMt": total_before, "totalAllocatedMt": total_allocated, "totalAfterMt": total_after, "lotBreakdown": lot_breakdown},
        "lotsAvailable": [
            {
                "lotId": text(r.get("lot_id")), "lotNo": text(r.get("lot_no")), "grade": text(r.get("grade")),
                "standardCode": text(r.get("standard_code")), "colorFamily": text(r.get("color_family")),
                "sourceSheet": text(r.get("source_sheet")),
                "qtyMtOnHand": round(float(r.get("qty_mt_on_hand", 0.0)), 3),
            }
            for _, r in lots.sort_values("lot_no").iterrows()
        ],
        "supported": supported,
        "unsupported": unsupported,
        "perceptualLabels": PERCEPTUAL_LABELS,
        "eligibleInvoiceLines": supported + unsupported,
        "lotCandidatesByInvoiceLine": lot_candidates_by_line,
        "allocation": alloc_rows,
        "inventoryAnalysis": {
            "fullCoverageCount": full, "partialCoverageCount": partial, "unfulfilledCount": unfulfilled,
            "unsupportedCount": unsupported_count, "supportedDemandMt": demand, "supportedShortfallMt": shortfall,
            "leftoverInventoryMt": total_after, "lineCount": len(alloc_rows),
        },
        "unsupportedInvoiceLines": unsupported_rows,
        "generatedAtUtc": now_iso(),
    }


# -- API ROUTES INSERT POINT --
@app.route("/api/login", methods=["POST"])
def login():
    data = request.json or {}
    username = data.get("username", "")
    password = data.get("password", "")
    if username in USER_CREDENTIALS and USER_CREDENTIALS[username]["password"] == password:
        return jsonify(
            {
                "success": True,
                "user": {
                    "username": username,
                    "name": USER_CREDENTIALS[username]["name"],
                    "type": USER_CREDENTIALS[username]["type"],
                },
            }
        )
    return jsonify({"success": False, "message": "Invalid credentials"}), 401


@app.route("/api/logout", methods=["POST"])
def logout():
    return jsonify({"success": True})


@app.route("/api/standards", methods=["GET"])
def get_standards():
    ok, err = dataset_guard()
    if not ok:
        return err
    rows = build_standards_payload()
    return jsonify({"success": True, "data": rows, "count": len(rows), "loadedAtUtc": dataset_state["loaded_at_utc"]})


@app.route("/api/requirements", methods=["GET"])
@app.route("/api/invoices", methods=["GET"])
def get_requirements():
    ok, err = dataset_guard()
    if not ok:
        return err

    lines = invoice_index()
    if "color_family" not in lines.columns:
        lines["color_family"] = ""
    cset = supported_colors()
    lines["is_supported"] = lines["color_family"].apply(lambda v: text(v).upper()).isin(cset)
    open_line_mask = (
        lines["fulfillment_status"].astype(str).str.strip().str.lower().eq("open")
        & pd.to_numeric(lines["outstanding_qty_mt"], errors="coerce").fillna(lines["qty_mt"]).fillna(0).gt(0)
    )

    grp = (
        lines.groupby("invoice_id", as_index=False)
        .agg(
            invoice_number=("invoice_number", "first"),
            invoice_date=("invoice_date", "first"),
            customer_name=("customer_name", "first"),
            total_lines=("invoice_line_id", "count"),
            supported_lines=("is_supported", "sum"),
            total_qty_mt=("qty_mt", "sum"),
        )
        .sort_values(["invoice_date", "invoice_number"], ascending=[False, False])
    )
    requirements = [
        {
            "invoiceId": text(r["invoice_id"]),
            "invoiceNumber": text(r["invoice_number"]),
            "invoiceDate": text(r["invoice_date"]),
            "customerName": text(r["customer_name"]),
            "lineCount": int(r["total_lines"]),
            "supportedLineCount": int(r["supported_lines"]),
            "unsupportedLineCount": int(r["total_lines"] - r["supported_lines"]),
            "totalQtyMt": round(float(r["total_qty_mt"]), 3),
        }
        for _, r in grp.iterrows()
    ]
    unsupported_requirement_lines = [
        {
            "invoiceLineId": text(r.get("invoice_line_id")),
            "invoiceId": text(r.get("invoice_id")),
            "invoiceNumber": text(r.get("invoice_number")),
            "customerName": text(r.get("customer_name")),
            "grade": text(r.get("grade")),
            "standardCode": text(r.get("standard_code")),
            "colorFamily": text(r.get("color_family")).upper(),
            "application": text(r.get("application")),
            "qtyMt": round(float(r.get("qty_mt", 0.0) or 0.0), 3),
            "inventoryMatchStatus": text(r.get("inventory_match_status")),
        }
        for _, r in lines[~lines["is_supported"]].iterrows()
    ]
    summary = {
        "requirementCount": len(requirements),
        "requirementLineCount": int(len(lines)),
        "openRequirementCount": int(lines.loc[open_line_mask, "invoice_id"].nunique()),
        "openRequirementLineCount": int(open_line_mask.sum()),
        "supportedLineCount": int(lines["is_supported"].sum()),
        "unsupportedLineCount": int((~lines["is_supported"]).sum()),
        # Legacy aliases kept for compatibility.
        "invoiceCount": len(requirements),
        "invoiceLineCount": int(len(lines)),
        "openInvoiceCount": int(lines.loc[open_line_mask, "invoice_id"].nunique()),
        "openInvoiceLineCount": int(open_line_mask.sum()),
    }
    return jsonify(
        {
            "success": True,
            "requirements": requirements,
            "invoices": requirements,
            "count": len(requirements),
            "summary": summary,
            "unsupportedRequirementLines": unsupported_requirement_lines,
            "unsupportedInvoiceLines": unsupported_requirement_lines,
        }
    )


@app.route("/api/analyze/standard", methods=["POST"])
def analyze_standard():
    ok, err = dataset_guard()
    if not ok:
        return err

    data = request.get_json(silent=True) or {}
    standard_code = text(data.get("standardCode")) or text(data.get("colorFamily"))
    if not standard_code:
        return jsonify({"success": False, "message": "standardCode is required"}), 400

    tolerance_mode = text(data.get("toleranceMode")).lower() or DEFAULT_TOLERANCE
    if tolerance_mode not in TOLERANCES:
        return jsonify({"success": False, "message": "Invalid toleranceMode. Use strict, relaxed, or review."}), 400

    apps = data.get("applications") or []
    if not isinstance(apps, list):
        return jsonify({"success": False, "message": "applications must be an array"}), 400
    app_filters = sorted({app_key(v) for v in apps if text(v)})

    try:
        result = analyze_standard_core(standard_code, tolerance_mode, app_filters)
    except ValueError as exc:
        return jsonify({"success": False, "message": str(exc)}), 404
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": "Analysis failed", "error": str(exc)}), 500

    return jsonify({"success": True, **result})


def append_audit_rows(rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return
    df = pd.DataFrame(rows, columns=COMMIT_AUDIT_COLS)
    write_header = not COMMIT_AUDIT_FILE.exists()
    df.to_csv(COMMIT_AUDIT_FILE, mode="a", header=write_header, index=False)


@app.route("/api/requirements/commit", methods=["POST"])
@app.route("/api/invoices/commit", methods=["POST"])
def commit_allocation():
    ok, err = dataset_guard()
    if not ok:
        return err

    data = request.get_json(silent=True) or {}
    username = text(data.get("username")) or "unknown"
    standard_code = text(data.get("standardCode"))
    commits = data.get("commits") or []
    if not isinstance(commits, list) or not commits:
        return jsonify({"success": False, "message": "commits[] is required"}), 400

    inv = databases["inventory_lots"].copy()
    lines = databases["invoice_lines"].copy()

    inv_qty = {text(r["lot_no"]): float(r["qty_mt_on_hand"]) for _, r in inv.iterrows()}
    line_idx = {text(r["invoice_line_id"]): i for i, r in lines.iterrows()}

    # Pre-validate.
    for c in commits:
        line_id = text(c.get("invoiceLineId"))
        if line_id not in line_idx:
            return jsonify({"success": False, "message": f"Unknown requirement line {line_id}"}), 400
        for a in c.get("allocations") or []:
            lot_no = text(a.get("lotNo"))
            take = float(a.get("allocatedQtyMt") or 0.0)
            if lot_no not in inv_qty:
                return jsonify({"success": False, "message": f"Unknown lot {lot_no}"}), 400
            if take <= 0:
                continue
            if take > inv_qty[lot_no] + 1e-6:
                return jsonify({"success": False,
                                "message": f"Lot {lot_no} only has {inv_qty[lot_no]:.3f} MT remaining"}), 409

    commit_id = f"CMT-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{username}"
    committed_at = now_iso()
    audit_rows: List[Dict[str, Any]] = []

    for c in commits:
        line_id = text(c.get("invoiceLineId"))
        idx = line_idx[line_id]
        line_row = lines.loc[idx]
        original = float(line_row.get("qty_mt", 0.0) or 0.0)
        outstanding = line_row.get("outstanding_qty_mt")
        outstanding = float(outstanding) if pd.notna(outstanding) else original

        total_taken = 0.0
        for a in c.get("allocations") or []:
            lot_no = text(a.get("lotNo"))
            take = float(a.get("allocatedQtyMt") or 0.0)
            if take <= 0:
                continue
            inv_qty[lot_no] = round(inv_qty[lot_no] - take, 6)
            total_taken += take
            audit_rows.append({
                "commit_id": commit_id,
                "committed_at_utc": committed_at,
                "username": username,
                "standard_code": standard_code,
                "invoice_line_id": line_id,
                "invoice_number": text(line_row.get("invoice_number")),
                "customer_name": text(line_row.get("customer_name")),
                "lot_no": lot_no,
                "allocated_qty_mt": round(take, 3),
                "method_id": text(a.get("methodId")),
                "consensus_rank": a.get("consensusRank"),
                "delta_e": a.get("euclideanDeltaE"),
                "resulting_status": "",
            })

        new_outstanding = round(max(0.0, outstanding - total_taken), 3)
        if new_outstanding <= 1e-6:
            new_status = "fulfilled"
        elif total_taken > 0:
            new_status = "open"  # still open, but partially fulfilled
        else:
            new_status = text(line_row.get("fulfillment_status")) or "open"

        lines.at[idx, "outstanding_qty_mt"] = new_outstanding
        lines.at[idx, "fulfillment_status"] = new_status
        if total_taken > 0 and new_outstanding > 0:
            lines.at[idx, "last_partial_at"] = committed_at

        for row in audit_rows:
            if row["invoice_line_id"] == line_id and not row["resulting_status"]:
                row["resulting_status"] = new_status

    for lot_no, qty in inv_qty.items():
        mask = inv["lot_no"] == lot_no
        inv.loc[mask, "qty_mt_on_hand"] = qty

    inv = prepare_df("inventory_lots", inv)
    lines = prepare_df("invoice_lines", lines)
    _atomic_write_csv(inv, DATASET_FILES["inventory_lots"])
    _atomic_write_csv(lines, DATASET_FILES["invoice_lines"])
    append_audit_rows(audit_rows)

    load_default_datasets()

    return jsonify({
        "success": True,
        "commitId": commit_id,
        "committedAtUtc": committed_at,
        "linesAffected": len(commits),
        "requirementLinesAffected": len(commits),
        "lotMovements": len(audit_rows),
    })


@app.route("/api/demo/reset", methods=["POST"])
def reset_demo():
    """Force-reset demo state.

    invoice_lines: normalize every row directly so all invoices appear OPEN
      with their original requested qty as outstanding. This guarantees the
      reset wipes any 'fulfilled'/'partial' tags regardless of baseline state.
    inventory_lots: restore from baseline file if available. We also write the
      restored content back as the new baseline so subsequent resets remain
      consistent.
    commit_audit: deleted.
    """
    restored = []
    notes = []

    # --- invoice_lines: normalize in place ---
    inv_lines_path = DATASET_FILES["invoice_lines"]
    try:
        if inv_lines_path.exists():
            df = pd.read_csv(inv_lines_path)
            if "qty_mt" in df.columns:
                df["outstanding_qty_mt"] = df["qty_mt"]
            df["fulfillment_status"] = "open"
            df["last_partial_at"] = ""
            df = prepare_df("invoice_lines", df)
            _atomic_write_csv(df, inv_lines_path)
            # Refresh baseline so it matches the clean state going forward.
            try:
                baseline_path_for("invoice_lines").write_bytes(inv_lines_path.read_bytes())
            except Exception:  # pylint: disable=broad-except
                pass
            restored.append("invoice_lines")
        else:
            notes.append("invoice_lines file missing")
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"Failed to normalize invoice_lines: {exc}"}), 500

    # --- inventory_lots: restore from the client-maintained inventory workbook when available ---
    inv_lots_path = DATASET_FILES["inventory_lots"]
    inv_bl = baseline_path_for("inventory_lots")
    seed_restored = False
    if MAIN_INVENTORY_FILE.exists():
        try:
            profiles = databases.get("standard_profiles")
            sync_info = sync_inventory_workbook_if_changed(profiles, force=True)
            restored.append("inventory_lots")
            restored.append("lot_test_results")
            notes.append(
                f"inventory_lots and lot_test_results restored from {MAIN_INVENTORY_FILE.name} "
                f"({sync_info.get('inventoryRows', 0)} lots, {sync_info.get('lotTestRows', 0)} tests)"
            )
            seed_restored = True
        except Exception as exc:  # pylint: disable=broad-except
            notes.append(f"Inventory workbook restore unavailable ({exc}); attempting seed/baseline restore")

    if not seed_restored and SEED_DATASET_FILE.exists():
        try:
            seed_inventory = load_seed_inventory_lots()
            _atomic_write_csv(seed_inventory, inv_lots_path)
            _atomic_write_csv(seed_inventory, inv_bl)
            restored.append("inventory_lots")
            notes.append("inventory_lots restored from stitched_dataset.xlsx seed")
            seed_restored = True
        except Exception as exc:  # pylint: disable=broad-except
            notes.append(f"Seed restore unavailable ({exc}); attempting baseline restore")

    # Fallback for environments without seed workbook.
    if not seed_restored and inv_bl.exists():
        try:
            baseline_inventory = prepare_df("inventory_lots", pd.read_csv(inv_bl))
            _atomic_write_csv(baseline_inventory, inv_lots_path)
            restored.append("inventory_lots")
            notes.append("inventory_lots restored from baseline")
        except Exception as exc:  # pylint: disable=broad-except
            return jsonify({"success": False, "message": f"Failed to restore inventory_lots: {exc}"}), 500
    elif not seed_restored:
        # No seed and no baseline yet - capture current so future resets have a fallback.
        try:
            if inv_lots_path.exists():
                current_inventory = prepare_df("inventory_lots", pd.read_csv(inv_lots_path))
                _atomic_write_csv(current_inventory, inv_bl)
                notes.append("inventory_lots baseline captured from current state")
        except Exception:  # pylint: disable=broad-except
            pass

    if COMMIT_AUDIT_FILE.exists():
        try:
            COMMIT_AUDIT_FILE.unlink()
        except Exception:  # pylint: disable=broad-except
            pass

    load_default_datasets()
    return jsonify({
        "success": True,
        "restored": restored,
        "notes": notes,
        "resetAtUtc": now_iso(),
    })


@app.route("/api/notifications", methods=["GET"])
def notifications():
    ok, err = dataset_guard()
    if not ok:
        return err
    merged = invoice_index()
    partial = merged[
        (merged["fulfillment_status"] == "open")
        & (merged["last_partial_at"].fillna("") != "")
        & (merged["outstanding_qty_mt"].fillna(0) > 0)
        & (merged["outstanding_qty_mt"].fillna(0) + 1e-9 < merged["qty_mt"].fillna(0))
    ].copy()
    items = [
        {
            "invoiceLineId": text(r.get("invoice_line_id")),
            "invoiceNumber": text(r.get("invoice_number")),
            "customerName": text(r.get("customer_name")),
            "standardCode": text(r.get("standard_code")),
            "grade": text(r.get("grade")),
            "originalQtyMt": round(float(r.get("qty_mt") or 0.0), 3),
            "outstandingQtyMt": round(float(r.get("outstanding_qty_mt") or 0.0), 3),
            "lastPartialAt": text(r.get("last_partial_at")),
        }
        for _, r in partial.iterrows()
    ]
    items.sort(key=lambda x: x["lastPartialAt"], reverse=True)
    return jsonify({"success": True, "count": len(items), "items": items})


# ============================================================
# ADMIN DATA-UPDATE ENDPOINTS
# ============================================================

ADMIN_EDITABLE_DATASETS = {
    "inventory_lots": {
        "label": "Inventory lots",
        "description": "Master list of every physical lot on hand (lot number, grade, standard, MT remaining).",
        "columns": [
            {"key": "lot_id", "label": "Lot ID", "hint": "Unique internal id for this lot. Example: LOT-0001."},
            {"key": "lot_no", "label": "Lot No", "hint": "Human-readable lot number on the drum/bag. Example: R-2405-17."},
            {"key": "grade", "label": "Grade", "hint": "Pigment grade. Example: 1 / 2 / 3."},
            {"key": "standard_code", "label": "Standard code", "hint": "The standard this lot matches. Example: STD-RED-001."},
            {"key": "qty_mt_on_hand", "label": "Qty on hand (MT)", "hint": "Metric tons physically available. Numbers only. Example: 12.5."},
            {"key": "color_family", "label": "Color family", "hint": "One of RED, YELLOW, ORANGE, BLACK."},
        ],
    },
    "standard_profiles": {
        "label": "Standard profiles",
        "description": "Base production LAB reference for each standard code. The current engine also stores a method tag to line this baseline up with lot test rows.",
        "columns": [
            {"key": "standard_code", "label": "Standard code", "hint": "Unique code. Example: STD-RED-001."},
            {"key": "grade", "label": "Grade", "hint": "Grade number for the standard."},
            {"key": "method_id", "label": "Method tag", "hint": "Current engine mapping tag for this baseline. Use the QC method id lot test rows will reference: method_i_a, method_i_b, or method_ii."},
            {"key": "reference_l", "label": "Reference L*", "hint": "Base production L* before any method-specific QC delta is applied."},
            {"key": "reference_a", "label": "Reference a*", "hint": "Base production a* before any method-specific QC delta is applied."},
            {"key": "reference_b", "label": "Reference b*", "hint": "Base production b* before any method-specific QC delta is applied."},
        ],
    },
    "lot_test_results": {
        "label": "Lot test results",
        "description": "Method-specific QC deltas linking a lot to a standard.",
        "columns": [
            {"key": "lot_no", "label": "Lot No", "hint": "Must match a lot number in Inventory lots."},
            {"key": "standard_code", "label": "Standard code", "hint": "Standard this QC was run against."},
            {"key": "method_id", "label": "Test method", "hint": "QC method that produced these dL / da / db values: method_i_a, method_i_b, or method_ii."},
            {"key": "delta_l", "label": "dL", "hint": "Change in L (lightness) after the test. Numbers only; may be negative."},
            {"key": "delta_a", "label": "da", "hint": "Change in a (red-green axis) after the test. Numbers only; may be negative."},
            {"key": "delta_b", "label": "db", "hint": "Change in b (yellow-blue axis) after the test. Numbers only; may be negative."},
            {"key": "source_status", "label": "Source status", "hint": "e.g. production, retest, archived."},
        ],
    },
}


def is_admin_request() -> bool:
    """Accept admin identity from JSON, form field, or header. Lightweight but consistent with /api/login."""
    candidate = ""
    if request.is_json:
        body = request.get_json(silent=True) or {}
        candidate = text(body.get("username"))
    if not candidate:
        candidate = text(request.headers.get("X-Username")) or text(request.form.get("username")) or text(request.args.get("username"))
    return candidate in USER_CREDENTIALS and USER_CREDENTIALS[candidate]["type"] == "admin"


def _admin_guard():
    if not is_admin_request():
        return jsonify({"success": False, "message": "Administrator privileges required."}), 403
    return None


def _atomic_write_csv(df: pd.DataFrame, target: Path) -> None:
    tmp = target.with_suffix(target.suffix + ".tmp")
    df.to_csv(tmp, index=False)
    tmp.replace(target)


def _validate_df(name: str, df: pd.DataFrame) -> Dict[str, Any]:
    required = REQUIRED_COLS.get(name, [])
    missing = [c for c in required if c not in df.columns]
    errors: List[str] = []
    if missing:
        errors.append(f"Missing required columns: {', '.join(missing)}")
    if name == "inventory_lots" and not missing:
        qty = pd.to_numeric(df["qty_mt_on_hand"], errors="coerce")
        bad = df.index[qty.isna()].tolist()
        for i in bad[:10]:
            errors.append(f"Row {i + 2}: qty_mt_on_hand is not a number.")
    if name == "standard_profiles" and not missing:
        for col in ("reference_l", "reference_a", "reference_b"):
            nums = pd.to_numeric(df[col], errors="coerce")
            bad = df.index[nums.isna()].tolist()
            for i in bad[:5]:
                errors.append(f"Row {i + 2}: {col} is not a number.")
    if name == "lot_test_results" and not missing:
        for col in ("delta_l", "delta_a", "delta_b"):
            nums = pd.to_numeric(df[col], errors="coerce")
            bad = df.index[nums.isna()].tolist()
            for i in bad[:5]:
                errors.append(f"Row {i + 2}: {col} is not a number.")
    canonicalization = {
        "keyColumns": DATASET_UNIQUE_KEYS.get(name, []),
        "strategy": None,
        "inputRows": int(len(df)),
        "outputRows": int(len(df)),
        "deduplicatedRows": 0,
    }
    warnings: List[str] = []
    if not missing:
        _, canonicalization = canonicalize_dataset_df(name, df)
        if canonicalization["deduplicatedRows"] > 0:
            key_label = ", ".join(canonicalization["keyColumns"])
            warnings.append(
                f"{canonicalization['deduplicatedRows']} duplicate row(s) found for key [{key_label}]. "
                "The newest row for each key will be kept when applied."
            )
    preview = df.head(8).fillna("").astype(str).to_dict(orient="records")
    return {
        "ok": len(errors) == 0,
        "rowCount": int(len(df)),
        "columns": list(df.columns),
        "missingCols": missing,
        "errors": errors,
        "warnings": warnings,
        "canonicalization": canonicalization,
        "preview": preview,
    }


def _parse_upload_to_df(file_storage) -> pd.DataFrame:
    filename = (file_storage.filename or "").lower()
    raw = file_storage.read()
    buf = io.BytesIO(raw)
    if filename.endswith(".xlsx") or filename.endswith(".xls"):
        return pd.read_excel(buf)
    # default: CSV
    buf.seek(0)
    return pd.read_csv(buf)


@app.route("/api/admin/current-standards", methods=["GET"])
def admin_current_standards():
    guard = _admin_guard()
    if guard:
        return guard
    ok, err = dataset_guard()
    if not ok:
        return err
    return jsonify({
        "success": True,
        "standards": current_standards_from_profiles(databases.get("standard_profiles"), databases.get("inventory_lots")),
        "sourceState": source_data_state,
    })


@app.route("/api/admin/current-standards", methods=["POST"])
def admin_current_standards_save():
    guard = _admin_guard()
    if guard:
        return guard
    body = request.get_json(silent=True) or {}
    standards = body.get("standards") or []
    if not isinstance(standards, list) or not standards:
        return jsonify({"success": False, "message": "standards must be a non-empty list"}), 400

    rows: List[Dict[str, Any]] = []
    errors: List[str] = []
    for idx, item in enumerate(standards, start=1):
        color_family = text(item.get("colorFamily")).upper()
        standard_code = text(item.get("standardCode"))
        grade = text(item.get("grade")) or "ALL"
        item_errors: List[str] = []
        if color_family not in COLOR_FAMILY_FALLBACK:
            item_errors.append(f"Row {idx}: colorFamily must be one of {', '.join(COLOR_FAMILY_FALLBACK.keys())}.")
        if not standard_code:
            item_errors.append(f"Row {idx}: standardCode is required.")
        if item_errors:
            errors.extend(item_errors)
            continue
        methods = item.get("methods") if isinstance(item.get("methods"), list) else CURRENT_STANDARD_METHODS
        method_ids = [text(m) for m in methods if text(m)] or CURRENT_STANDARD_METHODS
        for method_id in method_ids:
            rows.append({
                "color_family": color_family,
                "standard_code": standard_code,
                "grade": grade,
                "method_id": method_id,
                "reference_l": item.get("referenceL"),
                "reference_a": item.get("referenceA"),
                "reference_b": item.get("referenceB"),
                "production_date": text(item.get("productionDate")),
                "reference_status": "admin_current",
            })
    if errors:
        return jsonify({"success": False, "message": "Validation failed", "errors": errors}), 400

    try:
        profiles, canonicalization = canonicalize_dataset_df("standard_profiles", pd.DataFrame(rows))
        _atomic_write_csv(profiles, DATASET_FILES["standard_profiles"])
        inventory_sync = sync_inventory_workbook_if_changed(profiles, force=True)
        load_default_datasets()
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"Unable to save current standards: {exc}"}), 500

    return jsonify({
        "success": True,
        "rowCount": int(len(profiles)),
        "canonicalization": canonicalization,
        "inventorySync": inventory_sync,
        "standards": current_standards_from_profiles(databases.get("standard_profiles"), databases.get("inventory_lots")),
    })


@app.route("/api/admin/inventory/refresh", methods=["POST"])
def admin_inventory_refresh():
    guard = _admin_guard()
    if guard:
        return guard
    try:
        profiles = databases.get("standard_profiles")
        if profiles is None and DATASET_FILES["standard_profiles"].exists():
            profiles, _ = canonicalize_dataset_df("standard_profiles", pd.read_csv(DATASET_FILES["standard_profiles"]))
        inventory_sync = sync_inventory_workbook_if_changed(profiles, force=True)
        load_default_datasets()
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"Inventory refresh failed: {exc}"}), 500
    return jsonify({
        "success": True,
        "inventorySync": inventory_sync,
        "standards": build_standards_payload() if dataset_state["loaded"] else [],
    })


@app.route("/api/admin/datasets", methods=["GET"])
def admin_dataset_list():
    guard = _admin_guard()
    if guard:
        return guard
    out = []
    for name, meta in ADMIN_EDITABLE_DATASETS.items():
        df = databases.get(name)
        out.append({
            "name": name,
            "label": meta["label"],
            "description": meta["description"],
            "columns": meta["columns"],
            "rowCount": int(len(df)) if df is not None else 0,
        })
    return jsonify({"success": True, "datasets": out})


@app.route("/api/admin/dataset/<name>/template", methods=["GET"])
def admin_dataset_template(name: str):
    guard = _admin_guard()
    if guard:
        return guard
    if name not in ADMIN_EDITABLE_DATASETS:
        return jsonify({"success": False, "message": "Unknown dataset"}), 404
    cols = [c["key"] for c in ADMIN_EDITABLE_DATASETS[name]["columns"]]
    buf = io.BytesIO()
    pd.DataFrame(columns=cols).to_csv(buf, index=False)
    buf.seek(0)
    return send_file(buf, mimetype="text/csv", as_attachment=True, download_name=f"{name}_template.csv")


@app.route("/api/admin/dataset/<name>/validate", methods=["POST"])
def admin_dataset_validate(name: str):
    guard = _admin_guard()
    if guard:
        return guard
    if name not in ADMIN_EDITABLE_DATASETS:
        return jsonify({"success": False, "message": "Unknown dataset"}), 404
    if "file" not in request.files:
        return jsonify({"success": False, "message": "No file uploaded"}), 400
    try:
        df = _parse_upload_to_df(request.files["file"])
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"Unable to read file: {exc}"}), 400
    report = _validate_df(name, df)
    return jsonify({"success": True, **report})


@app.route("/api/admin/dataset/<name>/apply", methods=["POST"])
def admin_dataset_apply(name: str):
    guard = _admin_guard()
    if guard:
        return guard
    if name not in ADMIN_EDITABLE_DATASETS:
        return jsonify({"success": False, "message": "Unknown dataset"}), 404
    if "file" not in request.files:
        return jsonify({"success": False, "message": "No file uploaded"}), 400
    mode = (request.form.get("mode") or "replace").lower()
    if mode not in ("replace", "append"):
        return jsonify({"success": False, "message": "mode must be replace or append"}), 400
    try:
        df = _parse_upload_to_df(request.files["file"])
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"Unable to read file: {exc}"}), 400
    report = _validate_df(name, df)
    if not report["ok"]:
        return jsonify({"success": False, "message": "Validation failed", **report}), 400

    target = DATASET_FILES[name]
    if mode == "append" and target.exists():
        try:
            existing = pd.read_csv(target)
            df = pd.concat([existing, df], ignore_index=True)
        except Exception as exc:  # pylint: disable=broad-except
            return jsonify({"success": False, "message": f"Unable to read existing file: {exc}"}), 500
    try:
        df, canonicalization = canonicalize_dataset_df(name, df)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"Unable to normalize dataset: {exc}"}), 400

    try:
        _atomic_write_csv(df, target)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"Write failed: {exc}"}), 500

    load_default_datasets()
    new_count = len(databases[name]) if databases.get(name) is not None else 0
    return jsonify({"success": True, "rowCount": int(new_count), "mode": mode, "canonicalization": canonicalization})


@app.route("/api/admin/dataset/<name>/row", methods=["POST"])
def admin_dataset_add_row(name: str):
    """Append a single row from a form submission."""
    guard = _admin_guard()
    if guard:
        return guard
    if name not in ADMIN_EDITABLE_DATASETS:
        return jsonify({"success": False, "message": "Unknown dataset"}), 404
    body = request.get_json(silent=True) or {}
    row = body.get("row") or {}
    cols = [c["key"] for c in ADMIN_EDITABLE_DATASETS[name]["columns"]]
    new_df = pd.DataFrame([{c: row.get(c, "") for c in cols}])
    report = _validate_df(name, new_df)
    if not report["ok"]:
        return jsonify({"success": False, "message": "Validation failed", **report}), 400

    target = DATASET_FILES[name]
    try:
        existing = pd.read_csv(target) if target.exists() else pd.DataFrame(columns=cols)
        combined = pd.concat([existing, new_df], ignore_index=True)
        combined, canonicalization = canonicalize_dataset_df(name, combined)
        _atomic_write_csv(combined, target)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"Write failed: {exc}"}), 500

    load_default_datasets()
    return jsonify({"success": True, "rowCount": int(len(combined)), "canonicalization": canonicalization})


# ---- Manual requirement entry ----

@app.route("/api/admin/requirements/manual", methods=["POST"])
@app.route("/api/admin/invoice/manual", methods=["POST"])
def admin_invoice_manual():
    guard = _admin_guard()
    if guard:
        return guard
    body = request.get_json(silent=True) or {}
    header = body.get("header") or {}
    lines = body.get("lines") or []

    invoice_number = text(header.get("requirementNumber")) or text(header.get("invoiceNumber"))
    invoice_date = text(header.get("requirementDate")) or text(header.get("invoiceDate"))
    customer_name = text(header.get("customerName"))
    if not (invoice_number and invoice_date and customer_name):
        return jsonify({"success": False, "message": "requirementNumber, requirementDate, customerName required"}), 400
    if not isinstance(lines, list) or not lines:
        return jsonify({"success": False, "message": "At least one requirement line is required"}), 400

    headers_path = DATASET_FILES["invoice_headers"]
    lines_path = DATASET_FILES["invoice_lines"]

    try:
        hdrs = pd.read_csv(headers_path) if headers_path.exists() else pd.DataFrame(columns=REQUIRED_COLS["invoice_headers"])
        lns = pd.read_csv(lines_path) if lines_path.exists() else pd.DataFrame(columns=REQUIRED_COLS["invoice_lines"])
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"Unable to read requirement files: {exc}"}), 500

    if invoice_number in hdrs.get("invoice_number", pd.Series([], dtype=str)).astype(str).values:
        return jsonify({"success": False, "message": f"Requirement {invoice_number} already exists"}), 409

    invoice_id = f"INV-{uuid.uuid4().hex[:8].upper()}"
    new_header = {c: "" for c in hdrs.columns}
    new_header.update({
        "invoice_id": invoice_id,
        "invoice_number": invoice_number,
        "invoice_date": invoice_date,
        "customer_name": customer_name,
    })
    hdrs = pd.concat([hdrs, pd.DataFrame([new_header])], ignore_index=True)

    new_line_rows = []
    for i, l in enumerate(lines, start=1):
        try:
            qty = float(l.get("qtyMt") or 0)
        except (TypeError, ValueError):
            return jsonify({"success": False, "message": f"Requirement line {i}: qtyMt must be a number"}), 400
        grade = text(l.get("grade"))
        color_family = text(l.get("colorFamily")).upper() or color_for_analysis_selector(l.get("standardCode"))
        std = text(l.get("standardCode")) or current_standard_code_for_color(color_family) or color_family
        if not color_family:
            return jsonify({"success": False, "message": f"Requirement line {i}: colorFamily required"}), 400
        row = {c: "" for c in lns.columns} if len(lns.columns) else {c: "" for c in REQUIRED_COLS["invoice_lines"]}
        row.update({
            "invoice_line_id": f"{invoice_id}-L{i:03d}",
            "invoice_id": invoice_id,
            "invoice_number": invoice_number,
            "invoice_date": invoice_date,
            "customer_name": customer_name,
            "grade": grade,
            "standard_code": std,
            "color_family": color_family,
            "application": text(l.get("application")),
            "qty_mt": qty,
            "target_method_id": text(l.get("targetMethodId")),
            "target_l": l.get("targetL") or "",
            "target_a": l.get("targetA") or "",
            "target_b": l.get("targetB") or "",
            "target_delta_l": l.get("targetDeltaL") if l.get("targetDeltaL") not in (None, "") else l.get("deltaL", ""),
            "target_delta_a": l.get("targetDeltaA") if l.get("targetDeltaA") not in (None, "") else l.get("deltaA", ""),
            "target_delta_b": l.get("targetDeltaB") if l.get("targetDeltaB") not in (None, "") else l.get("deltaB", ""),
            "outstanding_qty_mt": qty,
            "fulfillment_status": "open",
            "last_partial_at": "",
        })
        new_line_rows.append(row)

    lns = pd.concat([lns, pd.DataFrame(new_line_rows)], ignore_index=True)

    try:
        hdrs = prepare_df("invoice_headers", hdrs)
        lns = prepare_df("invoice_lines", lns)
        _atomic_write_csv(hdrs, headers_path)
        _atomic_write_csv(lns, lines_path)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": f"Write failed: {exc}"}), 500

    load_default_datasets()
    return jsonify({"success": True, "requirementId": invoice_id, "invoiceId": invoice_id, "lineCount": len(new_line_rows)})


# ---- OCR ingest ----

_INVOICE_NUM_RE = re.compile(
    r"\b(?:invoice|inv|bill)(?:\s*(?:no|number))?\s*[:#-]?\s*([A-Z0-9][A-Z0-9\-\/]{1,})\b",
    re.IGNORECASE,
)
_DATE_RE = re.compile(r"\b(\d{1,2}[\/-][A-Za-z0-9]{1,9}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b")
_QTY_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(mt|ton|tonnes?|kg|kgs)", re.IGNORECASE)
_DELTA_PAIR_RE = re.compile(r"\b(d\s*l|d\s*a|d\s*b|dl|da|db)\s*[:=]?\s*(-?\d+(?:\.\d+)?)\b", re.IGNORECASE)


def _extract_delta_pairs(s: str) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for key, value in _DELTA_PAIR_RE.findall(s or ""):
        metric = norm_key(key).replace(" ", "")
        if metric == "dl":
            out["targetDeltaL"] = float(value)
        elif metric == "da":
            out["targetDeltaA"] = float(value)
        elif metric == "db":
            out["targetDeltaB"] = float(value)
    return out


def _ocr_image_bytes(b: bytes) -> str:
    if not refresh_ocr_capability():
        raise RuntimeError(
            "OCR not available on server. Install pytesseract + Tesseract binary."
            + (f" Details: {OCR_ERROR}" if OCR_ERROR else "")
        )
    img = Image.open(io.BytesIO(b))
    return pytesseract.image_to_string(img)


def _extract_pdf_text(b: bytes) -> str:
    parts: List[str] = []
    if PDFPLUMBER_AVAILABLE:
        try:
            with pdfplumber.open(io.BytesIO(b)) as pdf:
                for page in pdf.pages:
                    t = page.extract_text() or ""
                    if t.strip():
                        parts.append(t)
        except Exception:  # pylint: disable=broad-except
            pass
    if parts:
        return "\n".join(parts)
    if PDF2IMAGE_AVAILABLE and refresh_ocr_capability():
        try:
            imgs = convert_from_bytes(b)
            for im in imgs:
                parts.append(pytesseract.image_to_string(im))
            return "\n".join(parts)
        except Exception as exc:  # pylint: disable=broad-except
            raise RuntimeError(f"PDF OCR failed: {exc}")
    return ""


def _standard_catalog_for_invoice_parser() -> Dict[str, Dict[str, Any]]:
    profiles = databases.get("standard_profiles")
    if profiles is None or profiles.empty:
        return {}

    catalog: Dict[str, Dict[str, Any]] = {}
    for standard_code in sorted({text(v) for v in profiles["standard_code"].tolist() if text(v)}):
        scoped = profiles[profiles["standard_code"] == standard_code].copy()
        if scoped.empty:
            continue
        grade = text(scoped.iloc[0].get("grade"))
        preview = choose_preview_profile(profiles, standard_code, grade)
        catalog[standard_code.upper()] = {
            "standardCode": standard_code,
            "grade": grade,
            "colorFamily": text(scoped.iloc[0].get("color_family")),
            "targetMethodId": "",
            "targetL": preview["L"],
            "targetA": preview["a"],
            "targetB": preview["b"],
        }
    return catalog


def _known_test_methods_for_invoice_parser() -> List[Dict[str, str]]:
    tests = databases.get("lot_test_results")
    if tests is None or tests.empty or "method_id" not in tests.columns:
        return []
    method_ids = ordered_methods(sorted({text(v) for v in tests["method_id"].tolist() if text(v)}))
    return [
        {"methodId": method_id, "label": METHOD_DISPLAY_LABELS.get(method_id, method_id)}
        for method_id in method_ids
    ]


def _qty_to_mt(value: Any, unit: str | None = None) -> float | None:
    amount = num(value)
    if amount is None:
        return None
    unit_key = text(unit).lower()
    if unit_key in ("kg", "kgs"):
        return round(amount / 1000.0, 6)
    return round(amount, 6)


def _extract_standard_code_from_text(text_blob: str, known_standards: List[str]) -> str:
    haystack = text(text_blob).upper()
    if not haystack:
        return ""
    for standard_code in sorted(known_standards, key=len, reverse=True):
        pattern = rf"(?<![A-Z0-9]){re.escape(standard_code)}(?![A-Z0-9])"
        if re.search(pattern, haystack):
            return standard_code
    return ""


def _score_extracted_line(line: Dict[str, Any]) -> float:
    score = 0.0
    if text(line.get("standardCode")):
        score += 3.0
    if text(line.get("grade")):
        score += 2.0
    if num(line.get("qtyMt")) is not None:
        score += 2.0
    if text(line.get("application")):
        score += 1.0
    if text(line.get("targetMethodId")):
        score += 0.5
    if any(num(line.get(k)) is not None for k in ("targetDeltaL", "targetDeltaA", "targetDeltaB", "deltaL", "deltaA", "deltaB")):
        score += 1.0
    if any(num(line.get(k)) is not None for k in ("targetL", "targetA", "targetB")):
        score += 0.5
    return score


def _score_extracted_payload(payload: Dict[str, Any]) -> float:
    header = payload.get("header") or {}
    score = 0.0
    for key in ("invoiceNumber", "invoiceDate", "customerName"):
        if text(header.get(key)):
            score += 1.0
    for line in payload.get("lines") or []:
        score += _score_extracted_line(line)
    return score


def _score_extracted_lines(lines: List[Dict[str, Any]]) -> float:
    return sum(_score_extracted_line(line) for line in lines)


def _merge_extracted_invoice(base: Dict[str, Any], candidate: Dict[str, Any] | None) -> Dict[str, Any]:
    if not candidate:
        return base

    header = dict(base.get("header") or {})
    for key in ("invoiceNumber", "invoiceDate", "customerName"):
        value = text((candidate.get("header") or {}).get(key))
        if value:
            header[key] = value

    merged = dict(base)
    merged["header"] = header
    if _score_extracted_lines(candidate.get("lines") or []) >= _score_extracted_lines(base.get("lines") or []):
        merged["lines"] = candidate.get("lines") or []
    return merged


def _enrich_extracted_invoice(payload: Dict[str, Any]) -> Dict[str, Any]:
    catalog = _standard_catalog_for_invoice_parser()
    enriched_lines: List[Dict[str, Any]] = []

    for line in payload.get("lines") or []:
        current = dict(line)
        standard_code = text(current.get("standardCode")).upper()
        if not standard_code:
            standard_code = _extract_standard_code_from_text(text(current.get("rawText")), list(catalog.keys()))
        meta = catalog.get(standard_code)

        if meta:
            current["standardCode"] = meta["standardCode"]
            current["grade"] = text(current.get("grade")) or meta["grade"]
            current["targetMethodId"] = text(current.get("targetMethodId")) or meta["targetMethodId"]
            if current.get("targetL") in ("", None):
                current["targetL"] = meta["targetL"]
            if current.get("targetA") in ("", None):
                current["targetA"] = meta["targetA"]
            if current.get("targetB") in ("", None):
                current["targetB"] = meta["targetB"]

        qty_mt = _qty_to_mt(current.get("qtyMt"), current.get("qtyUnit"))
        if qty_mt is not None:
            current["qtyMt"] = qty_mt

        current["grade"] = text(current.get("grade"))
        current["standardCode"] = text(current.get("standardCode"))
        current["application"] = text(current.get("application"))
        current["targetMethodId"] = text(current.get("targetMethodId"))
        current["targetDeltaL"] = current.get("targetDeltaL", current.get("deltaL"))
        current["targetDeltaA"] = current.get("targetDeltaA", current.get("deltaA"))
        current["targetDeltaB"] = current.get("targetDeltaB", current.get("deltaB"))
        current["rawText"] = text(current.get("rawText"))[:200]

        if num(current.get("qtyMt")) is None and not (current["grade"] or current["standardCode"]):
            continue
        enriched_lines.append(current)

    payload = dict(payload)
    payload["lines"] = enriched_lines
    payload["rawText"] = text(payload.get("rawText"))[:8000]
    payload["header"] = {
        "invoiceNumber": text((payload.get("header") or {}).get("invoiceNumber")),
        "invoiceDate": text((payload.get("header") or {}).get("invoiceDate")),
        "customerName": text((payload.get("header") or {}).get("customerName")),
    }
    return payload


def _parse_ocr_text_with_openai(raw: str) -> Tuple[Dict[str, Any] | None, str | None]:
    client = openai_invoice_client()
    if client is None:
        return None, OPENAI_ERROR

    catalog = _standard_catalog_for_invoice_parser()
    known_test_methods = _known_test_methods_for_invoice_parser()
    known_standards = [
        {
            "standardCode": meta["standardCode"],
            "grade": meta["grade"],
            "targetMethodId": meta["targetMethodId"],
        }
        for _, meta in sorted(catalog.items())
    ]

    instructions = (
        "Extract invoice header fields and line items from OCR text for a pigment-order entry form. "
        "Return only fields supported by the schema. Do not hallucinate values. "
        "If uncertain, return an empty string or null. "
        "Quantities must be metric tons in qtyMt. Convert kg/kgs to metric tons by dividing by 1000. "
        "Prefer standardCode values from the provided known standards list when they clearly match the OCR text. "
        "When invoice line items include dL, da, or dB tolerances/targets, place them in targetDeltaL, targetDeltaA, and targetDeltaB. "
        "Only fill targetMethodId when the invoice line explicitly names a QC test or method. "
        "Use only methodId values from the known inventory-backed test methods list; if no explicit test is mentioned, set targetMethodId to an empty string. "
        "Do not infer a test method from application, standard, grade, or product description. "
        "Extract only real ordered line items, not totals, taxes, addresses, or bank details."
    )

    schema = {
        "type": "object",
        "properties": {
            "header": {
                "type": "object",
                "properties": {
                    "invoiceNumber": {"type": "string"},
                    "invoiceDate": {"type": "string"},
                    "customerName": {"type": "string"},
                },
                "required": ["invoiceNumber", "invoiceDate", "customerName"],
                "additionalProperties": False,
            },
            "lines": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "grade": {"type": "string"},
                        "standardCode": {"type": "string"},
                        "application": {"type": "string"},
                        "qtyMt": {"type": ["number", "null"]},
                        "targetMethodId": {"type": "string"},
                        "targetL": {"type": ["number", "null"]},
                        "targetA": {"type": ["number", "null"]},
                        "targetB": {"type": ["number", "null"]},
                        "targetDeltaL": {"type": ["number", "null"]},
                        "targetDeltaA": {"type": ["number", "null"]},
                        "targetDeltaB": {"type": ["number", "null"]},
                        "rawText": {"type": "string"},
                    },
                    "required": [
                        "grade", "standardCode", "application", "qtyMt", "targetMethodId",
                        "targetL", "targetA", "targetB", "targetDeltaL", "targetDeltaA", "targetDeltaB", "rawText",
                    ],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["header", "lines"],
        "additionalProperties": False,
    }

    try:
        response = client.responses.create(
            model=openai_invoice_model(),
            input=[
                {"role": "system", "content": instructions},
                {
                    "role": "user",
                    "content": (
                        "Known standards:\n"
                        f"{json.dumps(known_standards, ensure_ascii=True)}\n\n"
                        "Known inventory-backed test methods:\n"
                        f"{json.dumps(known_test_methods, ensure_ascii=True)}\n\n"
                        "OCR text:\n"
                        f"{text(raw)[:12000]}"
                    ),
                },
            ],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "invoice_extraction",
                    "schema": schema,
                    "strict": True,
                }
            },
            temperature=0,
            max_output_tokens=1200,
        )
        parsed = json.loads(response.output_text)
        return parsed, None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def _parse_ocr_text(raw: str) -> Dict[str, Any]:
    text_blob = raw or ""
    header: Dict[str, Any] = {"invoiceNumber": "", "invoiceDate": "", "customerName": ""}
    m = _INVOICE_NUM_RE.search(text_blob)
    if m:
        header["invoiceNumber"] = m.group(1).strip()
    m = _DATE_RE.search(text_blob)
    if m:
        header["invoiceDate"] = m.group(1).strip()

    # Best-effort customer: first non-empty line that looks like a name.
    for line in text_blob.splitlines():
        s = line.strip()
        if not s:
            continue
        low = s.lower()
        if any(k in low for k in ("invoice", "bill", "date", "tax", "gst", "address")):
            continue
        if len(s) >= 4 and re.search(r"[A-Za-z]", s):
            header["customerName"] = s[:80]
            break

    # Attempt to pull candidate lines: any line that mentions qty + a standard-ish token.
    lines_out = []
    catalog = _standard_catalog_for_invoice_parser()
    known_standards = list(catalog.keys())
    for raw_line in text_blob.splitlines():
        s = raw_line.strip()
        if not s:
            continue
        q = _QTY_RE.search(s)
        if not q:
            continue
        qty = _qty_to_mt(q.group(1), q.group(2))
        std = _extract_standard_code_from_text(s, known_standards)
        delta_values = _extract_delta_pairs(s)
        lines_out.append({
            "grade": "",
            "standardCode": std,
            "application": "",
            "qtyMt": num(q.group(1)),
            "qtyUnit": text(q.group(2)),
            "targetMethodId": "",
            "targetL": None,
            "targetA": None,
            "targetB": None,
            "targetDeltaL": delta_values.get("targetDeltaL"),
            "targetDeltaA": delta_values.get("targetDeltaA"),
            "targetDeltaB": delta_values.get("targetDeltaB"),
            "rawText": s[:200],
        })

    return _enrich_extracted_invoice({"header": header, "lines": lines_out, "rawText": text_blob[:8000]})


@app.route("/api/admin/requirements/ocr", methods=["POST"])
@app.route("/api/admin/invoice/ocr", methods=["POST"])
def admin_invoice_ocr():
    guard = _admin_guard()
    if guard:
        return guard
    if "file" not in request.files:
        return jsonify({"success": False, "message": "No file uploaded"}), 400
    f = request.files["file"]
    name = (f.filename or "").lower()
    data = f.read()
    try:
        if name.endswith(".pdf"):
            raw = _extract_pdf_text(data)
        else:
            raw = _ocr_image_bytes(data)
    except Exception as exc:  # pylint: disable=broad-except
        return jsonify({"success": False, "message": str(exc)}), 500

    parsed = _parse_ocr_text(raw)
    parser_source = "heuristic"
    warnings: List[str] = []

    llm_parsed, llm_error = _parse_ocr_text_with_openai(raw)
    if llm_parsed is not None:
        parsed = _enrich_extracted_invoice(_merge_extracted_invoice(parsed, llm_parsed))
        parser_source = "openai+heuristic"
    elif llm_error:
        warnings.append(f"OpenAI parser unavailable: {llm_error}")

    return jsonify({"success": True, **parsed, "parserSource": parser_source, "parseWarnings": warnings})


@app.route("/api/admin/customers", methods=["GET"])
def admin_customers():
    """Distinct customer names for typeahead."""
    guard = _admin_guard()
    if guard:
        return guard
    hdrs_path = DATASET_FILES["invoice_headers"]
    names: List[str] = []
    if hdrs_path.exists():
        try:
            df = pd.read_csv(hdrs_path)
            names = sorted({text(v) for v in df.get("customer_name", []).tolist() if text(v)})
        except Exception:  # pylint: disable=broad-except
            names = []
    return jsonify({"success": True, "customers": names})


@app.route("/api/admin/test-methods", methods=["GET"])
def admin_test_methods():
    guard = _admin_guard()
    if guard:
        return guard
    return jsonify({
        "success": True,
        "testMethods": _known_test_methods_for_invoice_parser(),
    })


@app.route("/api/admin/capabilities", methods=["GET"])
def admin_capabilities():
    guard = _admin_guard()
    if guard:
        return guard
    refresh_ocr_capability()
    llm_capability = invoice_parser_capability()
    return jsonify({
        "success": True,
        "ocr": OCR_AVAILABLE,
        "ocrPath": OCR_BINARY_PATH,
        "ocrError": OCR_ERROR,
        "openaiInvoiceParser": llm_capability["enabled"],
        "openaiInvoiceModel": llm_capability["model"],
        "openaiInvoiceError": llm_capability["error"],
        "pdfplumber": PDFPLUMBER_AVAILABLE,
        "pdf2image": PDF2IMAGE_AVAILABLE,
        "sourceState": source_data_state,
    })


@app.route("/api/match/pigment-to-orders", methods=["POST"])
def retired_match():
    return jsonify({"success": False, "message": "Endpoint retired. Use /api/analyze/standard."}), 410


@app.route("/api/database/pigments", methods=["GET"])
@app.route("/api/database/orders", methods=["GET"])
@app.route("/api/database/upload/pigments", methods=["POST"])
@app.route("/api/database/upload/orders", methods=["POST"])
def retired_database():
    return jsonify({"success": False, "message": "Pigment/order endpoints retired in standard-first cutover."}), 410


load_default_datasets()


if __name__ == "__main__":
    print("=" * 60)
    print("Standard-First Inventory Allocation API")
    print("=" * 60)
    print(f"Dataset loaded: {dataset_state['loaded']}")
    if dataset_state["loaded"]:
        for k, df in databases.items():
            print(f"{k}: {len(df) if df is not None else 0}")
    else:
        print(f"Dataset error: {dataset_state['error']}")
    print("=" * 60)
    app.run(debug=True, port=5000)
