import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fallbackNative } from './native-fallback.js';
import type { NativeBinding } from './types.js';

declare const __SHIPKIT_NPM_RELEASE__: boolean | undefined;

const require = createRequire(import.meta.url);
const file = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(file), '..');
const workspaceRoot = path.resolve(packageRoot, '../..');
const isNpmRelease = typeof __SHIPKIT_NPM_RELEASE__ === 'boolean'
  && __SHIPKIT_NPM_RELEASE__;

const npmNativePackages: Partial<
  Record<NodeJS.Platform, Partial<Record<NodeJS.Architecture, string>>>
> = {
  darwin: {
    arm64: '@fluentic/shipkit-native-darwin-arm64',
    x64: '@fluentic/shipkit-native-darwin-x64'
  },
  linux: {
    arm64: '@fluentic/shipkit-native-linux-arm64-gnu',
    x64: '@fluentic/shipkit-native-linux-x64-gnu'
  },
  win32: {
    x64: '@fluentic/shipkit-native-win32-x64-msvc'
  }
};

export function loadNative(): NativeBinding {
  const explicitNative = loadExplicitNative();
  if (explicitNative) return explicitNative;

  const candidates = isNpmRelease ? npmNativeCandidates() : localNativeCandidates();

  for (const candidate of candidates) {
    try {
      return require(candidate) as NativeBinding;
    } catch {
      // Try the next dev or platform package candidate.
    }
  }

  if (process.env.SHIPKIT_REQUIRE_NATIVE === '1') {
    throw new Error(`Could not load Shipkit native binding from: ${candidates.join(', ')}`);
  }

  return fallbackNative;
}

function loadExplicitNative() {
  if (!process.env.SHIPKIT_NATIVE_PATH) return null;
  return require(process.env.SHIPKIT_NATIVE_PATH) as NativeBinding;
}

function npmNativeCandidates() {
  const nativePackage = npmNativePackages[process.platform]?.[process.arch];
  return nativePackage ? [nativePackage] : [];
}

function localNativeCandidates() {
  const fileName = `shipkit_native.${process.platform}-${process.arch}.node`;

  return [
    '@fluentic/shipkit-native',
    path.join(workspaceRoot, 'private'),
    path.join(workspaceRoot, 'private', fileName),
    path.resolve(workspaceRoot, '../shipkit-private'),
    path.resolve(workspaceRoot, '../shipkit-private', fileName)
  ];
}
