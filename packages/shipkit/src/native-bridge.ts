import { createRequire } from 'node:module';
import path from 'node:path';
import type { NativeEvent, NativeRequest, NativeResponse } from './types.js';

const require = createRequire(import.meta.url);

export function createNativeRequestHandler(onEvent: (event: NativeEvent) => void) {
  return (requestJson: string) => {
    try {
      const request = JSON.parse(requestJson) as NativeRequest;
      const response = handleNativeRequest(request, onEvent);
      return JSON.stringify({ ok: true, data: response } satisfies NativeResponse);
    } catch (error) {
      return JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        } satisfies NativeResponse
      );
    }
  };
}

function handleNativeRequest(
  request: NativeRequest,
  onEvent: (event: NativeEvent) => void
) {
  switch (request.code) {
    case 'log':
      onEvent(request.data);
      return null;
    case 'read_expo_config':
      return readExpoConfig(request.data);
    case 'confirm':
      return request.data.defaultValue ?? false;
  }
}

function readExpoConfig(input: Extract<NativeRequest, { code: 'read_expo_config'; }>['data']) {
  const candidates = ['app.config.js', 'app.config.cjs'];
  const previous = {
    env: process.env.ENV,
    shipkitName: process.env.SHIPKIT_NAME,
    shipkitEnv: process.env.SHIPKIT_ENV,
    shipkitEnvs: process.env.SHIPKIT_ENVS,
    shipkitPlatform: process.env.SHIPKIT_PLATFORM
  };

  process.env.ENV = input.env;
  process.env.SHIPKIT_NAME = input.name;
  process.env.SHIPKIT_ENV = input.env;
  process.env.SHIPKIT_ENVS = JSON.stringify(input.envs);
  process.env.SHIPKIT_PLATFORM = input.platform;

  try {
    for (const candidate of candidates) {
      const configPath = path.join(input.appDir, candidate);
      try {
        const mod = require(configPath) as unknown;
        const exported = readDefaultExport(mod);
        return typeof exported === 'function'
          ? exported({ config: {} })
          : exported;
      } catch (error) {
        if (isNotFoundRequire(error)) continue;
        throw error;
      }
    }

    return {};
  } finally {
    restoreEnv('ENV', previous.env);
    restoreEnv('SHIPKIT_NAME', previous.shipkitName);
    restoreEnv('SHIPKIT_ENV', previous.shipkitEnv);
    restoreEnv('SHIPKIT_ENVS', previous.shipkitEnvs);
    restoreEnv('SHIPKIT_PLATFORM', previous.shipkitPlatform);
  }
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function readDefaultExport(mod: unknown) {
  if (mod && typeof mod === 'object' && 'default' in mod) {
    return (mod as { default: unknown; }).default;
  }

  return mod;
}

function isNotFoundRequire(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    && error.code === 'MODULE_NOT_FOUND';
}
