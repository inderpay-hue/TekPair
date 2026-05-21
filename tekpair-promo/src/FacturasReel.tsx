import { AbsoluteFill, Sequence } from 'remotion';
import { HookProblem } from './scenes/HookProblem';
import { ScreenshotZoom } from './scenes/ScreenshotZoom';
import { CTA } from './scenes/CTA';
import { COLORS } from './scenes/colors';

export const FacturasReel: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Sequence from={0} durationInFrames={90}>
        <HookProblem
          line1="¿Haces facturas"
          line2="en Word?"
          badge="Pierdes 10 min cada una"
        />
      </Sequence>

      <Sequence from={90} durationInFrames={150}>
        <ScreenshotZoom
          image="04-facturas.png"
          caption="Todas tus facturas"
          captionColor={COLORS.accent}
          zoomFrom={1.0}
          zoomTo={1.12}
          durationFrames={150}
        />
      </Sequence>

      <Sequence from={240} durationInFrames={120}>
        <ScreenshotZoom
          image="07-nueva-venta.png"
          caption="En 1 clic. PDF listo."
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
