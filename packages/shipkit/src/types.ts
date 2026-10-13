export type ShipkitPlatform = 'android' | 'ios';
export type ShipkitArtifact = 'apk' | 'aab' | 'ipa';

export type ShipkitCredentials = {
  android: {
    keystore: {
      path: string;
      storePassword: string;
      keyAlias: string;
      keyPassword: string;
    };
  };
  ios: {
    teamId?: string;
    certificate?: {
      path: string;
      password: string;
    };
    profiles?: Record<string, string>;
  };
};

export type ShipkitEnvConfig = {
  fileName?: string;
  apk?: boolean;
  aab?: boolean;
  adjustEnv?: string;
  credentials?: ShipkitCredentials;
};

export type ShipkitConfig = {
  envs: Record<string, ShipkitEnvConfig>;
};

export type NativeEvent = {
  level: 'debug' | 'info' | 'warn' | 'error' | 'success';
  message: string;
  data?: unknown;
};

export type NativeEventSink = (event: NativeEvent) => void;

export type NativeLicenseInput = {
  licenseKey: string;
  homeDir: string;
};

export type NativeCommandInput = {
  command: 'doctor' | 'license-status';
  appDir: string;
  homeDir: string;
};

export type NativeBuildInput = {
  appDir: string;
  env: string;
  platform: ShipkitPlatform;
  artifact: ShipkitArtifact;
  config: ShipkitConfig;
  licenseKey?: string;
  homeDir: string;
  dryRun?: boolean;
};

export type NativeBinding = {
  activateLicense(inputJson: string, onEvent: NativeEventSink): string;
  runCommand(inputJson: string, onEvent: NativeEventSink): string;
  runBuild(inputJson: string, onEvent: NativeEventSink): string;
};
