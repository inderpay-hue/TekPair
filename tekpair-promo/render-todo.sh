#!/bin/bash
rm -rf out
mkdir -p out

echo "🎬 Renderizando todos los videos..."

npx remotion render TekPairPromo out/00-tekpair-promo.mp4

for reel in TPV Ordenes Citas Stock Multitienda Trial; do
  nombre=$(echo $reel | tr '[:upper:]' '[:lower:]')
  npx remotion render "Reel-$reel" "out/feature-$nombre.mp4"
done

for reel in AdiosLibreta SabesQueGanas Facturas Stock LeyGarantia Cobros PDF Plantillas CitasOnline Catalogo; do
  for formato in Vertical Cuadrado Horizontal; do
    nombre=$(echo $reel | tr '[:upper:]' '[:lower:]')-$(echo $formato | tr '[:upper:]' '[:lower:]')
    echo "▶️  $reel-$formato"
    npx remotion render "$reel-$formato" "out/$nombre.mp4"
  done
done

echo "✅ Listo! Videos en ./out/"
ls -lh out/
