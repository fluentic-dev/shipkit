import { dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadShipkitEnv } from './config-env.js';
import type {
  BuildConfig,
  BuildManifest,
  BuildVariantConfig,
  ResolvedBuildVariantConfig
} from './types.js';

export function defineConfig(...configs: BuildConfig[]): BuildConfig {
  return deepMergeAll(configs);
}

export const defineBuild = defineConfig;

export function defineVariant(
  build: BuildConfig,
  variant: BuildVariantConfig
): BuildVariantConfig {
  if (!variant.name) {
    throw new Error('Build variant name is required.');
  }

  return deepMerge(build, variant) as BuildVariantConfig;
}

export function defineVariants(variants: BuildVariantConfig[]): BuildVariantConfig[] {
  return variants;
}

export async function loadShipkitConfig(configPath: string): Promise<BuildManifest> {
  await loadShipkitEnv({ cwd: dirname(configPath) });

  const configUrl = pathToFileURL(configPath).href;
  const mod = await import(configUrl);
  const config = mod.default ?? mod.shipkit ?? mod.config ?? mod;

  return normalizeManifest(config, configPath);
}

function normalizeManifest(config: unknown, configPath: string): BuildManifest {
  const variants = Array.isArray(config) ? config : [config];

  if (variants.length === 0) {
    throw new Error(`Invalid Shipkit config at ${relative(process.cwd(), configPath)}.`);
  }

  return {
    type: 'config:variants',
    variants: variants.map((variant, index) => normalizeVariant(variant, index))
  };
}

function normalizeVariant(input: unknown, index: number): ResolvedBuildVariantConfig {
  if (!isPlainObject(input)) {
    throw new Error(`Invalid Shipkit build variant at index ${index}.`);
  }

  const variant = input as BuildVariantConfig;
  const name = variant.name ?? 'default';
  const env = variant.env ?? name;
  const baseFileName = variant.fileName ?? name;
  const fileName = baseFileName.includes('[env]') ? baseFileName : `${baseFileName}-[env]`;

  return {
    ...variant,
    abb: variant.abb ?? true,
    apk: variant.apk ?? true,
    env,
    envs: variant.envs ?? {},
    fileName,
    ipa: variant.ipa ?? true,
    name
  };
}

function deepMergeAll(configs: BuildConfig[]): BuildConfig {
  return configs.reduce<BuildConfig>((merged, config) => deepMerge(merged, config), {});
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
