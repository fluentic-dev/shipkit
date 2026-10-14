import { runtimeEnvFromProcess } from '@fluentic/shipkit/utils';
import type { ExpoConfig } from 'expo/config';

export default ({ config }: { config: ExpoConfig; }): ExpoConfig => {
  const shipkit = runtimeEnvFromProcess();
  const isProduction = shipkit.env === 'production';
  const appleTeamId = typeof shipkit.envs?.IOS_TEAM_ID === 'string'
    ? shipkit.envs.IOS_TEAM_ID
    : undefined;
  const bundleIdentifier = isProduction
    ? 'com.fluentic.shipkit.extension'
    : 'com.fluentic.shipkit.extension.staging';

  return {
    ...config,
    name: isProduction ? 'Shipkit Extension' : 'Shipkit Extension (S)',
    slug: isProduction ? 'shipkit-extension' : 'shipkit-extension-staging',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      ...config.ios,
      appleTeamId: appleTeamId || config.ios?.appleTeamId,
      bundleIdentifier,
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
      package: bundleIdentifier,
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
