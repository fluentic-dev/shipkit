import { pathToFileURL } from 'node:url';
import type { BuildConfig, BuildConfigOptions, MultiEnvBuildConfig } from './types.js';

type BuildConfigInput = BuildConfig | BuildConfigOptions;

export function defineConfig(...configs: BuildConfigOptions[]): BuildConfig {
  return {
    type: 'config',
    config: deepMergeAll(configs)
  };
}

export function defineEnvs(envs: Record<string, BuildConfigInput>): MultiEnvBuildConfig {
  return {
    type: 'config:envs',
    config: Object.entries(envs).map(([env, config]) => ({
      env,
      config: normalizeConfig(config)
    }))
  };
}

export async function loadShipkitConfig(configPath: string): Promise<MultiEnvBuildConfig> {
  const configUrl = pathToFileURL(configPath).href;
  const mod = await import(configUrl);
  const config = mod.default ?? mod.shipkit ?? mod.config ?? mod;

  if (!isBuildConfig(config) && !isMultiEnvBuildConfig(config)) {
    throw new Error(
      `Invalid Shipkit config at ${configPath}. Expected defineConfig(...) or defineEnvs(...).`
    );
  }

  return isMultiEnvBuildConfig(config) ? config : defineEnvs({ default: config });
}

function normalizeConfig(config: BuildConfigInput): BuildConfig {
  return isBuildConfig(config) ? config : defineConfig(config);
}

function isBuildConfig(config: unknown): config is BuildConfig {
  return Boolean(
    config && typeof config === 'object' && (config as BuildConfig).type === 'config'
      && typeof (config as BuildConfig).config === 'object'
  );
}

function isMultiEnvBuildConfig(config: unknown): config is MultiEnvBuildConfig {
  return Boolean(
    config && typeof config === 'object' && (config as MultiEnvBuildConfig).type === 'config:envs'
      && Array.isArray((config as MultiEnvBuildConfig).config)
  );
}

function deepMergeAll(configs: BuildConfigOptions[]): BuildConfigOptions {
  return configs.reduce<BuildConfigOptions>((merged, config) => deepMerge(merged, config), {});
}

function deepMerge<T extends Record<string, unknown>>(left: T, right: T): T {
  const merged: Record<string, unknown> = { ...left };

  Object.entries(right).forEach(([key, value]) => {
    const current = merged[key];

    if (isPlainObject(current) && isPlainObject(value)) {
      merged[key] = deepMerge(current, value);
      return;
    }

    merged[key] = value;
  });

  return merged as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
