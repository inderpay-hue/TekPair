import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { COLORS } from './colors';

type Props = {
  line1: string;
  line2: string;
  badge?: string;
  badgeColor?: string;
};

export const HookProblem: React.FC<Props> = ({ line1, line2, badge, badgeColor = COLORS.danger }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeOut = interpolate(frame, [80, 90], [1, 0], { extrapolateRight: 'clamp' });

  const line1Spring = spring({ frame, fps, config: { damping: 14 } });
  const line2Spring = spring({ frame: frame - 15, fps, config: { damping: 14 } });
  const badgeSpring = spring({ frame: frame - 40, fps, config: { damping: 10, stiffness: 120 } });
  const badgePulse = Math.sin((frame - 40) * 0.2) * 0.05 + 1;

  return (
    <AbsoluteFill style={{ background: COLORS.bg, justifyContent: 'center', alignItems: 'center', opacity: fadeOut, fontFamily: 'system-ui, sans-serif', padding: 80 }}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        <div style={{ fontSize: 96, fontWeight: 800, color: COLORS.white, opacity: line1Spring, transform: `translateY(${(1 - line1Spring) * 30}px)`, lineHeight: 1.1, letterSpacing: -2 }}>
          {line1}
        </div>
        <div style={{ fontSize: 96, fontWeight: 800, color: badgeColor, opacity: line2Spring, transform: `translateY(${(1 - line2Spring) * 30}px)`, lineHeight: 1.1, letterSpacing: -2 }}>
          {line2}
        </div>
        {badge && (
          <div style={{ marginTop: 50, display: 'inline-block', background: `${badgeColor}25`, border: `4px solid ${badgeColor}`, borderRadius: 24, padding: '24px 50px', fontSize: 56, fontWeight: 800, color: badgeColor, opacity: badgeSpring, transform: `scale(${badgeSpring * badgePulse})` }}>
            {badge}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
