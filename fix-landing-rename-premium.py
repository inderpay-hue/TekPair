#!/usr/bin/env python3
"""
fix-landing-rename-premium.py
=============================
Renombra "Top" → "Premium" en index.html solamente (4 idiomas: es, en, fr, pt).

NO toca:
- dashboard.html
- api/webhook.js
- Supabase (BBDD)
- Las features de cada plan (eso es otro script)

Solo cambia:
- Card del plan 3: nombre visible
- href del CTA: ?plan=top → ?plan=premium
- Cadenas i18n: plan3.name en los 4 idiomas

Uso:
    cd ~/Downloads/tekpair2
    python3 fix-landing-rename-premium.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HTML = ROOT / "index.html"

if not HTML.exists():
    print(f"ERROR: no se encuentra {HTML}")
    sys.exit(1)

raw = HTML.read_bytes()
text = raw.decode("utf-8", errors="surrogateescape")
size_before = len(raw)
print(f"[0/3] Leído index.html ({size_before} bytes)")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 1: Card del plan 3 (HTML visible)
# ─────────────────────────────────────────────────────────────────────────────
OLD_CARD = '<div class="price-name" data-i18n="plan3.name">Top</div>'
NEW_CARD = '<div class="price-name" data-i18n="plan3.name">Premium</div>'

if OLD_CARD not in text:
    print("ERROR P1: no encuentro la card del plan 3 con 'Top'")
    sys.exit(1)
if text.count(OLD_CARD) != 1:
    print(f"ERROR P1: card aparece {text.count(OLD_CARD)} veces, esperaba 1")
    sys.exit(1)
text = text.replace(OLD_CARD, NEW_CARD, 1)
print("[1/3] Card plan 3: 'Top' → 'Premium'")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 2: href del CTA
# ─────────────────────────────────────────────────────────────────────────────
OLD_HREF = 'href="/registro.html?plan=top"'
NEW_HREF = 'href="/registro.html?plan=premium"'

if OLD_HREF not in text:
    print("ERROR P2: no encuentro href ?plan=top")
    sys.exit(1)
if text.count(OLD_HREF) != 1:
    print(f"ERROR P2: href aparece {text.count(OLD_HREF)} veces, esperaba 1")
    sys.exit(1)
text = text.replace(OLD_HREF, NEW_HREF, 1)
print("[2/3] href CTA: ?plan=top → ?plan=premium")

# ─────────────────────────────────────────────────────────────────────────────
# PATCH 3: Cadenas i18n plan3.name en 4 idiomas
# ─────────────────────────────────────────────────────────────────────────────
# Solo cambiamos el valor de plan3.name (no plan3.desc/f1/etc, que mantienen su texto original)
# Buscamos patrón exacto en cada idioma:
sub_targets = [
    # Español
    ("'plan3.name':'Top'", "'plan3.name':'Premium'"),
    # Inglés
    # (es el mismo string en EN y ES, pero ojo: hay 4 ocurrencias en total en los 4 idiomas)
]

# Hacemos un solo replace global del patrón 'plan3.name':'Top'
OLD_I18N = "'plan3.name':'Top'"
NEW_I18N = "'plan3.name':'Premium'"

count = text.count(OLD_I18N)
if count == 0:
    print("ERROR P3: no encuentro 'plan3.name':'Top' en i18n")
    sys.exit(1)
if count > 4:
    print(f"WARNING P3: 'plan3.name':'Top' aparece {count} veces (esperaba 4). Reemplazando todas.")

text = text.replace(OLD_I18N, NEW_I18N)
print(f"[3/3] i18n plan3.name: {count} ocurrencias 'Top' → 'Premium'")

# ─────────────────────────────────────────────────────────────────────────────
# Verificaciones extra: no dejamos referencias a "Top" colgando
# ─────────────────────────────────────────────────────────────────────────────
# Buscar otros restos que pudieran necesitar revisión manual
restos = []
for needle in ["plan=top", "data-plan=\"top\"", "'top'", "\"top\""]:
    n = text.count(needle)
    if n > 0:
        restos.append((needle, n))

# ─────────────────────────────────────────────────────────────────────────────
# Escritura
# ─────────────────────────────────────────────────────────────────────────────
new_raw = text.encode("utf-8", errors="surrogateescape")
HTML.write_bytes(new_raw)
size_after = len(new_raw)
delta = size_after - size_before
print(f"\nEscrito index.html: {size_before} → {size_after} bytes ({'+' if delta >= 0 else ''}{delta})")

print("\nVerificación rápida:")
for needle in ["'plan3.name':'Premium'", '>Premium<', '?plan=premium']:
    n = new_raw.count(needle.encode("utf-8"))
    print(f"  {needle:35s} → {n} ocurrencia(s)")

if restos:
    print("\nAvisos (posibles restos de 'top' a revisar manualmente más adelante):")
    for needle, n in restos:
        print(f"  '{needle}' → {n} ocurrencia(s)")
    print("  (Esto puede ser normal si hay scripts o referencias internas. NO bloqueante.)")

print("\nOK.")
