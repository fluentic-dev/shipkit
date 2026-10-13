export type Platform = 'android' | 'ios';
export type Artifact = 'apk' | 'aab' | 'ipa';
export type EnvValue = string | number | boolean;

export type BuildCredentials = {
  android?: {
    keystore?: {
      path: string;
      storePassword: string;
      keyAlias: string;
      keyPassword: string;
    };
  };
  ios?: {
    teamId?: string;
    certificate?: {
      path: string;
      password: string;
    };
    profile?: {
      path: string;
      target?: string;
    };
    profiles?: Array<{
      path: string;
      target?: string;
    }>;
  };
};

export type BuildConfig = {
  fileName?: string;
  envs?: Record<string, EnvValue>;
  apk?: boolean;
  abb?: boolean;
  ipa?: boolean;
  credentials?: BuildCredentials;
};

export type BuildVariantConfig = BuildConfig & {
  name: string;
  env?: string;
};

export type ResolvedBuildVariantConfig = BuildVariantConfig & {
  env: string;
  fileName: string;
  envs: Record<string, EnvValue>;
  apk: boolean;
  abb: boolean;
  ipa: boolean;
};

export type BuildManifest = {
  type: 'config:variants';
  variants: ResolvedBuildVariantConfig[];
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
  name: string;
  env: string;
  platform: Platform;
  artifact: Artifact;
  config: BuildManifest;
  licenseKey?: string;
  homeDir: string;
  dryRun?: boolean;
};

export type NativeBinding = {
  activateLicense(inputJson: string, onEvent: NativeEventSink): string;
  runCommand(inputJson: string, onEvent: NativeEventSink): string;
  runBuild(inputJson: string, onEvent: NativeEventSink): string;
};
