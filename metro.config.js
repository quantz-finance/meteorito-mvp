// @cavos/kit/react importa UN solo icono (Fingerprint) del paquete completo @phosphor-icons/react (~6 MB sin tree-shaking).
// Lo redirigimos a ese icono suelto: el chunk del SDK de login baja de ~9 MB a ~3 MB.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
// Fuentes web woff2 (assets/fonts, generadas por scripts/build/subset-fonts.py).
if (!config.resolver.assetExts.includes('woff2')) config.resolver.assetExts.push('woff2');
const shim = path.join(__dirname, 'lib/shims/phosphor-icons.ts');
// iOS/Android: "eventsource" (dependencia de @stellar/stellar-sdk) es solo Node -> stub (lib/shims/eventsource.ts).
const eventsourceShim = path.join(__dirname, 'lib/shims/eventsource.ts');
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Solo build-mock.mjs: sustituye el proveedor externo, nunca Gate/Welcome/API ni el build de producción.
  if (process.env.E2E_MOCK_CAVOS === '1' && platform === 'web' && context.originModulePath.endsWith(path.join('lib', 'cavos.web.tsx')) && moduleName === './cavosBridge') {
    return { type: 'sourceFile', filePath: path.join(__dirname, 'scripts/e2e/cavos-bridge.mock.tsx') };
  }
  if (moduleName === '@phosphor-icons/react' && platform === 'web') return { type: 'sourceFile', filePath: shim };
  if (moduleName === 'eventsource' && platform !== 'web') return { type: 'sourceFile', filePath: eventsourceShim };
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};
module.exports = config;
