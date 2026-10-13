import { defineConfig } from '@fluentic/shipkit';

export default defineConfig({
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
});

/*
 * Multi-env projects can use:
 *
 * export default defineEnvs({
 *   staging: defineConfig(baseConfig, {
 *     adjustEnv: 'staging'
 *   }),
 *   production: defineConfig(baseConfig, {
 *     adjustEnv: 'production',
 *     apk: true,
 *     aab: true
 *   })
 * });
 */
