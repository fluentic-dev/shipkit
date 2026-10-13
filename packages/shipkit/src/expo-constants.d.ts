declare module 'expo-constants' {
  const constants: {
    expoConfig?: { extra?: Record<string, unknown>; };
    manifest2?: { extra?: { expoClient?: { extra?: Record<string, unknown>; }; }; };
    manifest?: { extra?: Record<string, unknown>; };
  };

  export default constants;
}
