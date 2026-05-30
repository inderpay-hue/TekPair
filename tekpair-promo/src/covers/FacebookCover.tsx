import { AbsoluteFill } from 'remotion';

export const FacebookCover: React.FC = () => {
  const bg = '#0F172A';
  const primary = '#3B82F6';
  const muted = '#94A3B8';
  const card = '#1E293B';
  const border = '#334155';

  return (
    <AbsoluteFill style={{ background: bg, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Bloque izquierdo */}
      <div style={{ position: 'absolute', left: '6%', top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 28, maxWidth: '55%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ width: 90, height: 90, background: primary, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 52 }}>⚡</div>
          <div style={{ fontSize: 60, fontWeight: 800, color: 'white', letterSpacing: -2 }}>
            tekpair<span style={{ color: primary }}>.tech</span>
          </div>
        </div>

        <div style={{ fontSize: 70, fontWeight: 800, color: 'white', lineHeight: 1.1, letterSpacing: -2.5 }}>
          Software de gestión<br />
          para <span style={{ color: primary }}>talleres de reparación</span>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
          {['Reparaciones', 'TPV', 'Stock', 'Citas', 'Facturas'].map((t) => (
            <div key={t} style={{ background: 'rgba(59,130,246,0.15)', border: `2px solid ${primary}`, padding: '10px 22px', borderRadius: 999, fontSize: 22, color: '#93C5FD', fontWeight: 600 }}>
              {t}
            </div>
          ))}
        </div>
      </div>

      {/* Bloque derecho: 2 cards mockup */}
      <div style={{ position: 'absolute', right: '5%', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 30 }}>
        {/* Card reparaciones */}
        <div style={{ width: 280, height: 380, background: card, border: `2px solid ${border}`, borderRadius: 28, padding: 22, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 30px 80px rgba(0,0,0,0.6)', transform: 'rotate(-5deg)' }}>
          <div style={{ fontSize: 16, color: muted, fontWeight: 600 }}>Reparaciones</div>
          {[
            { name: 'iPhone 14 Pro', state: '✓ Reparado', color: '#10B981' },
            { name: 'Samsung A54', state: 'En proceso', color: primary },
            { name: 'Xiaomi Redmi', state: 'Pendiente', color: '#F59E0B' },
          ].map((r, i) => (
            <div key={i} style={{ background: `${r.color}25`, borderLeft: `4px solid ${r.color}`, padding: '12px 14px', borderRadius: 8 }}>
              <div style={{ fontSize: 16, color: 'white', fontWeight: 600 }}>{r.name}</div>
              <div style={{ fontSize: 14, color: r.color, marginTop: 2 }}>{r.state}</div>
            </div>
          ))}
        </div>

        {/* Card dashboard */}
        <div style={{ width: 280, height: 380, background: card, border: `2px solid ${border}`, borderRadius: 28, padding: 22, display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 30px 80px rgba(0,0,0,0.6)', transform: 'rotate(5deg)' }}>
          <div style={{ fontSize: 16, color: muted, fontWeight: 600 }}>Hoy</div>
          <div style={{ background: 'rgba(16,185,129,0.1)', padding: 16, borderRadius: 10, borderLeft: '4px solid #10B981' }}>
            <div style={{ fontSize: 34, fontWeight: 800, color: '#10B981' }}>€1.889</div>
            <div style={{ fontSize: 14, color: muted, marginTop: 2 }}>Ingresos</div>
          </div>
          <div style={{ background: 'rgba(139,92,246,0.1)', padding: 16, borderRadius: 10, borderLeft: '4px solid #8B5CF6' }}>
            <div style={{ fontSize: 34, fontWeight: 800, color: '#A78BFA' }}>€2.149</div>
            <div style={{ fontSize: 14, color: muted, marginTop: 2 }}>Total</div>
          </div>
          <div style={{ marginTop: 'auto', fontSize: 14, color: muted, textAlign: 'center', fontWeight: 600 }}>
            ✓ Cumple RDL 7/2024
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
