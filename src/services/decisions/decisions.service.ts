import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";

export interface DecisionOption {
  id: string;
  decisionId: string;
  label: string;
}

export interface FamilyDecision {
  id: string;
  familyId: string;
  title: string;
  status: "open" | "closed";
}

export class DecisionsService {
  private readonly supabase: SupabaseClient;

  constructor(supabase?: SupabaseClient) {
    this.supabase = supabase ?? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  }

  async listOpenDecisions(familyId: string): Promise<FamilyDecision[]> {
    const { data, error } = await this.supabase
      .from("family_decisions")
      .select("id,family_id,title,status")
      .eq("family_id", familyId)
      .eq("status", "open");

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({
      id: row.id as string,
      familyId: row.family_id as string,
      title: row.title as string,
      status: row.status as "open" | "closed"
    }));
  }
}
