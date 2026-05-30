import { AbsoluteFill, Sequence } from 'remotion';
import { HookProblem } from './scenes/HookProblem';
import { ScreenshotZoom } from './scenes/ScreenshotZoom';
import { CTA } from './scenes/CTA';
import { COLORS } from './scenes/colors';

export const CitasOnlineReel: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Sequence from={0} durationInFrames={90}>
        <HookProblem
          line1="Tu cliente llama."
          line2="No contestas."
          badge="Pierdes la cita"
        />
      </Sequence>

      <Sequence from={90} durationInFrames={150}>
        <ScreenshotZoom
          image="09-citas.png"
          caption="Tu agenda en línea 24/7"
          captionColor={COLORS.accent}
          zoomFrom={1.0}
          zoomTo={1.15}
          durationFrames={150}
        />
      </Sequence>

      <Sequence from={240} durationInFrames={120}>
        <ScreenshotZoom
          image="06-clientes.png"
          caption="Y guardas a cada cliente"
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
          button="Llena tu agenda hoy →"
          primaryColor={COLORS.primary}
          hideSubtitle={true}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
