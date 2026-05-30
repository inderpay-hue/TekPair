import { Composition } from 'remotion';
import { TekPairPromo } from './TekPairPromo';
import { FeatureReel, ReelProps } from './FeatureReel';
import { AdiosLibretaReel } from './AdiosLibretaReel';
import { SabesQueGanasReel } from './SabesQueGanasReel';
import { FacturasReel } from './FacturasReel';
import { StockReel } from './StockReel';
import { LeyGarantiaReel } from './LeyGarantiaReel';
import { CobrosReel } from './CobrosReel';
import { PDFReel } from './PDFReel';
import { PlantillasReel } from './PlantillasReel';
import { CitasOnlineReel } from './CitasOnlineReel';
import { CatalogoReel } from './CatalogoReel';
import { FacebookCover } from './covers/FacebookCover';
import { YouTubeCover } from './covers/YouTubeCover';

const TEKPAIR_BASE = {
  brand: 'TekPair',
  brandSuffix: '.tech',
  primaryColor: '#3B82F6',
  ctaUrl: 'tekpair',
  ctaSubtitle: 'Prueba gratis 15 días',
  ctaButton: 'Empezar ahora →',
};

const REEL_TPV: ReelProps = { ...TEKPAIR_BASE, hookLine1: '¿Cobras en tu', hookLine2: 'taller a mano?', featureTitle: 'TPV integrado', featureSubtitle: 'Cobra en segundos', featureBullets: ['Tickets en PDF al instante', 'Caja Z al cierre del día', 'Múltiples métodos de pago', 'Stock actualizado en tiempo real'] };
const REEL_ORDENES: ReelProps = { ...TEKPAIR_BASE, hookLine1: 'Olvídate de', hookLine2: 'libretas y excel', featureTitle: 'Órdenes de reparación', featureSubtitle: 'Control total del taller', featureBullets: ['Estados personalizables', 'Devolución automática de stock', 'Historial completo por cliente', 'Notificaciones por email'] };
const REEL_CITAS: ReelProps = { ...TEKPAIR_BASE, hookLine1: 'Tu agenda,', hookLine2: 'siempre llena', featureTitle: 'Gestión de citas', featureSubtitle: 'Sin solapamientos', featureBullets: ['Vista semanal y diaria', 'Recordatorios automáticos', 'Asigna técnico y servicio', 'Sincroniza con clientes'] };
const REEL_STOCK: ReelProps = { ...TEKPAIR_BASE, hookLine1: '¿Te quedaste', hookLine2: 'sin piezas otra vez?', featureTitle: 'Stock inteligente', featureSubtitle: 'Nunca te quedes corto', featureBullets: ['Alertas de stock mínimo', 'Búsqueda por modelo', 'Categorías y compatibilidad', 'Coste y margen por pieza'] };
const REEL_MULTITIENDA: ReelProps = { ...TEKPAIR_BASE, hookLine1: '¿Tienes más', hookLine2: 'de un taller?', featureTitle: 'Multi-tienda', featureSubtitle: 'Todo en un solo panel', featureBullets: ['Datos separados por tienda', 'Roles y permisos', 'Informes consolidados', 'Acceso desde cualquier lugar'] };
const REEL_TRIAL: ReelProps = { ...TEKPAIR_BASE, hookLine1: '15 días', hookLine2: 'gratis. Sin más.', featureTitle: 'Empieza hoy', featureSubtitle: 'Sin compromiso', featureBullets: ['Configuración en 5 minutos', 'Soporte por email incluido', 'Migra desde otro sistema', 'Cancela cuando quieras'] };

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="TekPairPromo" component={TekPairPromo} durationInFrames={450} fps={30} width={1080} height={1080} />

      <Composition id="Reel-TPV" component={FeatureReel} durationInFrames={450} fps={30} width={1080} height={1920} defaultProps={REEL_TPV} />
      <Composition id="Reel-Ordenes" component={FeatureReel} durationInFrames={450} fps={30} width={1080} height={1920} defaultProps={REEL_ORDENES} />
      <Composition id="Reel-Citas" component={FeatureReel} durationInFrames={450} fps={30} width={1080} height={1920} defaultProps={REEL_CITAS} />
      <Composition id="Reel-Stock" component={FeatureReel} durationInFrames={450} fps={30} width={1080} height={1920} defaultProps={REEL_STOCK} />
      <Composition id="Reel-Multitienda" component={FeatureReel} durationInFrames={450} fps={30} width={1080} height={1920} defaultProps={REEL_MULTITIENDA} />
      <Composition id="Reel-Trial" component={FeatureReel} durationInFrames={450} fps={30} width={1080} height={1920} defaultProps={REEL_TRIAL} />

      <Composition id="AdiosLibreta-Vertical" component={AdiosLibretaReel} durationInFrames={450} fps={30} width={1080} height={1920} />
      <Composition id="AdiosLibreta-Cuadrado" component={AdiosLibretaReel} durationInFrames={450} fps={30} width={1080} height={1080} />
      <Composition id="AdiosLibreta-Horizontal" component={AdiosLibretaReel} durationInFrames={450} fps={30} width={1920} height={1080} />

      <Composition id="SabesQueGanas-Vertical" component={SabesQueGanasReel} durationInFrames={450} fps={30} width={1080} height={1920} />
      <Composition id="SabesQueGanas-Cuadrado" component={SabesQueGanasReel} durationInFrames={450} fps={30} width={1080} height={1080} />
      <Composition id="SabesQueGanas-Horizontal" component={SabesQueGanasReel} durationInFrames={450} fps={30} width={1920} height={1080} />

      <Composition id="Facturas-Vertical" component={FacturasReel} durationInFrames={450} fps={30} width={1080} height={1920} />
      <Composition id="Facturas-Cuadrado" component={FacturasReel} durationInFrames={450} fps={30} width={1080} height={1080} />
      <Composition id="Facturas-Horizontal" component={FacturasReel} durationInFrames={450} fps={30} width={1920} height={1080} />

      <Composition id="Stock-Vertical" component={StockReel} durationInFrames={450} fps={30} width={1080} height={1920} />
      <Composition id="Stock-Cuadrado" component={StockReel} durationInFrames={450} fps={30} width={1080} height={1080} />
      <Composition id="Stock-Horizontal" component={StockReel} durationInFrames={450} fps={30} width={1920} height={1080} />

      <Composition id="LeyGarantia-Vertical" component={LeyGarantiaReel} durationInFrames={450} fps={30} width={1080} height={1920} />
      <Composition id="LeyGarantia-Cuadrado" component={LeyGarantiaReel} durationInFrames={450} fps={30} width={1080} height={1080} />
      <Composition id="LeyGarantia-Horizontal" component={LeyGarantiaReel} durationInFrames={450} fps={30} width={1920} height={1080} />

      <Composition id="Cobros-Vertical" component={CobrosReel} durationInFrames={450} fps={30} width={1080} height={1920} />
      <Composition id="Cobros-Cuadrado" component={CobrosReel} durationInFrames={450} fps={30} width={1080} height={1080} />
      <Composition id="Cobros-Horizontal" component={CobrosReel} durationInFrames={450} fps={30} width={1920} height={1080} />

      <Composition id="PDF-Vertical" component={PDFReel} durationInFrames={450} fps={30} width={1080} height={1920} />
      <Composition id="PDF-Cuadrado" component={PDFReel} durationInFrames={450} fps={30} width={1080} height={1080} />
      <Composition id="PDF-Horizontal" component={PDFReel} durationInFrames={450} fps={30} width={1920} height={1080} />

      <Composition id="Plantillas-Vertical" component={PlantillasReel} durationInFrames={450} fps={30} width={1080} height={1920} />
      <Composition id="Plantillas-Cuadrado" component={PlantillasReel} durationInFrames={450} fps={30} width={1080} height={1080} />
      <Composition id="Plantillas-Horizontal" component={PlantillasReel} durationInFrames={450} fps={30} width={1920} height={1080} />

      <Composition id="CitasOnline-Vertical" component={CitasOnlineReel} durationInFrames={450} fps={30} width={1080} height={1920} />
      <Composition id="CitasOnline-Cuadrado" component={CitasOnlineReel} durationInFrames={450} fps={30} width={1080} height={1080} />
      <Composition id="CitasOnline-Horizontal" component={CitasOnlineReel} durationInFrames={450} fps={30} width={1920} height={1080} />

      <Composition id="Catalogo-Vertical" component={CatalogoReel} durationInFrames={450} fps={30} width={1080} height={1920} />
      <Composition id="Catalogo-Cuadrado" component={CatalogoReel} durationInFrames={450} fps={30} width={1080} height={1080} />
      <Composition id="Catalogo-Horizontal" component={CatalogoReel} durationInFrames={450} fps={30} width={1920} height={1080} />

      <Composition id="FacebookCover" component={FacebookCover} durationInFrames={1} fps={30} width={1640} height={624} />
      <Composition id="YouTubeCover" component={YouTubeCover} durationInFrames={1} fps={30} width={2560} height={1440} />
    </>
  );
};
