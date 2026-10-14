import { runtimeEnvFromProcess } from '@fluentic/shipkit/utils';
import type { ExpoConfig } from 'expo/config';

const variants = {
  consumer_production: {
    bundleIdentifier: 'com.fluentic.shipkit.consumer',
    name: 'Shipkit Consumer',
    slug: 'shipkit-consumer'
  },
  consumer_staging: {
    bundleIdentifier: 'com.fluentic.shipkit.consumer.staging',
    name: 'Shipkit Consumer (S)',
    slug: 'shipkit-consumer-staging'
  },
  partner_production: {
    bundleIdentifier: 'com.fluentic.shipkit.partner',
    name: 'Shipkit Partner',
    slug: 'shipkit-partner'
  },
  partner_staging: {
    bundleIdentifier: 'com.fluentic.shipkit.partner.staging',
    name: 'Shipkit Partner (S)',
    slug: 'shipkit-partner-staging'
  }
} as const;

type VariantName = keyof typeof variants;

export default ({ config }: { config: ExpoConfig; }): ExpoConfig => {
  const shipkit = runtimeEnvFromProcess();
  const variant = variants[(shipkit.name ?? 'consumer_staging') as VariantName]
    ?? variants.consumer_staging;
  const appleTeamId = typeof shipkit.envs?.IOS_TEAM_ID === 'string'
    ? shipkit.envs.IOS_TEAM_ID
    : undefined;

  return {
    ...config,
    name: variant.name,
    slug: variant.slug,
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      ...config.ios,
      appleTeamId: appleTeamId || config.ios?.appleTeamId,
      bundleIdentifier: variant.bundleIdentifier,
      supportsTablet: true
    },
    plugins: [
      ...(config.plugins ?? []),
      '@fluentic/shipkit',
      ['@fluentic/shipkit-appicon', { source: 'assets/shipkit-appicon.tar.gz' }],
      '@bacons/apple-targets'
    ],
    android: {
      ...config.android,
      package: variant.bundleIdentifier,
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png'
      },
      predictiveBackGestureEnabled: false
    },
    web: {
      ...config.web,
      favicon: './assets/favicon.png'
    }
  };
};
