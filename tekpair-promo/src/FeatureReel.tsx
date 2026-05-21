import { AbsoluteFill, Sequence } from 'remotion';
import { IntroLogo } from './scenes/IntroLogo';
import { HookGeneric } from './scenes/HookGeneric';
import { FeatureCard } from './scenes/FeatureCard';
import { CTA } from './scenes/CTA';

export type ReelProps = {
  brand: string;
  brandSuffix: string;
  primaryColor: string;
  hookLine1: string;
  hookLine2: string;
  featureTitle: string;
  featureSubtitle: string;
  featureBullets: string[];
  ctaUrl: string;
  ctaSubtitle: string;
  ctaButton: string;
};

export const FeatureReel: React.FC<ReelProps> = (props) => {
  const {
    brand, brandSuffix, primaryColor,
    hookLine1, hookLine2,
    featureTitle, featureSubtitle, featureBullets,
    ctaUrl, ctaSubtitle, ctaButton,
  } = props;

  return (
    <AbsoluteFill style={{ background: '#0F172A' }}>
      <Sequence from={0} durationInFrames={60}>
        <IntroLogo brand={brand} primaryColor={primaryColor} />
      </Sequence>
      <Sequence from={60} durationInFrames={60}>
        <HookGeneric line1={hookLine1} line2={hookLine2} primaryColor={primaryColor} />
      </Sequence>
      <Sequence from={120} durationInFrames={270}>
        <FeatureCard title={featureTitle} subtitle={featureSubtitle} bullets={featureBullets} primaryColor={primaryColor} />
      </Sequence>
      <Sequence from={390} durationInFrames={60}>
        <CTA url={ctaUrl} suffix={brandSuffix} subtitle={ctaSubtitle} button={ctaButton} primaryColor={primaryColor} />
      </Sequence>
    </AbsoluteFill>
  );
};
