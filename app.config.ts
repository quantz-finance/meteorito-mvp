import type { ExpoConfig } from 'expo/config';

const rpId = process.env.EXPO_PUBLIC_CAVOS_RP_ID || 'meteorito-mvp.vercel.app';

const config: ExpoConfig = {
  name: 'Meteorito',
  slug: 'meteorito-mvp',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'meteorito',
  userInterfaceStyle: 'dark',
  backgroundColor: '#1A0B3D',
  ios: { supportsTablet: false, bundleIdentifier: 'app.meteorito.mobile' },
  android: {
    package: 'app.meteorito.mobile',
    adaptiveIcon: {
      backgroundColor: '#6C2BD9',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
    },
  },
  web: { bundler: 'metro', output: 'static', favicon: './assets/images/favicon.png', name: 'Meteorito', shortName: 'Meteorito', themeColor: '#6C2BD9', backgroundColor: '#1A0B3D' },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { image: './assets/images/splash-icon.png', resizeMode: 'contain', imageWidth: 220, backgroundColor: '#1A0B3D' }],
    'expo-font',
    ['expo-image-picker', { photosPermission: 'Meteorito usa tus fotos para mostrar el artículo que vendés.', cameraPermission: false, microphonePermission: false }],
    // Associated Domains (passkeys) requiere cuenta Apple Developer paga: apagado para el Apple ID gratis.
    ['@cavos/kit', { rpId, scheme: 'meteorito', enableAssociatedDomains: process.env.CAVOS_ASSOCIATED_DOMAINS === '1' }],
  ],
  experiments: { typedRoutes: true },
};
export default config;
