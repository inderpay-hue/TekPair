import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { COLORS } from './colors';

export const CTA: React.FC<{
  url?: string;
  suffix?: string;
  subtitle?: string;
  button?: string;
  primaryColor?: string;
  hideSubtitle?: boolean;
}> = ({
  url = 'tekpair',
  suffix = '.tech',
  subtitle = '',
  button = 'Empezar ahora →',
  primaryColor = COLORS.primary,
  hideSubtitle = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const urlSpring = spring({ frame, fps, config: { damping: 12, stiffness: 100 } });
  const urlScale = interpolate(urlSpring, [0, 1], [0.7, 1]);
  const urlOpacity = interpolate(urlSpring, [0, 1], [0, 1]);
  const subtitleSpring = spring({ frame: frame - 15, fps, config: { damping: 14 } });
  const buttonSpring = spring({ frame: frame - 30, fps, config: { damping: 12, stiffness: 100 } });
  const pulse = Math.sin((frame - 30) * 0.2) * 0.05 + 1;

  return (
    <AbsoluteFill style={{ background: COLORS.bg, justifyContent: 'center', alignItems: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30 }}>
        <div style={{ fontSize: 100, fontWeight: 800, color: COLORS.white, transform: `scale(${urlScale})`, opacity: urlOpacity, letterSpacing: -3 }}>
          {url}<span style={{ color: primaryColor }}>{suffix}</span>
        </div>
        {!hideSubtitle && subtitle && (
          <div style={{ fontSize: 36, color: COLORS.muted, opacity: subtitleSpring, transform: `translateY(${(1 - subtitleSpring) * 20}px)`, fontWeight: 500 }}>
            {subtitle}
          </div>
        )}
        <div style={{ marginTop: 40, padding: '24px 60px', background: primaryColor, borderRadius: 16, fontSize: 36, fontWeight: 700, color: COLORS.white, transform: `scale(${buttonSpring * pulse})`, opacity: buttonSpring, boxShadow: `0 10px 40px ${primaryColor}80` }}>
          {button}
        </div>
      </div>
    </AbsoluteFill>
  );
};
