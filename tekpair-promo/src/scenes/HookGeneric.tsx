import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { COLORS } from './colors';

export const HookGeneric: React.FC<{ line1: string; line2: string; primaryColor: string }> = ({ line1, line2, primaryColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeOut = interpolate(frame, [50, 60], [1, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: COLORS.bg, justifyContent: 'center', alignItems: 'center', opacity: fadeOut }}>
      <div style={{ textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap' }}>
          {line1.split('').map((char, i) => {
            const cs = spring({ frame: frame - i * 1.5, fps, config: { damping: 14, stiffness: 120 } });
            return <span key={i} style={{ fontSize: 80, fontWeight: 700, color: COLORS.white, opacity: cs, transform: `translateY(${(1 - cs) * 20}px)`, display: 'inline-block', whiteSpace: 'pre' }}>{char}</span>;
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          {line2.split('').map((char, i) => {
            const cs = spring({ frame: frame - i * 1.5 - 15, fps, config: { damping: 14, stiffness: 120 } });
            return <span key={i} style={{ fontSize: 80, fontWeight: 700, color: primaryColor, opacity: cs, transform: `translateY(${(1 - cs) * 20}px)`, display: 'inline-block', whiteSpace: 'pre' }}>{char}</span>;
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
