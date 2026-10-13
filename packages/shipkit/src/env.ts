type ExpoConstants = {
  expoConfig?: { extra?: Record<string, unknown>; };
  manifest2?: { extra?: { expoClient?: { extra?: Record<string, unknown>; }; }; };
  manifest?: { extra?: Record<string, unknown>; };
};

export type BuildInfo<Envs = Record<string, unknown>> = {
  name?: string;
  env?: string;
  platform?: string;
  envs?: Envs;
};

let constants: ExpoConstants | null = null;

try {
  const mod = await import('expo-constants');
  constants = (mod.default ?? mod) as ExpoConstants;
} catch {
  constants = null;
}

export const buildInfo = readBuildInfo();
export const shipkitEnv = buildInfo;

export function getBuildInfo<Envs = Record<string, unknown>>(): BuildInfo<Envs> {
  return readBuildInfo() as BuildInfo<Envs>;
}

function readBuildInfo(): BuildInfo {
  return {
    ...readConstantsBuildInfo(),
    ...readProcessBuildInfo()
  };
}

function readConstantsBuildInfo(): BuildInfo {
  return (
    constants?.expoConfig?.extra?.shipkit
      ?? constants?.manifest2?.extra?.expoClient?.extra?.shipkit
      ?? constants?.manifest?.extra?.shipkit
      ?? {}
  ) as BuildInfo;
}

function readProcessBuildInfo(): BuildInfo {
  const info: BuildInfo = {};

  if (process.env.SHIPKIT_NAME) info.name = process.env.SHIPKIT_NAME;
  if (process.env.SHIPKIT_ENV) info.env = process.env.SHIPKIT_ENV;
  if (process.env.SHIPKIT_PLATFORM) info.platform = process.env.SHIPKIT_PLATFORM;
  if (process.env.SHIPKIT_ENVS) {
    info.envs = JSON.parse(process.env.SHIPKIT_ENVS) as Record<string, unknown>;
  }

  return info;
}
