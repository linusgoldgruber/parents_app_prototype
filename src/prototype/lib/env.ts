const runtimeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

export const clientEnv = {
  supabaseUrl: runtimeEnv.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: runtimeEnv.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  demoFamilyId: runtimeEnv.EXPO_PUBLIC_DEMO_FAMILY_ID,
  matrixBaseUrl: runtimeEnv.EXPO_PUBLIC_MATRIX_HOMESERVER_URL,
  matrixAccessToken: runtimeEnv.EXPO_PUBLIC_MATRIX_ACCESS_TOKEN,
  matrixUserId: runtimeEnv.EXPO_PUBLIC_MATRIX_USER_ID
};

export function hasSupabaseConfig(): boolean {
  return Boolean(clientEnv.supabaseUrl && clientEnv.supabaseAnonKey);
}

export function hasMatrixConfig(): boolean {
  return Boolean(clientEnv.matrixBaseUrl && clientEnv.matrixAccessToken);
}

export function getDemoFamilyId(): string {
  return clientEnv.demoFamilyId || "11111111-1111-1111-1111-111111111111";
}
