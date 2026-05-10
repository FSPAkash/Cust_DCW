from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd


BACKEND = Path(__file__).parent
STITCHED = BACKEND / "stitched_outputs"

HEADERS_CSV = STITCHED / "bulk_dummy_invoice_headers_240.csv"
LINES_CSV = STITCHED / "bulk_dummy_invoice_lines_240.csv"
LINES_BASELINE_CSV = STITCHED / "bulk_dummy_invoice_lines_240.csv.baseline"
WORKBOOK = STITCHED / "bulk_dummy_invoices_240.xlsx"
SUMMARY_MD = STITCHED / "bulk_dummy_invoice_summary_240.md"

SOURCE_NOTE = "Compact bulk dummy invoice pack regenerated for demo with real inventory shortage scenarios"
DEMO_INVOICE_COUNT = 15
DEMO_INVOICE_PLANS = [
    {"color": "RED", "lines": [{"variant": "red_130_paint", "qty_mt": 20}, {"variant": "red_130_paint", "qty_mt": 30}]},
    {"color": "RED", "lines": [{"variant": "red_130_paint", "qty_mt": 40}]},
    {"color": "RED", "lines": [{"variant": "red_130_paint", "qty_mt": 60}, {"variant": "red_130_paint", "qty_mt": 80}]},
    {"color": "RED", "lines": [{"variant": "red_130_paint", "qty_mt": 90}]},
    {"color": "RED", "lines": [{"variant": "red_130_paint", "qty_mt": 150}, {"variant": "red_130_paint", "qty_mt": 180}]},
    {"color": "ORANGE", "lines": [{"variant": "orange_150_construction", "qty_mt": 10}, {"variant": "orange_150_cement", "qty_mt": 20}]},
    {"color": "ORANGE", "lines": [{"variant": "orange_150_construction", "qty_mt": 30}]},
    {"color": "ORANGE", "lines": [{"variant": "orange_150_cement", "qty_mt": 50}, {"variant": "orange_150_construction", "qty_mt": 80}]},
    {"color": "ORANGE", "lines": [{"variant": "orange_155_construction", "qty_mt": 8}]},
    {"color": "ORANGE", "lines": [{"variant": "orange_155_cement", "qty_mt": 12}, {"variant": "orange_155_construction", "qty_mt": 15}]},
    {"color": "YELLOW", "lines": [{"variant": "yellow_129_paint", "qty_mt": 50}, {"variant": "yellow_129_paint", "qty_mt": 2000}]},
    {"color": "YELLOW", "lines": [{"variant": "yellow_129_paint", "qty_mt": 90}]},
    {"color": "YELLOW", "lines": [{"variant": "yellow_129_paint", "qty_mt": 100}, {"variant": "yellow_129_paint", "qty_mt": 110}]},
    {"color": "YELLOW", "lines": [{"variant": "yellow_129_paint", "qty_mt": 200}]},
    {"color": "YELLOW", "lines": [{"variant": "yellow_129_paint", "qty_mt": 300}, {"variant": "yellow_129_paint", "qty_mt": 400}, {"variant": "yellow_129_paint", "qty_mt": 1200}]},
]

LINE_COLUMNS = [
    "product_description",
    "color_family",
    "grade",
    "standard_code",
    "application",
    "target_method_id",
    "target_l",
    "target_a",
    "target_b",
    "target_delta_l",
    "target_delta_a",
    "target_delta_b",
    "pack_size_kg",
    "bag_count",
    "qty_kg",
    "qty_mt",
    "rate_per_kg_inr",
    "line_value_inr",
    "inventory_match_status",
    "source_basis",
    "invoice_line_id",
    "invoice_id",
    "invoice_number",
    "invoice_date",
    "line_no",
    "customer_name",
    "fulfillment_status",
    "outstanding_qty_mt",
    "last_partial_at",
]

WORKBOOK_LINE_COLUMNS = [c for c in LINE_COLUMNS if c not in {"fulfillment_status", "outstanding_qty_mt", "last_partial_at"}]

LINE_VARIANTS = {
    "red_130_paint": {
        "color_family": "RED",
        "product_description": "SYNTHETIC RED OXIDE 130 (L325) 25KG DCW BOPP BAG",
        "grade": "130",
        "standard_code": "325",
        "application": "Paint",
        "rate_per_kg_inr": 92,
    },
    "red_130_water": {
        "color_family": "RED",
        "product_description": "SYNTHETIC RED OXIDE 130 (L325) 25KG DCW BOPP BAG",
        "grade": "130",
        "standard_code": "325",
        "application": "Water Based",
        "rate_per_kg_inr": 94,
    },
    "red_130a_paint": {
        "color_family": "RED",
        "product_description": "SYNTHETIC RED OXIDE 130A (L3249B) 25KG DCW BOPP BAG",
        "grade": "130A",
        "standard_code": "3249B",
        "application": "Paint",
        "rate_per_kg_inr": 96,
    },
    "red_130a_water": {
        "color_family": "RED",
        "product_description": "SYNTHETIC RED OXIDE 130A (L3249B) 25KG DCW BOPP BAG",
        "grade": "130A",
        "standard_code": "3249B",
        "application": "Water Based",
        "rate_per_kg_inr": 98,
    },
    "orange_150_construction": {
        "color_family": "ORANGE",
        "product_description": "SYNTHETIC ORANGE OXIDE 150 (4400) 25KG DCW BOPP BAG",
        "grade": "150",
        "standard_code": "4400",
        "application": "Construction",
        "rate_per_kg_inr": 97,
    },
    "orange_150_cement": {
        "color_family": "ORANGE",
        "product_description": "SYNTHETIC ORANGE OXIDE 150 (4400) 25KG DCW BOPP BAG",
        "grade": "150",
        "standard_code": "4400",
        "application": "Cement",
        "rate_per_kg_inr": 98,
    },
    "orange_155_construction": {
        "color_family": "ORANGE",
        "product_description": "SYNTHETIC ORANGE OXIDE 155 (4400) 25KG DCW BOPP BAG",
        "grade": "155",
        "standard_code": "4400",
        "application": "Construction",
        "rate_per_kg_inr": 99,
    },
    "orange_155_cement": {
        "color_family": "ORANGE",
        "product_description": "SYNTHETIC ORANGE OXIDE 155 (4400) 25KG DCW BOPP BAG",
        "grade": "155",
        "standard_code": "4400",
        "application": "Cement",
        "rate_per_kg_inr": 100,
    },
    "yellow_129_paint": {
        "color_family": "YELLOW",
        "product_description": "SYNTHETIC YELLOW OXIDE 129 (6600) 25KG DCW BOPP BAG",
        "grade": "129",
        "standard_code": "6600",
        "application": "Paint/Construction",
        "rate_per_kg_inr": 84,
    },
    "yellow_129_construction": {
        "color_family": "YELLOW",
        "product_description": "SYNTHETIC YELLOW OXIDE 129 (6600) 25KG DCW BOPP BAG",
        "grade": "129",
        "standard_code": "6600",
        "application": "Construction",
        "rate_per_kg_inr": 85,
    },
}


def select_demo_headers(headers: pd.DataFrame) -> pd.DataFrame:
    ordered = headers.copy()
    ordered["invoice_number_num"] = pd.to_numeric(ordered["invoice_number"], errors="coerce")
    ordered = ordered.sort_values(["invoice_number_num", "invoice_number", "invoice_id"]).head(DEMO_INVOICE_COUNT).copy()
    ordered = ordered.drop(columns=["invoice_number_num"])
    if len(ordered) != DEMO_INVOICE_COUNT:
        raise ValueError(f"Expected at least {DEMO_INVOICE_COUNT} headers, found {len(ordered)}")
    return ordered.reset_index(drop=True)


def make_line_row(header: pd.Series, line_no: int, line_spec: dict[str, Any]) -> dict[str, Any]:
    variant = LINE_VARIANTS[line_spec["variant"]]
    qty_mt = float(line_spec["qty_mt"])
    bag_count = int(round((qty_mt * 1000.0) / 25.0))
    qty_kg = bag_count * 25
    qty_mt = round(qty_kg / 1000.0, 3)
    rate = int(variant["rate_per_kg_inr"])
    line_value = int(qty_kg * rate)

    return {
        "product_description": variant["product_description"],
        "color_family": variant["color_family"],
        "grade": variant["grade"],
        "standard_code": variant["standard_code"],
        "application": variant["application"],
        "target_method_id": "",
        "target_l": "",
        "target_a": "",
        "target_b": "",
        "target_delta_l": "",
        "target_delta_a": "",
        "target_delta_b": "",
        "pack_size_kg": 25,
        "bag_count": bag_count,
        "qty_kg": qty_kg,
        "qty_mt": qty_mt,
        "rate_per_kg_inr": rate,
        "line_value_inr": line_value,
        "inventory_match_status": "exact_supported_grade_standard",
        "source_basis": "bulk inventory-shortage demo line",
        "invoice_line_id": f"{header['invoice_id']}-L{line_no:02d}",
        "invoice_id": header["invoice_id"],
        "invoice_number": header["invoice_number"],
        "invoice_date": header["invoice_date"],
        "line_no": line_no,
        "customer_name": header["customer_name"],
        "fulfillment_status": "open",
        "outstanding_qty_mt": qty_mt,
        "last_partial_at": "",
    }


def build_lines(headers: pd.DataFrame) -> pd.DataFrame:
    if len(headers) != len(DEMO_INVOICE_PLANS):
        raise ValueError(f"Expected {len(DEMO_INVOICE_PLANS)} headers, found {len(headers)}")
    rows: list[dict[str, Any]] = []

    for (_, header), plan in zip(headers.iterrows(), DEMO_INVOICE_PLANS):
        if plan["color"] not in {"RED", "ORANGE", "YELLOW"}:
            raise ValueError(f"Unexpected color in plan: {plan['color']}")
        for line_no, line_spec in enumerate(plan["lines"], start=1):
            rows.append(make_line_row(header, line_no, line_spec))

    lines = pd.DataFrame(rows, columns=LINE_COLUMNS)
    return lines.sort_values(["invoice_number", "line_no"]).reset_index(drop=True)


def refresh_headers(headers: pd.DataFrame, lines: pd.DataFrame) -> pd.DataFrame:
    grouped = (
        lines.groupby("invoice_id", as_index=False)
        .agg(
            total_qty_kg=("qty_kg", "sum"),
            subtotal_inr=("line_value_inr", "sum"),
            supported_line_count=("inventory_match_status", lambda s: int((s == "exact_supported_grade_standard").sum())),
            unsupported_line_count=("inventory_match_status", lambda s: int((s != "exact_supported_grade_standard").sum())),
        )
    )
    refreshed = headers.merge(grouped, on="invoice_id", how="left", suffixes=("", "_new"))
    refreshed["total_qty_kg"] = refreshed["total_qty_kg_new"].fillna(0).astype(int)
    refreshed["subtotal_inr"] = refreshed["subtotal_inr_new"].fillna(0).astype(int)
    refreshed["transport_inr"] = (refreshed["subtotal_inr"] * 0.04).round().astype(int)
    refreshed["grand_total_inr"] = refreshed["subtotal_inr"] + refreshed["transport_inr"]
    refreshed["supported_line_count"] = refreshed["supported_line_count_new"].fillna(0).astype(int)
    refreshed["unsupported_line_count"] = refreshed["unsupported_line_count_new"].fillna(0).astype(int)
    refreshed["pack_size_kg_default"] = 25
    refreshed["source_note"] = SOURCE_NOTE
    drop_cols = [c for c in refreshed.columns if c.endswith("_new")]
    refreshed = refreshed.drop(columns=drop_cols)
    return refreshed


def write_outputs(headers: pd.DataFrame, lines: pd.DataFrame) -> None:
    headers.to_csv(HEADERS_CSV, index=False)
    lines.to_csv(LINES_CSV, index=False)
    lines.to_csv(LINES_BASELINE_CSV, index=False)

    workbook_lines = lines[WORKBOOK_LINE_COLUMNS].copy()
    with pd.ExcelWriter(WORKBOOK, engine="openpyxl", mode="w") as writer:
        headers.to_excel(writer, sheet_name="invoice_headers", index=False)
        workbook_lines.to_excel(writer, sheet_name="invoice_lines", index=False)


def write_summary(headers: pd.DataFrame, lines: pd.DataFrame) -> None:
    line_counts = lines.groupby("invoice_id").size()
    standards = (
        lines.loc[lines["inventory_match_status"] == "exact_supported_grade_standard", ["standard_code", "grade"]]
        .drop_duplicates()
        .sort_values(["standard_code", "grade"])
    )
    out = [
        "# Bulk Dummy Invoice Pack",
        "",
        f"- Invoice count: `{len(headers)}`",
        f"- Invoice line count: `{len(lines)}`",
        f"- Supported lines: `{int((lines['inventory_match_status'] == 'exact_supported_grade_standard').sum())}`",
        f"- Unsupported lines: `{int((lines['inventory_match_status'] != 'exact_supported_grade_standard').sum())}`",
        f"- Lines per invoice: `{int(line_counts.min())}` to `{int(line_counts.max())}`",
        "",
        "Standards represented:",
    ]
    for _, row in standards.iterrows():
        out.append(f"- `{row['standard_code']}` / grade `{row['grade']}`")
    out.extend(
        [
            "",
            "Each color includes fully covered, partially covered, and inventory-shortage blocked lines based on current stock.",
            "",
            "Workbook was rebuilt with compact invoice header and line sheets for the demo pack.",
        ]
    )
    SUMMARY_MD.write_text("\n".join(out) + "\n", encoding="utf-8")


def main() -> None:
    headers = select_demo_headers(pd.read_csv(HEADERS_CSV))
    lines = build_lines(headers)
    headers = refresh_headers(headers, lines)
    write_outputs(headers, lines)
    write_summary(headers, lines)

    color_counts = lines.groupby("color_family")["invoice_id"].nunique().sort_values(ascending=False)
    line_counts = lines.groupby("invoice_id").size()
    print("Invoice colors:")
    print(color_counts.to_string())
    print()
    print("Line counts per invoice:")
    print(line_counts.describe().round(2).to_string())


if __name__ == "__main__":
    main()
