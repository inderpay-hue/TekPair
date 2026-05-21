import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { COLORS } from './colors';

export const FeatureCard: React.FC<{ title: string; subtitle: string; bullets: string[]; primaryColor: string }> = ({ title, subtitle, bullets, primaryColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cardSpring = spring({ frame, fps, config: { damping: 14 } });
  const cardScale = interpolate(cardSpring, [0, 1], [0.85, 1]);
  const cardOpacity = interpolate(cardSpring, [0, 1], [0, 1]);
  const fadeOut = interpolate(frame, [260, 270], [1, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: COLORS.bg, justifyContent: 'center', alignItems: 'center', opacity: fadeOut, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: COLORS.bgLight, borderRadius: 24, padding: 60, width: 850, transform: `scale(${cardScale})`, opacity: cardOpacity, border: `2px solid ${COLORS.border}`, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ fontSize: 32, color: primaryColor, fontWeight: 700, marginBottom: 16 }}>{title}</div>
        <div style={{ fontSize: 56, color: COLORS.white, fontWeight: 800, marginBottom: 50, letterSpacing: -1 }}>{subtitle}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {bullets.map((b, i) => {
            const bs = spring({ frame: frame - 30 - i * 18, fps, config: { damping: 12, stiffness: 100 } });
            const tx = interpolate(bs, [0, 1], [-30, 0]);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 20, opacity: bs, transform: `translateX(${tx}px)`, fontSize: 32, color: COLORS.white }}>
                <div style={{ width: 40, height: 40, borderRadius: 20, background: `${primaryColor}25`, border: `2px solid ${primaryColor}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: primaryColor, fontWeight: 800, fontSize: 22, flexShrink: 0 }}>✓</div>
                <span>{b}</span>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
