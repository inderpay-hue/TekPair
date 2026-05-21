import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { COLORS } from './colors';

const PRODUCTOS = [
  { nombre: 'Cristal templado', precio: 9.99 },
  { nombre: 'Funda silicona', precio: 14.99 },
  { nombre: 'Cargador USB-C', precio: 19.99 },
  { nombre: 'Batería iPhone', precio: 39.99 },
];

export const TPVScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const containerSpring = spring({ frame, fps, config: { damping: 14 } });
  const opacity = interpolate(containerSpring, [0, 1], [0, 1]);
  const fadeOut = interpolate(frame, [80, 90], [1, 0], { extrapolateRight: 'clamp' });
  const totalAnimated = interpolate(frame, [50, 80], [0, 84.96], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: COLORS.bg, justifyContent: 'center', alignItems: 'center', opacity: opacity * fadeOut, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ position: 'absolute', top: 80, fontSize: 36, color: COLORS.muted, fontWeight: 600 }}>TPV integrado</div>
      <div style={{ display: 'flex', gap: 30, alignItems: 'flex-start' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, width: 480 }}>
          {PRODUCTOS.map((p, i) => {
            const ps = spring({ frame: frame - i * 8 - 10, fps, config: { damping: 12, stiffness: 100 } });
            const productScale = interpolate(ps, [0, 1], [0.5, 1]);
            const productOpacity = interpolate(ps, [0, 1], [0, 1]);
            return (
              <div key={i} style={{ background: COLORS.bgLight, border: `2px solid ${COLORS.border}`, borderRadius: 16, padding: 24, transform: `scale(${productScale})`, opacity: productOpacity }}>
                <div style={{ fontSize: 22, color: COLORS.white, fontWeight: 600, marginBottom: 10 }}>{p.nombre}</div>
                <div style={{ fontSize: 28, color: COLORS.primary, fontWeight: 700 }}>{p.precio}€</div>
              </div>
            );
          })}
        </div>
        <div style={{ background: COLORS.bgLight, border: `2px solid ${COLORS.border}`, borderRadius: 16, padding: 30, width: 360 }}>
          <div style={{ fontSize: 26, color: COLORS.muted, marginBottom: 20, fontWeight: 600 }}>Ticket #0892</div>
          {PRODUCTOS.map((p, i) => {
            const itemFrame = i * 8 + 15;
            if (frame < itemFrame) return null;
            const its = spring({ frame: frame - itemFrame, fps, config: { damping: 12 } });
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontSize: 20, opacity: its, transform: `translateX(${(1 - its) * 20}px)` }}>
                <span style={{ color: COLORS.white }}>{p.nombre}</span>
                <span style={{ color: COLORS.muted }}>{p.precio}€</span>
              </div>
            );
          })}
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: `2px dashed ${COLORS.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 26, color: COLORS.white, fontWeight: 700 }}>TOTAL</span>
            <span style={{ fontSize: 36, color: COLORS.accent, fontWeight: 800 }}>{totalAnimated.toFixed(2)}€</span>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
