import { AbsoluteFill, Sequence } from 'remotion';
import { HookProblem } from './scenes/HookProblem';
import { ScreenshotZoom } from './scenes/ScreenshotZoom';
import { CTA } from './scenes/CTA';
import { COLORS } from './scenes/colors';

export const CobrosReel: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Sequence from={0} durationInFrames={90}>
        <HookProblem
          line1="Reparaciones cobradas..."
          line2="¿o no?"
          badge="Pierdes dinero"
        />
      </Sequence>

      <Sequence from={90} durationInFrames={150}>
        <ScreenshotZoom
          image="01-dashboard.png"
          caption="Cobros pendientes a la vista"
          captionColor={COLORS.accent}
          zoomFrom={1.0}
          zoomTo={1.15}
          durationFrames={150}
        />
      </Sequence>

      <Sequence from={240} durationInFrames={120}>
        <ScreenshotZoom
          image="11-reportes.png"
          caption="Sabes exactamente qué te deben"
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
          button="Recupera ese dinero →"
          primaryColor={COLORS.primary}
          hideSubtitle={true}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
