import { pathToFileURL } from 'node:url';
import type { ShipkitConfig } from './types.js';

export async function loadShipkitConfig(configPath: string): Promise<ShipkitConfig> {
  const configUrl = pathToFileURL(configPath).href;
  const mod = await import(configUrl);
  const config = (mod.default ?? mod.shipkit ?? mod.config ?? mod) as ShipkitConfig;

  if (!config || typeof config !== 'object' || !config.envs) {
    throw new Error(`Invalid Shipkit config at ${configPath}. Expected { envs: { ... } }.`);
  }

  return config;
}
