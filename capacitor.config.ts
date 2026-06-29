import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cacti.ordering',
  appName: 'Cacti',
  webDir: 'dist',
  backgroundColor: '#0a0a0a',
  server: {
    // Allow the native app to make API calls to the Vercel backend
    androidScheme: 'https',
    iosScheme: 'capacitor',
    cleartext: false,
  },
  android: {
    backgroundColor: '#0a0a0a',
    allowMixedContent: false,
  },
  ios: {
    backgroundColor: '#0a0a0a',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0a0a0a',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      iosSpinnerColor: '#0a4d4d',
      showSpinner: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a0a',
    },
  },
};

export default config;
