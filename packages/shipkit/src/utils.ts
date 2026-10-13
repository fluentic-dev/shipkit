import type { EnvValue } from './types.js';

export type ShipkitRuntimeEnv = {
  name?: string;
  env?: string;
  platform?: string;
  envs?: Record<string, EnvValue>;
};

export function runtimeEnvFromProcess(): ShipkitRuntimeEnv {
  const env: ShipkitRuntimeEnv = {};

  if (process.env.SHIPKIT_NAME) env.name = process.env.SHIPKIT_NAME;
  if (process.env.SHIPKIT_ENV) env.env = process.env.SHIPKIT_ENV;
  if (process.env.SHIPKIT_PLATFORM) env.platform = process.env.SHIPKIT_PLATFORM;
  if (process.env.SHIPKIT_ENVS) {
    env.envs = JSON.parse(process.env.SHIPKIT_ENVS) as Record<string, EnvValue>;
  }

  return env;
}
