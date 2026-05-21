import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { COLORS } from './colors';

const Row: React.FC<{ label: string; value: string; highlight?: boolean }> = ({ label, value, highlight }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0', fontSize: 26 }}>
    <span style={{ color: COLORS.muted }}>{label}</span>
    <span style={{ color: highlight ? COLORS.accent : COLORS.white, fontWeight: highlight ? 700 : 500 }}>{value}</span>
  </div>
);

export const RepairOrder: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cardSpring = spring({ frame, fps, config: { damping: 14 } });
  const cardScale = interpolate(cardSpring, [0, 1], [0.85, 1]);
  const cardOpacity = interpolate(cardSpring, [0, 1], [0, 1]);
  const fadeOut = interpolate(frame, [80, 90], [1, 0], { extrapolateRight: 'clamp' });

  let estado = 'Pendiente';
  let estadoColor = COLORS.warning;
  if (frame >= 55) { estado = 'Reparado'; estadoColor = COLORS.accent; }
  else if (frame >= 30) { estado = 'En proceso'; estadoColor = COLORS.primary; }

  const checkmarkScale = spring({ frame: frame - 55, fps, config: { damping: 8, stiffness: 120 } });

  return (
    <AbsoluteFill style={{ background: COLORS.bg, justifyContent: 'center', alignItems: 'center', opacity: fadeOut, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ position: 'absolute', top: 80, fontSize: 36, color: COLORS.muted, fontWeight: 600, opacity: cardOpacity }}>Órdenes de reparación</div>
      <div style={{ background: COLORS.bgLight, borderRadius: 24, padding: 50, width: 800, transform: `scale(${cardScale})`, opacity: cardOpacity, border: `2px solid ${COLORS.border}`, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
          <div>
            <div style={{ fontSize: 28, color: COLORS.muted, marginBottom: 8 }}>Orden #1247</div>
            <div style={{ fontSize: 42, color: COLORS.white, fontWeight: 700 }}>iPhone 14 Pro</div>
          </div>
          <div style={{ padding: '14px 28px', background: `${estadoColor}25`, border: `2px solid ${estadoColor}`, borderRadius: 14, color: estadoColor, fontSize: 26, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
            {estado === 'Reparado' && <div style={{ transform: `scale(${checkmarkScale})` }}>✓</div>}
            {estado}
          </div>
        </div>
        <div style={{ marginTop: 30, paddingTop: 30, borderTop: `1px solid ${COLORS.border}` }}>
          <Row label="Cliente" value="María González" />
          <Row label="Avería" value="Pantalla rota" />
          <Row label="Pieza" value="Display OLED + cristal" />
          <Row label="Total" value="189,00 €" highlight />
        </div>
      </div>
    </AbsoluteFill>
  );
};
