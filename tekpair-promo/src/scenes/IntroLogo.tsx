import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { COLORS } from './colors';

export const IntroLogo: React.FC<{ brand?: string; primaryColor?: string }> = ({
  brand = 'TekPair',
  primaryColor = COLORS.primary,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const letters = brand.split('');
  const fadeOut = interpolate(frame, [45, 60], [1, 0], { extrapolateRight: 'clamp' });
  const toolRotation = interpolate(frame, [0, 45], [-180, 0], { extrapolateRight: 'clamp' });
  const toolScale = spring({ frame, fps, config: { damping: 10, stiffness: 80 } });
  const splitPoint = Math.ceil(letters.length / 2);

  return (
    <AbsoluteFill style={{ background: COLORS.bg, justifyContent: 'center', alignItems: 'center', opacity: fadeOut }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30 }}>
        <div style={{ transform: `rotate(${toolRotation}deg) scale(${toolScale})`, width: 140, height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="140" height="140" viewBox="0 0 24 24" fill="none">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke={primaryColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {letters.map((letter, i) => {
            const ls = spring({ frame: frame - i * 3 - 10, fps, config: { damping: 12, stiffness: 100 } });
            const y = interpolate(ls, [0, 1], [50, 0]);
            const opacity = interpolate(ls, [0, 1], [0, 1]);
            return (
              <span key={i} style={{ fontSize: 110, fontWeight: 800, color: i < splitPoint ? COLORS.white : primaryColor, fontFamily: 'system-ui, -apple-system, sans-serif', transform: `translateY(${y}px)`, opacity, letterSpacing: -2 }}>
                {letter}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
