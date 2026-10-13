import { defineConfig } from '@fluentic/shipkit';

export default defineConfig({
  envs: {
    demo: {
      app: 'shipkit-example',
      displayName: 'Shipkit Example',
      outputName: 'shipkit-example-demo',
      profile: 'development',
      extra: {
        apiUrl: 'https://example.invalid'
      },
      android: {
        applicationId: 'com.fluentic.shipkit.example',
        versionCode: 1,
        keystore: {
          keyAlias: 'shipkit',
          keyPassword: 'shipkit',
          path: './credentials/android/demo.jks',
          storePassword: 'shipkit'
        }
      },
      ios: {
        buildNumber: '1',
        bundleIdentifier: 'com.fluentic.shipkit.example',
        certificate: {
          password: 'shipkit',
          path: './credentials/ios/demo.p12'
        },
        profiles: {
          app: './credentials/ios/demo.mobileprovision'
        },
        teamId: 'TEAMID1234'
      }
    }
  }
});
