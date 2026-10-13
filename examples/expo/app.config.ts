import { withShipkitEnv } from '@fluentic/shipkit/plugin';
import type { ExpoConfig } from 'expo/config';

export default ({ config }: { config: ExpoConfig; }): ExpoConfig => {
  return withShipkitEnv({
    ...config,
    name: 'Shipkit Example',
    slug: 'shipkit-example',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.fluentic.shipkit.example',
      supportsTablet: true
    },
    android: {
      ...config.android,
      package: 'com.fluentic.shipkit.example',
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
  });
};
