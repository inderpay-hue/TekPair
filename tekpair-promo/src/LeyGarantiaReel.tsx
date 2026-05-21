import { AbsoluteFill, Sequence } from 'remotion';
import { HookProblem } from './scenes/HookProblem';
import { ScreenshotZoom } from './scenes/ScreenshotZoom';
import { CTA } from './scenes/CTA';
import { COLORS } from './scenes/colors';

export const LeyGarantiaReel: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Sequence from={0} durationInFrames={90}>
        <HookProblem
          line1="3 años de garantía."
          line2="¿Lo cumples?"
          badge="RDL 7/2024"
        />
      </Sequence>

      <Sequence from={90} durationInFrames={150}>
        <ScreenshotZoom
          image="12-ajustes.png"
          caption="Configurado por ti"
          captionColor={COLORS.accent}
          zoomFrom={1.0}
          zoomTo={1.12}
          durationFrames={150}
        />
      </Sequence>

      <Sequence from={240} durationInFrames={120}>
        <ScreenshotZoom
          image="16-anadir-stock.png"
          caption="Garantía legal automática"
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
