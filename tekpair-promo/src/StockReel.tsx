import { AbsoluteFill, Sequence } from 'remotion';
import { HookProblem } from './scenes/HookProblem';
import { ScreenshotZoom } from './scenes/ScreenshotZoom';
import { CTA } from './scenes/CTA';
import { COLORS } from './scenes/colors';

export const StockReel: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Sequence from={0} durationInFrames={90}>
        <HookProblem
          line1="Cliente entra."
          line2="¿Tienes la pieza?"
          badge="Mejor saberlo ya"
        />
      </Sequence>

      <Sequence from={90} durationInFrames={150}>
        <ScreenshotZoom
          image="05-stock.png"
          caption="Stock en tiempo real"
          captionColor={COLORS.accent}
          zoomFrom={1.0}
          zoomTo={1.12}
          durationFrames={150}
        />
      </Sequence>

      <Sequence from={240} durationInFrames={120}>
        <ScreenshotZoom
          image="15-importar-pdf.png"
          caption="Sube el PDF. Listo."
          captionColor={COLORS.primary}
          zoomFrom={1.05}
          zoomTo={1.18}
          durationFrames={120}
        />
      </Sequence>

      <Sequence from={360} durationInFrames={90}>
        <CTA
          url="tekpair"
          suffix=".tech"
          subtitle="Prueba gratis 15 días"
          button="Empezar ahora →"
          primaryColor={COLORS.primary}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
