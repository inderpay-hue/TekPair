import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { COLORS } from './colors';

export type SubtitleChunk = {
  text: string;
  startFrame: number;
  durationFrames: number;
  highlight?: string;
};

type Props = {
  chunks: SubtitleChunk[];
  position?: 'top' | 'bottom' | 'center';
  size?: number;
};

export const AnimatedSubtitles: React.FC<Props> = ({ chunks, position = 'bottom', size = 72 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const positionStyle: React.CSSProperties = position === 'bottom'
    ? { bottom: 200, left: 60, right: 60 }
    : position === 'top'
    ? { top: 200, left: 60, right: 60 }
    : { top: '50%', left: 60, right: 60, transform: 'translateY(-50%)' };

  return (
    <AbsoluteFill style={{ pointerEvents: 'none', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ position: 'absolute', ...positionStyle, textAlign: 'center', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
        {chunks.map((chunk, i) => {
          const localFrame = frame - chunk.startFrame;
          if (localFrame < 0 || localFrame > chunk.durationFrames + 10) return null;
          const wordSpring = spring({ frame: localFrame, fps, config: { damping: 10, stiffness: 180 } });
          const scale = interpolate(wordSpring, [0, 1], [0.5, 1]);
          const opacity = interpolate(wordSpring, [0, 1], [0, 1]);
          const isHighlighted = !!chunk.highlight;
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                fontSize: size,
                fontWeight: 900,
                color: isHighlighted ? COLORS.bg : COLORS.white,
                background: isHighlighted ? chunk.highlight : 'transparent',
                padding: isHighlighted ? '8px 20px' : '0',
                borderRadius: 14,
                transform: `scale(${scale})`,
                opacity,
                textShadow: isHighlighted ? 'none' : `4px 4px 0 ${COLORS.bg}, -2px -2px 0 ${COLORS.bg}, 2px -2px 0 ${COLORS.bg}, -2px 2px 0 ${COLORS.bg}`,
                lineHeight: 1.1,
                letterSpacing: -1,
              }}
            >
              {chunk.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
