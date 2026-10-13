import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type EnvSource = {
  forced: Map<string, string>;
  normal: Map<string, string>;
};

const globalKey = '__SHIPKIT_ENV_SOURCE__';

declare global {
  var __SHIPKIT_ENV_SOURCE__: EnvSource | undefined;
}

function source() {
  globalThis[globalKey] ??= {
    forced: new Map<string, string>(),
    normal: new Map<string, string>()
  };

  return globalThis[globalKey];
}

export async function loadShipkitEnv(options: {
  cwd: string;
  files?: readonly string[];
}) {
  clearShipkitEnv();

  for (const file of options.files ?? ['build.env', 'build.local.env']) {
    await loadShipkitEnvFile(join(options.cwd, file));
  }
}

export function clearShipkitEnv() {
  const envSource = source();
  envSource.forced.clear();
  envSource.normal.clear();
}

export function env(name: string): string;
export function env(name: string, defaultValue: string): string;
export function env(name: string, defaultValue: null): string | null;
export function env(name: string, converter: BooleanConstructor): boolean;
export function env(name: string, converter: BooleanConstructor, defaultValue: boolean): boolean;
export function env(
  name: string,
  converter: BooleanConstructor,
  defaultValue: null
): boolean | null;
export function env(name: string, converter: NumberConstructor): number;
export function env(name: string, converter: NumberConstructor, defaultValue: number): number;
export function env(name: string, converter: NumberConstructor, defaultValue: null): number | null;
export function env(
  name: string,
  converterOrDefault?: string | null | BooleanConstructor | NumberConstructor,
  defaultValue?: boolean | number | null
): string | boolean | number | null {
  const rawValue = readShipkitEnvValue(name);
  const fallback = resolveEnvDefault(converterOrDefault, defaultValue);

  if (rawValue === undefined || rawValue === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required Shipkit env ${name}.`);
  }

  return convertEnvValue(name, rawValue, converterOrDefault);
}

async function loadShipkitEnvFile(path: string) {
  let text: string;

  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }

  parseShipkitEnv(text, path);
}

function parseShipkitEnv(text: string, path: string) {
  const envSource = source();
  const lines = text.split(/\r?\n/u);

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)(!)?\s*=\s*(.*)$/u.exec(trimmed);
    if (!match) {
      throw new Error(`Invalid Shipkit env line in ${path}:${index + 1}.`);
    }

    const [, name, forced, value] = match;
    if (!name || value === undefined) {
      throw new Error(`Invalid Shipkit env line in ${path}:${index + 1}.`);
    }

    if (forced === '!') {
      envSource.forced.set(name, value);
    } else {
      envSource.normal.set(name, value);
    }
  }
}

function readShipkitEnvValue(name: string) {
  const envSource = source();
  const forcedValue = envSource.forced.get(name);
  if (forcedValue !== undefined) return forcedValue;

  const processValue = process.env[name];
  if (processValue !== undefined) return processValue;

  return envSource.normal.get(name);
}

function convertEnvValue(
  name: string,
  value: string,
  converterOrDefault?: string | null | BooleanConstructor | NumberConstructor
) {
  if (converterOrDefault === Boolean) {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    throw new Error(`Shipkit env ${name} must be a boolean: true, false, 1, or 0.`);
  }

  if (converterOrDefault === Number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Shipkit env ${name} must be a finite number.`);
    }
    return parsed;
  }

  return value;
}

function resolveEnvDefault(
  converterOrDefault?: string | null | BooleanConstructor | NumberConstructor,
  defaultValue?: boolean | number | null
) {
  if (typeof converterOrDefault === 'string' || converterOrDefault === null) {
    return converterOrDefault;
  }

  return defaultValue;
}

function isNotFoundError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
