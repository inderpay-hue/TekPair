import { AbsoluteFill, Sequence } from 'remotion';
import { HookProblem } from './scenes/HookProblem';
import { ScreenshotZoom } from './scenes/ScreenshotZoom';
import { CTA } from './scenes/CTA';
import { COLORS } from './scenes/colors';

export const CatalogoReel: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      <Sequence from={0} durationInFrames={90}>
        <HookProblem
          line1="Tu competencia"
          line2="tiene web."
          badge="¿Y tú?"
        />
      </Sequence>

      <Sequence from={90} durationInFrames={150}>
        <ScreenshotZoom
          image="10-catalogo.png"
          caption="Tu catálogo online en 1 clic"
          captionColor={COLORS.accent}
          zoomFrom={1.0}
          zoomTo={1.15}
          durationFrames={150}
        />
      </Sequence>

      <Sequence from={240} durationInFrames={120}>
        <ScreenshotZoom
          image="05-stock.png"
          caption="Conectado con tu stock real"
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
          button="Tu tienda en internet →"
          primaryColor={COLORS.primary}
          hideSubtitle={true}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
