import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./supabase-config.js";

const sdk = window.supabase;
if (!sdk?.createClient) {
  throw new Error("The Supabase sign-in library did not load. Check your connection and reload.");
}

export const supabase = sdk.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
