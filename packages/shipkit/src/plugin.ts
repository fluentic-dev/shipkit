import { runtimeEnvFromProcess } from './utils.js';

type ExpoConfig = {
  extra?: Record<string, unknown>;
};

export function withPlugin<T extends ExpoConfig>(config: T): T {
  config.extra = {
    ...config.extra,
    shipkit: runtimeEnvFromProcess()
  };

  return config;
}

export default withPlugin;
