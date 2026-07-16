#!/usr/bin/env python3
"""
ETL contable BALDERRAMA — Procesos A-D
Extrae de CON_CTAS, aísla gasto admin, prorratea y consolida por centro de costo.

Uso:
  python scripts/etl_contable.py --inicio 2026-01-01 --fin 2026-06-30
  python scripts/etl_contable.py --inicio 2026-06-01 --fin 2026-06-30 --output data/etl_result.json

Requiere: pip install pyodbc python-dotenv
"""

import argparse
import json
import os
from pathlib import Path

try:
    import pyodbc
    from dotenv import load_dotenv
except ImportError:
    print("Instala dependencias: pip install pyodbc python-dotenv")
    raise

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

SEGMENT_TO_CC = {
    "0001": ("piso", "Piso (Autos Nuevos)"),
    "0002": ("foraneos", "Foráneos"),
    "0004": ("cholula", "Cholula"),
    "0005": ("zacatelco", "Zacatelco"),
    "0006": ("flotillas", "Flotillas"),
    "0007": ("casa", "Casa / BDC"),
    "0008": ("suauto", "SuAuto"),
    "0010": ("intercambios", "Intercambios"),
}

PRORATION_MATRIX = {
    "piso": 0.22, "foraneos": 0.10, "cholula": 0.08, "zacatelco": 0.06,
    "flotillas": 0.08, "casa": 0.05, "suauto": 0.04, "intercambios": 0.03,
    "seminuevos": 0.08, "refacciones": 0.10, "servicio": 0.10, "hyp": 0.06,
}


def connect():
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={os.getenv('DB_HOST')},{os.getenv('DB_PORT', '1433')};"
        f"DATABASE={os.getenv('DB_NAME')};"
        f"UID={os.getenv('DB_USER')};"
        f"PWD={os.getenv('DB_PASSWORD')};"
        "TrustServerCertificate=yes;"
    )
    return pyodbc.connect(conn_str)


def movement_expr(start_m, end_m):
    return " + ".join(f"ISNULL(CTA_CARGO{m},0)-ISNULL(CTA_ABONO{m},0)" for m in range(start_m, end_m + 1))


def extract_base(cursor, year, start_m, end_m):
    """Proceso A: extracción base."""
    table = f"CON_CTAS01{year}"
    mov = movement_expr(start_m, end_m)
    income = f"CASE WHEN CTA_NATURALEZA='ACRE' THEN -({mov}) ELSE ({mov}) END"
    expense = f"CASE WHEN CTA_NATURALEZA='DEUD' THEN ({mov}) ELSE -({mov}) END"

    sql = f"""
    SELECT CTA_NUMCTA, CTA_DESCRIPCION, LTRIM(RTRIM(ISNULL(CTA_GPOCONT4,''))) AS CC,
      SUM(CASE
        WHEN CTA_NUMCTA LIKE '0400%' OR (CTA_NUMCTA LIKE '04%' AND CTA_NUMCTA NOT LIKE '06%') THEN {income}
        WHEN CTA_NUMCTA LIKE '0600%' OR CTA_NUMCTA LIKE '06%' THEN {expense}
        WHEN CTA_NUMCTA LIKE '0700%' THEN {expense}
        ELSE 0 END) AS balance
    FROM [{table}]
    WHERE CTA_ACUMDET='DETA'
      AND (CTA_NUMCTA LIKE '04%' OR CTA_NUMCTA LIKE '06%' OR CTA_NUMCTA LIKE '0700%')
    GROUP BY CTA_NUMCTA, CTA_DESCRIPCION, CTA_GPOCONT4
    HAVING ABS(SUM(CASE
        WHEN CTA_NUMCTA LIKE '0400%' OR (CTA_NUMCTA LIKE '04%' AND CTA_NUMCTA NOT LIKE '06%') THEN {income}
        WHEN CTA_NUMCTA LIKE '0600%' OR CTA_NUMCTA LIKE '06%' THEN {expense}
        WHEN CTA_NUMCTA LIKE '0700%' THEN {expense}
        ELSE 0 END)) > 0.01
    """
    cursor.execute(sql)
    rows = []
    for r in cursor.fetchall():
        cta = r.CTA_NUMCTA
        bal = float(r.balance or 0)
        parts = cta.split("-")
        mask = "ingreso" if cta.startswith("04") and not cta.startswith("06") else "costo" if cta.startswith("06") else "gasto" if cta.startswith("0700") else None
        if not mask:
            continue
        segment = next((p for p in parts if p in SEGMENT_TO_CC), None)
        cc_id = SEGMENT_TO_CC[segment][0] if segment else ("admin_general" if mask == "gasto" and not segment else "sin_clasificar")
        cc_type = "administrativo" if cc_id == "admin_general" else "operativo"
        rows.append({"cuenta": cta, "desc": r.CTA_DESCRIPCION, "cc_gpo4": r.CC, "mask": mask, "balance": bal, "cc_id": cc_id, "cc_type": cc_type})
    return rows


def isolate_admin(rows):
    """Proceso B: bolsón administrativo."""
    admin = [r for r in rows if r["mask"] == "gasto" and r["cc_type"] == "administrativo"]
    total = sum(r["balance"] for r in admin)
    return {"total_bolson": total, "count": len(admin)}


def prorate(admin_pool):
    """Proceso C: prorrateo."""
    total = admin_pool["total_bolson"]
    return {cc: total * pct for cc, pct in PRORATION_MATRIX.items()}


def consolidate(rows, prorated):
    """Proceso D: consolidación y KPIs."""
    cc_ids = [v[0] for v in SEGMENT_TO_CC.values()] + ["seminuevos", "refacciones", "servicio", "hyp"]
    cc = {k: {"ingresos": 0, "costos": 0, "gasto_directo": 0, "gasto_asignado": 0} for k in cc_ids}

    for r in rows:
        if r["cc_type"] != "operativo" or r["cc_id"] not in cc:
            continue
        if r["mask"] == "ingreso":
            cc[r["cc_id"]]["ingresos"] += r["balance"]
        elif r["mask"] == "costo":
            cc[r["cc_id"]]["costos"] += r["balance"]
        elif r["mask"] == "gasto":
            cc[r["cc_id"]]["gasto_directo"] += r["balance"]

    for cid, monto in prorated.items():
        if cid in cc:
            cc[cid]["gasto_asignado"] = monto

    result = []
    for cid, v in cc.items():
        ub = v["ingresos"] - v["costos"]
        uo = ub - v["gasto_directo"] - v["gasto_asignado"]
        result.append({
            "cc_id": cid,
            "ventas": v["ingresos"],
            "costo": v["costos"],
            "utilidad_bruta": ub,
            "gasto_directo": v["gasto_directo"],
            "gasto_asignado": v["gasto_asignado"],
            "utilidad_operativa": uo,
        })
    return sorted(result, key=lambda x: -x["utilidad_operativa"])


def main():
    parser = argparse.ArgumentParser(description="ETL contable BALDERRAMA")
    parser.add_argument("--inicio", required=True, help="YYYY-MM-DD")
    parser.add_argument("--fin", required=True, help="YYYY-MM-DD")
    parser.add_argument("--output", help="Ruta JSON de salida")
    args = parser.parse_args()

    year = int(args.inicio[:4])
    start_m = int(args.inicio[5:7])
    end_m = int(args.fin[5:7])

    conn = connect()
    cursor = conn.cursor()
    rows = extract_base(cursor, year, start_m, end_m)
    admin = isolate_admin(rows)
    prorated = prorate(admin)
    consolidated = consolidate(rows, prorated)

    output = {"periodo": {"inicio": args.inicio, "fin": args.fin}, "procesoB": admin, "procesoD": consolidated}
    text = json.dumps(output, indent=2, ensure_ascii=False)
    print(text)

    if args.output:
        out = ROOT / args.output
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
        print(f"\nGuardado en {out}")

    conn.close()


if __name__ == "__main__":
    main()
