export type Platform = 'android' | 'ios';
export type Artifact = 'apk' | 'aab' | 'ipa';

export type BuildCredentials = {
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

export type BuildConfigOptions = {
  fileName?: string;
  apk?: boolean;
  abb?: boolean;
  aab?: boolean;
  ipa?: boolean;
  adjustEnv?: string;
  credentials?: BuildCredentials;
};

export type BuildConfig = {
  type: 'config';
  config: BuildConfigOptions;
};

export type MultiEnvBuildConfig = {
  type: 'config:envs';
  config: Array<{
    env: string;
    config: BuildConfig;
  }>;
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
  platform: Platform;
  artifact: Artifact;
  config: MultiEnvBuildConfig;
  licenseKey?: string;
  homeDir: string;
  dryRun?: boolean;
};

export type NativeBinding = {
  activateLicense(inputJson: string, onEvent: NativeEventSink): string;
  runCommand(inputJson: string, onEvent: NativeEventSink): string;
  runBuild(inputJson: string, onEvent: NativeEventSink): string;
};
