import { AbsoluteFill, Sequence } from 'remotion';
import { HookProblem } from './scenes/HookProblem';
import { ScreenshotZoom } from './scenes/ScreenshotZoom';
import { CTA } from './scenes/CTA';
import { AnimatedSubtitles, SubtitleChunk } from './scenes/AnimatedSubtitles';
import { COLORS } from './scenes/colors';

const SUBTITLES: SubtitleChunk[] = [
  { text: '¿Sigues',           startFrame: 5,   durationFrames: 80 },
  { text: 'apuntando',         startFrame: 15,  durationFrames: 70 },
  { text: 'reparaciones',      startFrame: 28,  durationFrames: 60 },
  { text: 'en una',            startFrame: 45,  durationFrames: 45 },
  { text: 'LIBRETA?',          startFrame: 55,  durationFrames: 40, highlight: COLORS.danger },

  { text: 'Con',               startFrame: 95,  durationFrames: 50 },
  { text: 'TekPair',           startFrame: 105, durationFrames: 50, highlight: COLORS.primary },
  { text: 'todo',              startFrame: 130, durationFrames: 50 },
  { text: 'controlado',        startFrame: 145, durationFrames: 50 },

  { text: 'Y creas',           startFrame: 245, durationFrames: 50 },
  { text: 'una orden',         startFrame: 265, durationFrames: 50 },
  { text: 'en 30 SEGUNDOS',    startFrame: 290, durationFrames: 70, highlight: COLORS.accent },

  { text: 'tekpair.tech',      startFrame: 365, durationFrames: 80, highlight: COLORS.primary },
];

export const AdiosLibretaReel: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Sequence from={0} durationInFrames={90}>
        <HookProblem
          line1="¿Sigues apuntando reparaciones"
          line2="en una libreta?"
          badge="Pierdes dinero"
        />
      </Sequence>

      <Sequence from={90} durationInFrames={150}>
        <ScreenshotZoom
          image="03-reparaciones.png"
          caption="Todo controlado ✓"
          captionColor={COLORS.accent}
          zoomFrom={1.0}
          zoomTo={1.12}
          durationFrames={150}
        />
      </Sequence>

      <Sequence from={240} durationInFrames={120}>
        <ScreenshotZoom
          image="08-nueva-reparacion.png"
          caption="En 30 segundos"
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

      <AnimatedSubtitles chunks={SUBTITLES} position="bottom" size={64} />
    </AbsoluteFill>
  );
};
