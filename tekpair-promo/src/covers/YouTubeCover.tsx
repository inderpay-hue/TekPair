import { AbsoluteFill } from 'remotion';

export const YouTubeCover: React.FC = () => {
  const bg = '#0F172A';
  const primary = '#3B82F6';
  const muted = '#94A3B8';
  const card = '#1E293B';
  const border = '#334155';

  const sideItems = [
    { left: ['📱 TPV', '🔧 Reparaciones', '📦 Stock'] },
    { right: ['📅 Citas', '📊 Reportes', '🧾 Facturas'] },
  ];

  return (
    <AbsoluteFill style={{ background: bg, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Bloque central (zona segura) */}
      <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 36, maxWidth: '50%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <div style={{ width: 110, height: 110, background: primary, borderRadius: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 68 }}>⚡</div>
          <div style={{ fontSize: 80, fontWeight: 800, color: 'white', letterSpacing: -3 }}>
            tekpair<span style={{ color: primary }}>.tech</span>
          </div>
        </div>

        <div style={{ fontSize: 90, fontWeight: 800, color: 'white', lineHeight: 1.05, letterSpacing: -3.5 }}>
          El software que tu<br />
          <span style={{ color: primary }}>taller de reparación</span><br />
          necesitaba
        </div>

        <div style={{ fontSize: 32, color: muted, fontWeight: 500 }}>
          Tutoriales · Casos reales · Novedades
        </div>
      </div>

      {/* Columna izquierda */}
      <div style={{ position: 'absolute', left: '4%', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {sideItems[0].left.map((t) => (
          <div key={t} style={{ background: card, border: `2px solid ${border}`, padding: '24px 36px', borderRadius: 22, fontSize: 32, color: 'white', fontWeight: 600 }}>
            {t}
          </div>
        ))}
      </div>

      {/* Columna derecha */}
      <div style={{ position: 'absolute', right: '4%', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {sideItems[1].right.map((t) => (
          <div key={t} style={{ background: card, border: `2px solid ${border}`, padding: '24px 36px', borderRadius: 22, fontSize: 32, color: 'white', fontWeight: 600 }}>
            {t}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
