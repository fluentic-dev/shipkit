import { createRequire, } from 'node:module';
import { fallbackNative, } from './native-fallback.js';
import type { NativeBinding, } from './types.js';

const require = createRequire(import.meta.url,);

const platformPackages: Partial<
  Record<NodeJS.Platform, Partial<Record<NodeJS.Architecture, string>>>
> = {
  darwin: {
    arm64: '@fluentic/shipkit-darwin-arm64',
    x64: '@fluentic/shipkit-darwin-x64',
  },
  linux: {
    arm64: '@fluentic/shipkit-linux-arm64-gnu',
    x64: '@fluentic/shipkit-linux-x64-gnu',
  },
  win32: {
    x64: '@fluentic/shipkit-win32-x64-msvc',
  },
};

export function loadNative(): NativeBinding {
  const nativePackage = platformPackages[process.platform]?.[process.arch];

  try {
    if (!nativePackage) {
      throw new Error(`Unsupported Shipkit native platform: ${process.platform}-${process.arch}`,);
    }

    return require(nativePackage,) as NativeBinding;
  } catch (error) {
    if (process.env.SHIPKIT_REQUIRE_NATIVE === '1') {
      throw error;
    }

    return fallbackNative;
  }
}
