#!/bin/bash
mkdir -p out
echo "🎬 Renderizando los 15 reels..."

for reel in AdiosLibreta SabesQueGanas Facturas Stock LeyGarantia; do
  for formato in Vertical Cuadrado Horizontal; do
    echo "▶️  $reel-$formato..."
    npx remotion render "$reel-$formato" "out/$(echo $reel | tr '[:upper:]' '[:lower:]')-$(echo $formato | tr '[:upper:]' '[:lower:]').mp4"
  done
done

echo "✅ Listo! Los 15 videos están en ./out/"
