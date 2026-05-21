import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate, spring, staticFile } from 'remotion';
import { COLORS } from './colors';

type Props = {
  image: string;
  caption?: string;
  captionColor?: string;
  highlight?: { x: number; y: number; w: number; h: number } | null;
  zoomFrom?: number;
  zoomTo?: number;
  durationFrames?: number;
};

export const ScreenshotZoom: React.FC<Props> = ({
  image,
  caption,
  captionColor = COLORS.accent,
  highlight = null,
  zoomFrom = 1.0,
  zoomTo = 1.15,
  durationFrames = 150,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrySpring = spring({ frame, fps, config: { damping: 16 } });
  const opacity = interpolate(entrySpring, [0, 1], [0, 1]);
  const fadeOut = interpolate(frame, [durationFrames - 10, durationFrames], [1, 0], { extrapolateRight: 'clamp' });
  const zoom = interpolate(frame, [0, durationFrames], [zoomFrom, zoomTo]);
  const pulse = Math.sin(frame * 0.15) * 0.08 + 1;
  const captionSpring = spring({ frame: frame - 25, fps, config: { damping: 14 } });

  return (
    <AbsoluteFill style={{ background: COLORS.bg, opacity: fadeOut, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity, transform: `scale(${zoom})` }}>
        <Img src={staticFile(image)} style={{ width: '95%', maxHeight: '85%', objectFit: 'contain', borderRadius: 20, boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }} />
      </div>
      {highlight && (
        <div style={{ position: 'absolute', left: `${highlight.x}%`, top: `${highlight.y}%`, width: `${highlight.w}%`, height: `${highlight.h}%`, border: `4px solid ${COLORS.accent}`, borderRadius: 12, boxShadow: `0 0 0 6px ${COLORS.accent}40`, transform: `scale(${pulse})`, opacity }} />
      )}
      {caption && (
        <div style={{ position: 'absolute', bottom: 120, left: 0, right: 0, textAlign: 'center', opacity: captionSpring, transform: `translateY(${(1 - captionSpring) * 30}px)` }}>
          <div style={{ display: 'inline-block', background: captionColor, color: COLORS.white, fontSize: 56, fontWeight: 800, padding: '20px 40px', borderRadius: 16, boxShadow: `0 10px 40px ${captionColor}80`, maxWidth: '85%', lineHeight: 1.15 }}>
            {caption}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
