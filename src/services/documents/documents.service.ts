import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../../config/env.js";
import type { FamilyRole } from "../../domain/roles.js";

export interface FamilyDocument {
  id: string;
  familyId: string;
  uploadedBy: string;
  filePath: string;
  visibilityRoles: FamilyRole[];
}

export class DocumentsService {
  private readonly supabase: SupabaseClient;

  constructor(supabase?: SupabaseClient) {
    this.supabase = supabase ?? createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  }

  async listVisibleDocuments(familyId: string, role: FamilyRole): Promise<FamilyDocument[]> {
    const { data, error } = await this.supabase
      .from("family_documents")
      .select("id,family_id,uploaded_by,file_path,visibility_roles")
      .eq("family_id", familyId)
      .contains("visibility_roles", [role]);

    if (error) {
      throw error;
    }

    return (data ?? []).map((row) => ({
      id: row.id as string,
      familyId: row.family_id as string,
      uploadedBy: row.uploaded_by as string,
      filePath: row.file_path as string,
      visibilityRoles: row.visibility_roles as FamilyRole[]
    }));
  }
}
