// Expo configures Metro for the monorepo automatically (SDK 52+). One addition: the shared
// workspace packages (@farmgo/contracts) are TypeScript source written as
// ESM with ".js" import suffixes (`export * from './common.js'`), which Node and tsc map to
// the .ts file. Metro does not, so relative ".js" imports inside packages/ resolve to ".ts".
const path = require('node:path');
const fs = require('node:fs');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const packagesDir = path.resolve(__dirname, '../../packages') + path.sep;

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  const origin = context.originModulePath ?? '';
  if (moduleName.startsWith('.') && moduleName.endsWith('.js') && origin.startsWith(packagesDir)) {
    const base = path.resolve(path.dirname(origin), moduleName.slice(0, -3));
    for (const ext of ['.ts', '.tsx']) {
      if (fs.existsSync(base + ext)) return { type: 'sourceFile', filePath: base + ext };
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
