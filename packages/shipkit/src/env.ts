type ExpoConstants = {
  expoConfig?: { extra?: Record<string, unknown>; };
  manifest2?: { extra?: { expoClient?: { extra?: Record<string, unknown>; }; }; };
  manifest?: { extra?: Record<string, unknown>; };
};

let constants: ExpoConstants | null = null;

try {
  const mod = await import('expo-constants');
  constants = (mod.default ?? mod) as ExpoConstants;
} catch {
  constants = null;
}

import type { EnvValue } from './types.js';

export type BuildInfo = {
  name?: string;
  env?: string;
  platform?: string;
  envs?: Record<string, EnvValue>;
};

export const buildInfo = (
  constants?.expoConfig?.extra?.shipkit
    ?? constants?.manifest2?.extra?.expoClient?.extra?.shipkit
    ?? constants?.manifest?.extra?.shipkit
    ?? {}
) as BuildInfo;

export const shipkitEnv = buildInfo;

export function getBuildInfo(): BuildInfo {
  return buildInfo;
}
