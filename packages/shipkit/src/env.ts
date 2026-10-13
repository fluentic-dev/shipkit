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

export const shipkitEnv = (
  constants?.expoConfig?.extra?.shipkit
    ?? constants?.manifest2?.extra?.expoClient?.extra?.shipkit
    ?? constants?.manifest?.extra?.shipkit
    ?? {}
) as {
  env?: string;
  app?: string;
  profile?: string;
  platform?: string;
  extra?: Record<string, unknown>;
};
