import { AbsoluteFill, Sequence } from 'remotion';
import { HookProblem } from './scenes/HookProblem';
import { ScreenshotZoom } from './scenes/ScreenshotZoom';
import { CTA } from './scenes/CTA';
import { COLORS } from './scenes/colors';

export const PlantillasReel: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Sequence from={0} durationInFrames={90}>
        <HookProblem
          line1="Pantalla rota."
          line2="Otra vez."
          badge="1 toque y listo"
        />
      </Sequence>

      <Sequence from={90} durationInFrames={150}>
        <ScreenshotZoom
          image="08-nueva-reparacion.png"
          caption="Plantillas listas para usar"
          captionColor={COLORS.accent}
          zoomFrom={1.0}
          zoomTo={1.15}
          durationFrames={150}
        />
      </Sequence>

      <Sequence from={240} durationInFrames={120}>
        <ScreenshotZoom
          image="03-reparaciones.png"
          caption="Orden creada en 10 segundos"
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
          button="Crea tu primera orden →"
          primaryColor={COLORS.primary}
          hideSubtitle={true}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
