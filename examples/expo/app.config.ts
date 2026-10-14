import { runtimeEnvFromProcess } from '@fluentic/shipkit/utils';
import type { ExpoConfig } from 'expo/config';

export default ({ config }: { config: ExpoConfig; }): ExpoConfig => {
  const shipkit = runtimeEnvFromProcess();
  const appleTeamId = typeof shipkit.envs?.IOS_TEAM_ID === 'string'
    ? shipkit.envs.IOS_TEAM_ID
    : undefined;
  const bundleIdentifier = 'com.fluentic.shipkit.example';

  return {
    ...config,
    name: 'Shipkit Example',
    slug: 'shipkit-example',
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
    plugins: [
      ...(config.plugins ?? []),
      '@fluentic/shipkit',
      ['@fluentic/shipkit-appicon', { source: 'assets/shipkit-appicon.tar.gz' }]
    ],
    web: {
      ...config.web,
      favicon: './assets/favicon.png'
    }
  };
};
