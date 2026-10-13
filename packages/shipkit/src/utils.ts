import type { ShipkitEnvConfig } from './types.js';

export type ShipkitRuntimeEnv = {
  env?: string;
  app?: string;
  profile?: string;
  platform?: string;
  extra?: Record<string, unknown>;
};

export function runtimeEnvFromProcess(envConfig?: ShipkitEnvConfig): ShipkitRuntimeEnv {
  const env: ShipkitRuntimeEnv = {};
  const app = process.env.SHIPKIT_APP ?? envConfig?.app;
  const profile = process.env.SHIPKIT_PROFILE ?? envConfig?.profile;

  if (app) env.app = app;
  if (process.env.SHIPKIT_ENV) env.env = process.env.SHIPKIT_ENV;
  if (envConfig?.extra) env.extra = envConfig.extra;
  if (process.env.SHIPKIT_PLATFORM) env.platform = process.env.SHIPKIT_PLATFORM;
  if (profile) env.profile = profile;

  return env;
}
