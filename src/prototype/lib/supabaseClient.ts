import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { clientEnv, hasSupabaseConfig } from "./env";

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!hasSupabaseConfig()) {
    return null;
  }

  if (!client) {
    client = createClient(clientEnv.supabaseUrl as string, clientEnv.supabaseAnonKey as string, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      }
    });
  }

  return client;
}

export async function signIn(email: string, password: string): Promise<{ error?: string }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: "Supabase config missing" };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? { error: error.message } : {};
}

export async function signUp(
  email: string,
  password: string,
  username: string
): Promise<{ error?: string; needsEmailConfirmation?: boolean }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { error: "Supabase config missing" };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        username: username.trim()
      }
    }
  });
  if (error) {
    return { error: error.message };
  }

  return { needsEmailConfirmation: !data.session };
}

export async function signOut(): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }
  await supabase.auth.signOut();
}

export async function getCurrentSession(): Promise<Session | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getValidatedSession(): Promise<Session | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) {
    return null;
  }

  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData.user) {
    await supabase.auth.signOut();
    return null;
  }

  return session;
}
