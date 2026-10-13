import { defineConfig } from '@fluentic/shipkit';

export default defineConfig({
  envs: {
    demo: {
      fileName: 'shipkit-example',
      adjustEnv: 'development',
      apk: true,
      aab: true,
      credentials: {
        android: {
          keystore: {
            keyAlias: 'shipkit',
            keyPassword: 'shipkit',
            path: './credentials/android/demo.jks',
            storePassword: 'shipkit'
          }
        },
        ios: {
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
  }
});
