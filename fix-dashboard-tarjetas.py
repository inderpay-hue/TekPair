#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix-dashboard-tarjetas.py
Mejora visual de las tarjetas del dashboard: esquinas mas redondeadas,
sombras con mas profundidad y un efecto de elevacion al pasar el raton.

SEGURO Y REVERSIBLE:
- Hace una copia de seguridad automatica antes de tocar nada.
- NO reescribe ni toca el CSS existente: solo AÑADE un bloque nuevo al final
  del <style>, que sobreescribe los estilos de .card con !important.
- NO toca ninguna logica, id, funcion ni texto.
- Si el bloque ya existe (por ejecutarlo dos veces), lo reemplaza, no lo duplica.

USO:
    python3 fix-dashboard-tarjetas.py

Para REVERTIR si algo no te gusta:
    cp dashboard.html.bak-pre-tarjetas dashboard.html
"""

import shutil, sys, os, re

ARCHIVO = "dashboard.html"
BACKUP  = "dashboard.html.bak-pre-tarjetas"
MARCA_INI = "/* === MEJORA TARJETAS (fix-dashboard-tarjetas) === */"
MARCA_FIN = "/* === FIN MEJORA TARJETAS === */"

BLOQUE = MARCA_INI + """
.card{
  border-radius:18px !important;
  box-shadow:0 4px 16px -4px rgba(2,11,46,.10), 0 2px 6px -2px rgba(2,11,46,.06) !important;
  border:1px solid rgba(226,232,240,.7) !important;
  transition:transform .22s cubic-bezier(.2,.7,.2,1), box-shadow .22s cubic-bezier(.2,.7,.2,1) !important;
}
.card:hover{
  transform:translateY(-3px) !important;
  box-shadow:0 18px 40px -12px rgba(2,11,46,.18), 0 6px 14px -6px rgba(2,11,46,.10) !important;
}
@media(prefers-reduced-motion:reduce){
  .card{transition:none !important}
  .card:hover{transform:none !important}
}
""" + MARCA_FIN

def main():
    if not os.path.exists(ARCHIVO):
        print("ERROR: No encuentro %s en esta carpeta." % ARCHIVO)
        print("Ejecuta el script dentro de /Users/macbook/Downloads/tekpair2")
        sys.exit(1)

    with open(ARCHIVO, "r", encoding="utf-8") as f:
        contenido = f.read()

    # Backup
    shutil.copy2(ARCHIVO, BACKUP)
    print("Backup creado: %s" % BACKUP)

    # Si ya existe el bloque (ejecucion previa), lo quitamos para no duplicar
    if MARCA_INI in contenido:
        contenido = re.sub(
            re.escape(MARCA_INI) + r".*?" + re.escape(MARCA_FIN),
            "", contenido, flags=re.DOTALL
        )
        print("Bloque anterior detectado y reemplazado (no se duplica).")

    # Insertar el bloque justo antes del primer </style>
    idx = contenido.find("</style>")
    if idx == -1:
        print("ERROR: No encuentro la etiqueta </style>. No se ha modificado nada.")
        os.remove(BACKUP)
        sys.exit(1)

    contenido = contenido[:idx] + "\n" + BLOQUE + "\n" + contenido[idx:]

    with open(ARCHIVO, "w", encoding="utf-8") as f:
        f.write(contenido)

    print("")
    print("LISTO. Tarjetas mejoradas (esquinas 18px + sombra con profundidad + hover).")
    print("")
    print("AHORA:")
    print("  1. Abre el dashboard y revisa varias pantallas (inicio, reparaciones, stock).")
    print("  2. Si te gusta -> subelo con git.")
    print("  3. Si NO te gusta -> revierte con:")
    print("        cp %s %s" % (BACKUP, ARCHIVO))

if __name__ == "__main__":
    main()
