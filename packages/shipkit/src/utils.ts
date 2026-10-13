import type { ShipkitEnvConfig } from './types.js';

export type ShipkitRuntimeEnv = {
  env?: string;
  profile?: string;
  platform?: string;
};

export function runtimeEnvFromProcess(envConfig?: ShipkitEnvConfig): ShipkitRuntimeEnv {
  const env: ShipkitRuntimeEnv = {};
  const profile = process.env.SHIPKIT_PROFILE ?? envConfig?.adjustEnv;

  if (process.env.SHIPKIT_ENV) env.env = process.env.SHIPKIT_ENV;
  if (process.env.SHIPKIT_PLATFORM) env.platform = process.env.SHIPKIT_PLATFORM;
  if (profile) env.profile = profile;

  return env;
}
