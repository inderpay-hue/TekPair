import { AbsoluteFill, Sequence } from 'remotion';
import { IntroLogo } from './scenes/IntroLogo';
import { Hook } from './scenes/Hook';
import { RepairOrder } from './scenes/RepairOrder';
import { TPVScene } from './scenes/TPVScene';
import { CalendarScene } from './scenes/CalendarScene';
import { CTA } from './scenes/CTA';

const TEKPAIR_PRIMARY = '#3B82F6';

export const TekPairPromo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: '#0F172A' }}>
      <Sequence from={0} durationInFrames={60}>
        <IntroLogo brand="TekPair" primaryColor={TEKPAIR_PRIMARY} />
      </Sequence>
      <Sequence from={60} durationInFrames={60}>
        <Hook />
      </Sequence>
      <Sequence from={120} durationInFrames={90}>
        <RepairOrder />
      </Sequence>
      <Sequence from={210} durationInFrames={90}>
        <TPVScene />
      </Sequence>
      <Sequence from={300} durationInFrames={90}>
        <CalendarScene />
      </Sequence>
      <Sequence from={390} durationInFrames={60}>
        <CTA url="tekpair" suffix=".tech" subtitle="Prueba gratis 15 días" button="Empezar ahora →" primaryColor={TEKPAIR_PRIMARY} />
      </Sequence>
    </AbsoluteFill>
  );
};
