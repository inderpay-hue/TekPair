#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix-dashboard-naranja.py
Cambia la identidad de marca del dashboard de AZUL (#0055FF) a NARANJA (#FF5B1F).

SEGURO Y REVERSIBLE:
- Hace una copia de seguridad automatica antes de tocar nada.
- Solo reemplaza CODIGOS DE COLOR exactos. NO toca ninguna logica, id, funcion ni texto.
- Respeta el naranja de ESTADO (#F97316), que NO se toca.
- Respeta tambien el azul oscuro de fondo (--dark:#020B2E), que se mantiene como esta.

USO:
    python3 fix-dashboard-naranja.py

Para REVERTIR si algo no te gusta:
    cp dashboard.html.bak-pre-naranja dashboard.html
"""

import re, shutil, sys, os

ARCHIVO = "dashboard.html"
BACKUP  = "dashboard.html.bak-pre-naranja"

# --- Mapa de reemplazos de color (azul de marca -> naranja de marca) ---
# Solo se tocan estos valores exactos. El naranja de estado #F97316 NO esta aqui.
REEMPLAZOS = [
    # Hex del azul de marca, en mayusculas y minusculas
    ("#0055FF", "#FF5B1F"),
    ("#0055ff", "#FF5B1F"),
    ("0055FF",  "FF5B1F"),   # por si aparece sin # (gradientes, etc.)
    ("0055ff",  "FF5B1F"),
    # Version RGB del azul de marca: 0,85,255 -> 255,91,31 (naranja)
    ("0, 85, 255", "255, 91, 31"),
    ("0,85,255",   "255,91,31"),
    ("0 85 255",   "255 91 31"),
]

def main():
    if not os.path.exists(ARCHIVO):
        print("ERROR: No encuentro %s en esta carpeta." % ARCHIVO)
        print("Ejecuta el script dentro de /Users/macbook/Downloads/tekpair2")
        sys.exit(1)

    # 1) Backup
    shutil.copy2(ARCHIVO, BACKUP)
    print("Backup creado: %s" % BACKUP)

    # 2) Leer
    with open(ARCHIVO, "r", encoding="utf-8") as f:
        contenido = f.read()
    original = contenido

    # 3) Reemplazos + conteo
    total = 0
    for viejo, nuevo in REEMPLAZOS:
        n = contenido.count(viejo)
        if n:
            contenido = contenido.replace(viejo, nuevo)
            total += n
            print("  %-14s -> %-12s  (%d sustituciones)" % (viejo, nuevo, n))

    if contenido == original:
        print("No se encontro ningun color azul de marca. Nada que cambiar.")
        os.remove(BACKUP)
        return

    # 4) Guardar
    with open(ARCHIVO, "w", encoding="utf-8") as f:
        f.write(contenido)

    print("")
    print("LISTO. %d sustituciones de color en total." % total)
    print("El dashboard ahora usa NARANJA de marca (#FF5B1F).")
    print("")
    print("AHORA:")
    print("  1. Abre el dashboard y revisalo en modo CLARO y OSCURO.")
    print("  2. Si te gusta -> subelo con git.")
    print("  3. Si NO te gusta -> revierte con:")
    print("        cp %s %s" % (BACKUP, ARCHIVO))

if __name__ == "__main__":
    main()
