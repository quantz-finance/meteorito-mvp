// @cavos/kit/react importa UN solo icono (Fingerprint) del paquete completo @phosphor-icons/react (~6 MB sin tree-shaking).
// Lo redirigimos a ese icono suelto: el chunk del SDK de login baja de ~9 MB a ~3 MB.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);
const shim = path.join(__dirname, 'lib/shims/phosphor-icons.ts');
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@phosphor-icons/react' && platform === 'web') return { type: 'sourceFile', filePath: shim };
  return (upstream ?? context.resolveRequest)(context, moduleName, platform);
};
module.exports = config;
