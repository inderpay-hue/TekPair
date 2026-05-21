import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { COLORS } from './colors';

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie'];
const HORAS = ['09:00', '10:00', '11:00', '12:00', '13:00'];
const CITAS = [
  { dia: 0, hora: 1, cliente: 'Carlos M.', servicio: 'Pantalla', color: COLORS.primary },
  { dia: 1, hora: 0, cliente: 'Ana R.', servicio: 'Batería', color: COLORS.accent },
  { dia: 2, hora: 2, cliente: 'Juan P.', servicio: 'Diagnóstico', color: COLORS.warning },
  { dia: 3, hora: 1, cliente: 'Laura S.', servicio: 'Cristal', color: COLORS.primary },
  { dia: 4, hora: 3, cliente: 'Pedro G.', servicio: 'Reparación', color: COLORS.accent },
];

export const CalendarScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, 15], [0, 1]);
  const fadeOut = interpolate(frame, [80, 90], [1, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ background: COLORS.bg, justifyContent: 'center', alignItems: 'center', opacity: opacity * fadeOut, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ position: 'absolute', top: 80, fontSize: 36, color: COLORS.muted, fontWeight: 600 }}>Gestión de citas</div>
      <div style={{ background: COLORS.bgLight, borderRadius: 20, padding: 30, border: `2px solid ${COLORS.border}` }}>
        <div style={{ display: 'grid', gridTemplateColumns: '90px repeat(5, 140px)', gap: 8, marginBottom: 12 }}>
          <div />
          {DIAS.map((dia) => (
            <div key={dia} style={{ fontSize: 24, color: COLORS.white, fontWeight: 700, textAlign: 'center', padding: 12 }}>{dia}</div>
          ))}
        </div>
        {HORAS.map((hora, hIdx) => (
          <div key={hora} style={{ display: 'grid', gridTemplateColumns: '90px repeat(5, 140px)', gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 20, color: COLORS.muted, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 12 }}>{hora}</div>
            {DIAS.map((_, dIdx) => {
              const cita = CITAS.find((c) => c.dia === dIdx && c.hora === hIdx);
              const citaIdx = CITAS.findIndex((c) => c === cita);
              const citaSpring = cita ? spring({ frame: frame - 20 - citaIdx * 10, fps, config: { damping: 12, stiffness: 100 } }) : 0;
              return (
                <div key={dIdx} style={{ height: 70, background: cita ? `${cita.color}25` : 'transparent', border: cita ? `2px solid ${cita.color}` : `1px solid ${COLORS.border}`, borderRadius: 10, padding: 8, transform: cita ? `scale(${citaSpring})` : 'scale(1)', opacity: cita ? citaSpring : 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  {cita && (
                    <>
                      <div style={{ fontSize: 16, color: COLORS.white, fontWeight: 700 }}>{cita.cliente}</div>
                      <div style={{ fontSize: 14, color: cita.color, fontWeight: 600 }}>{cita.servicio}</div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
