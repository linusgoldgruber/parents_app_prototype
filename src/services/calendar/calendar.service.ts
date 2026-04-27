import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";

export interface FamilyCalendarEvent {
  id: string;
  familyId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  createdBy: string;
}

export class CalendarService {
  private readonly supabase: SupabaseClient;

  constructor(supabase?: SupabaseClient) {
    this.supabase = supabase ?? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  }

  async listEvents(familyId: string): Promise<FamilyCalendarEvent[]> {
    const { data, error } = await this.supabase
      .from("calendar_events")
      .select("id,family_id,title,starts_at,ends_at,created_by")
      .eq("family_id", familyId)
      .order("starts_at", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({
      id: row.id as string,
      familyId: row.family_id as string,
      title: row.title as string,
      startsAt: row.starts_at as string,
      endsAt: row.ends_at as string,
      createdBy: row.created_by as string
    }));
  }
}
