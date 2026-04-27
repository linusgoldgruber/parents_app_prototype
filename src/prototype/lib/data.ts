import { getSupabaseClient } from "./supabaseClient";
import type { CalendarEvent, FamilyDecision, FamilyDocument, FamilyRole } from "../types/app";

export interface FamilyMembership {
  familyId: string;
  familyName: string;
  role: FamilyRole;
  joinCode: string | null;
  displayName: string | null;
  isCreator: boolean;
}

export interface FamilySituation {
  parent: number;
  child: number;
  grandparent: number;
  caretaker: number;
  external_mediator: number;
  social_worker: number;
}

export interface FamilyMemberRecord {
  userId: string;
  role: FamilyRole;
  displayName: string | null;
  profilePhotoPath: string | null;
}

export interface ScheduleRequestRecord {
  id: string;
  type: string;
  date: string;
  note: string;
  status: "pending" | "approved" | "declined";
  requestedBy: string;
  affectedMemberIds: string[];
  approverMemberIds: string[];
  approvedByIds: string[];
}

export interface ChatMessageRecord {
  id: string;
  familyId: string;
  topic: string;
  body: string;
  senderUserId: string;
  createdAt: string;
}

interface FamilyRow {
  id: string;
  name: string;
  join_code: string | null;
  join_password: string | null;
  family_situation?: Partial<FamilySituation> | null;
  third_party_consents?: Record<string, boolean> | null;
  care_rhythm?: string | null;
  care_rhythm_start_date?: string | null;
  care_rhythm_notes?: string | null;
  care_rhythm_locked?: boolean | null;
  care_rhythm_confirmed_by?: string[] | null;
}

export interface CareRhythmStateRecord {
  rhythm: string | null;
  startDate: string | null;
  notes: string;
  locked: boolean;
  confirmedBy: string[];
}

export interface FamilyRoleInviteRecord {
  id: string;
  familyId: string;
  inviteCode: string;
  role: FamilyRole;
  usedBy: string | null;
  createdAt: string | null;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

const PROFILE_PHOTO_BUCKET = "profile-photos";

export async function fetchUserFamilies(userId: string): Promise<FamilyMembership[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data: rpcRows, error: rpcError } = await supabase.rpc("get_my_family_memberships_secure");
  if (!rpcError && Array.isArray(rpcRows)) {
    return rpcRows.map((row) => ({
      familyId: row.family_id as string,
      familyName: ((row.family_name as string | null) ?? "Care Group").trim() || "Care Group",
      role: row.role as FamilyRole,
      joinCode: (row.join_code as string | null) ?? null,
      displayName: (row.display_name as string | null) ?? null,
      isCreator: Boolean(row.is_creator)
    }));
  }

  const { data: membershipRows, error: membershipError } = await supabase
    .from("family_members")
    .select("family_id,role,display_name")
    .eq("user_id", userId);

  if (membershipError) {
    throw new Error(membershipError.message);
  }

  const memberships = (membershipRows ?? []).map((row) => ({
    familyId: row.family_id as string,
    role: row.role as FamilyRole,
    displayName: (row.display_name as string | null) ?? null
  }));

  if (memberships.length === 0) {
    return [];
  }

  const familyIds = Array.from(new Set(memberships.map((membership) => membership.familyId))).filter(Boolean);
  const familyById = new Map<string, { name: string; joinCode: string | null; createdByUserId: string | null }>();

  const { data: familyRows, error: familyError } = await supabase
    .from("families")
    .select("id,name,join_code")
    .in("id", familyIds);

  if (familyError) {
    throw new Error(familyError.message);
  }

  for (const row of familyRows ?? []) {
    const id = row.id as string;
    const name = (row.name as string | null)?.trim();
    if (!id || !name) {
      continue;
    }

    familyById.set(id, {
      name,
      joinCode: (row.join_code as string | null) ?? null,
      createdByUserId: null
    });
  }

  return memberships.map((membership) => {
    const family = familyById.get(membership.familyId);
    return {
      familyId: membership.familyId,
      familyName: family?.name ?? "Care Group",
      role: membership.role,
      joinCode: family?.joinCode ?? null,
      displayName: membership.displayName,
      isCreator: Boolean(family?.createdByUserId && family.createdByUserId === userId)
    };
  });
}

export async function createFamilyForUser(input: {
  name: string;
  joinPassword: string;
  role: FamilyRole;
  displayName: string;
  familySituation: FamilySituation;
}): Promise<FamilyMembership> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase config missing");
  }

  const { data, error } = await supabase
    .rpc("create_family_and_membership", {
      family_name_input: input.name.trim(),
      join_password_input: input.joinPassword,
      family_situation_input: input.familySituation,
      role_input: input.role,
      display_name_input: input.displayName.trim()
    })
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create care group.");
  }

  /*
  Direct table writes replaced by RPC for principled auth:
  - insert into families
  - insert into family_members
  */

  const row = data as { family_id: string; family_name: string; role: FamilyRole; join_code: string | null; display_name: string | null };
  return {
    familyId: row.family_id,
    familyName: row.family_name,
    role: row.role,
    joinCode: row.join_code ?? null,
    displayName: row.display_name ?? input.displayName.trim(),
    isCreator: true
  };
}

export async function createFamilyRoleInvite(input: {
  familyId: string;
  role: FamilyRole;
}): Promise<{ inviteCode: string; role: FamilyRole }> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase config missing");
  }

  const { data, error } = await supabase
    .rpc("create_family_role_invite_secure", {
      target_family_id: input.familyId,
      target_role: input.role
    })
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create invite code.");
  }

  /*
  Direct insert into family_role_invites replaced by RPC.
  Actor identity is enforced server-side via auth.uid().
  */

  const row = data as { invite_code: string; role: FamilyRole };
  return { inviteCode: row.invite_code, role: row.role };
}

export async function joinFamilyForUser(input: {
  joinPassword: string;
  displayName: string;
  inviteCode: string;
}): Promise<FamilyMembership> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error("Supabase config missing");
  }

  const { data, error } = await supabase
    .rpc("join_family_with_invite", {
      invite_code_input: normalizeCode(input.inviteCode),
      join_password_input: input.joinPassword,
      display_name_input: input.displayName.trim()
    })
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not join care group.");
  }

  /*
  Direct read/write flow replaced by RPC:
  - select from family_role_invites + families
  - upsert family_members
  - update invite used_by/used_at
  */

  const row = data as { family_id: string; family_name: string; role: FamilyRole; join_code: string | null; display_name: string | null };
  return {
    familyId: row.family_id,
    familyName: row.family_name,
    role: row.role,
    joinCode: row.join_code ?? null,
    displayName: row.display_name ?? input.displayName.trim(),
    isCreator: false
  };
}

export async function fetchFamilySituation(familyId: string): Promise<FamilySituation | null> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.from("families").select("family_situation").eq("id", familyId).single();
  if (error) {
    throw new Error(error.message);
  }

  const raw = (data as { family_situation?: Partial<FamilySituation> | null } | null)?.family_situation;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const parseCount = (value: unknown): number => {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return 0;
    }
    return Math.max(0, Math.floor(n));
  };

  return {
    parent: parseCount(raw.parent),
    child: parseCount(raw.child),
    grandparent: parseCount(raw.grandparent),
    caretaker: parseCount(raw.caretaker),
    external_mediator: parseCount(raw.external_mediator),
    social_worker: parseCount(raw.social_worker)
  };
}

export async function fetchFamilyRoleInvites(familyId: string): Promise<FamilyRoleInviteRecord[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("family_role_invites")
    .select("id,family_id,invite_code,role,used_by,created_at")
    .eq("family_id", familyId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    familyId: row.family_id as string,
    inviteCode: row.invite_code as string,
    role: row.role as FamilyRole,
    usedBy: (row.used_by as string | null) ?? null,
    createdAt: (row.created_at as string | null) ?? null
  }));
}

export async function ensureOpenRoleInvites(input: {
  familyId: string;
  requiredOpenByRole: Partial<Record<FamilyRole, number>>;
}): Promise<FamilyRoleInviteRecord[]> {
  const allInvites = await fetchFamilyRoleInvites(input.familyId);
  const openByRole = new Map<FamilyRole, number>();

  for (const invite of allInvites) {
    if (invite.usedBy) {
      continue;
    }
    openByRole.set(invite.role, (openByRole.get(invite.role) ?? 0) + 1);
  }

  for (const [role, required] of Object.entries(input.requiredOpenByRole) as Array<[FamilyRole, number | undefined]>) {
    const needed = Math.max(0, Math.floor(required ?? 0));
    let current = openByRole.get(role) ?? 0;
    while (current < needed) {
      await createFamilyRoleInvite({
        familyId: input.familyId,
        role
      });
      current += 1;
      openByRole.set(role, current);
    }
  }

  return fetchFamilyRoleInvites(input.familyId);
}

export async function fetchFamilyMembers(familyId: string): Promise<FamilyMemberRecord[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.from("family_members").select("user_id,role,display_name,profile_photo_path").eq("family_id", familyId);
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    userId: row.user_id as string,
    role: row.role as FamilyRole,
    displayName: (row.display_name as string | null) ?? null,
    profilePhotoPath: (row.profile_photo_path as string | null) ?? null
  }));
}

export async function updateFamilyMemberProfilePhotoPath(input: {
  familyId: string;
  profilePhotoPath: string | null;
}): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("set_my_profile_photo_path", {
    target_family_id: input.familyId,
    profile_photo_path_input: input.profilePhotoPath
  });

  if (error) {
    throw new Error(error.message);
  }

  /*
  Direct update on family_members.profile_photo_path replaced by RPC.
  Actor identity is enforced server-side via auth.uid().
  */
}

export async function getFamilyMemberProfilePhotoSignedUrl(
  profilePhotoPath: string,
  expiresInSeconds = 60 * 60 * 24
): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !profilePhotoPath.trim()) {
    return null;
  }

  const { data, error } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).createSignedUrl(profilePhotoPath, expiresInSeconds);
  if (!error && data?.signedUrl) {
    return data.signedUrl;
  }

  // Fallback for public-bucket setups where signed URLs may fail under strict RLS.
  const { data: publicData } = supabase.storage.from(PROFILE_PHOTO_BUCKET).getPublicUrl(profilePhotoPath);
  const publicUrl = publicData?.publicUrl?.trim();
  return publicUrl || null;
}

export async function fetchThirdPartyConsents(familyId: string): Promise<Record<string, boolean>> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {};
  }

  const { data, error } = await supabase.from("families").select("third_party_consents").eq("id", familyId).single();
  if (error) {
    throw new Error(error.message);
  }

  const raw = (data as { third_party_consents?: unknown } | null)?.third_party_consents;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  const typed: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    typed[key] = Boolean(value);
  }
  return typed;
}

export async function upsertThirdPartyConsent(input: {
  familyId: string;
  caregiverId: string;
  consented: boolean;
}): Promise<Record<string, boolean>> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {};
  }

  const { data, error } = await supabase
    .rpc("set_third_party_consent_secure", {
      target_family_id: input.familyId,
      target_caregiver_id: input.caregiverId,
      consented_input: input.consented
    })
    .single();

  if (error) {
    throw new Error(error.message);
  }

  /*
  Direct read-modify-write on families.third_party_consents replaced by RPC.
  */

  const raw = (data as { third_party_consents?: unknown } | null)?.third_party_consents;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const typed: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    typed[key] = Boolean(value);
  }
  return typed;
}

export async function fetchCareRhythmState(familyId: string): Promise<CareRhythmStateRecord> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      rhythm: null,
      startDate: null,
      notes: "",
      locked: false,
      confirmedBy: []
    };
  }

  const { data, error } = await supabase
    .from("families")
    .select("care_rhythm,care_rhythm_start_date,care_rhythm_notes,care_rhythm_locked,care_rhythm_confirmed_by")
    .eq("id", familyId)
    .single();
  if (error) {
    throw new Error(error.message);
  }

  const row = (data as FamilyRow | null) ?? null;
  return {
    rhythm: row?.care_rhythm ?? null,
    startDate: row?.care_rhythm_start_date ?? null,
    notes: row?.care_rhythm_notes ?? "",
    locked: Boolean(row?.care_rhythm_locked),
    confirmedBy: ((row?.care_rhythm_confirmed_by as string[] | null) ?? []).filter(Boolean)
  };
}

export async function saveCareRhythmDraft(input: {
  familyId: string;
  rhythm: string;
  startDate: string;
  notes: string;
}): Promise<CareRhythmStateRecord> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      rhythm: input.rhythm,
      startDate: input.startDate,
      notes: input.notes,
      locked: false,
      confirmedBy: []
    };
  }

  const { data, error } = await supabase
    .rpc("save_care_rhythm_draft_secure", {
      target_family_id: input.familyId,
      rhythm_input: input.rhythm,
      start_date_input: input.startDate,
      notes_input: input.notes
    })
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Could not save care rhythm draft.");
  }

  /*
  Direct update on families care rhythm fields replaced by RPC.
  */

  const row = data as { rhythm: string | null; start_date: string | null; notes: string | null; locked: boolean | null; confirmed_by: string[] | null };
  return {
    rhythm: row.rhythm ?? null,
    startDate: row.start_date ?? null,
    notes: row.notes ?? "",
    locked: Boolean(row.locked),
    confirmedBy: (row.confirmed_by ?? []).filter(Boolean)
  };
}

export async function confirmCareRhythmBy(input: {
  familyId: string;
  approverMemberIds: string[];
  rhythm: string;
  startDate: string;
  notes: string;
}): Promise<CareRhythmStateRecord> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    const uniqueApproverIds = Array.from(new Set(input.approverMemberIds.filter(Boolean)));
    const nextConfirmed = uniqueApproverIds.length > 0 ? [uniqueApproverIds[0]] : [];
    const locked = uniqueApproverIds.length > 0 && uniqueApproverIds.every((id) => nextConfirmed.includes(id));
    return {
      rhythm: input.rhythm,
      startDate: input.startDate,
      notes: input.notes,
      locked,
      confirmedBy: nextConfirmed
    };
  }

  const { data, error } = await supabase
    .rpc("confirm_care_rhythm_secure", {
      target_family_id: input.familyId,
      rhythm_input: input.rhythm,
      start_date_input: input.startDate,
      notes_input: input.notes,
      primary_caregiver_ids_input: input.approverMemberIds
    })
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Could not confirm care rhythm.");
  }

  /*
  Direct update logic replaced by RPC.
  Actor identity is enforced server-side via auth.uid().
  */

  const row = data as { rhythm: string | null; start_date: string | null; notes: string | null; locked: boolean | null; confirmed_by: string[] | null };
  return {
    rhythm: row.rhythm ?? null,
    startDate: row.start_date ?? null,
    notes: row.notes ?? "",
    locked: Boolean(row.locked),
    confirmedBy: (row.confirmed_by ?? []).filter(Boolean)
  };
}

export async function fetchCalendarEvents(familyId: string): Promise<CalendarEvent[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("calendar_events")
    .select("id,title,starts_at,ends_at,created_by")
    .eq("family_id", familyId)
    .order("starts_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    startsAt: row.starts_at as string,
    endsAt: row.ends_at as string,
    createdBy: (row.created_by as string | null) ?? null
  }));
}

export async function createCalendarEvent(familyId: string, title: string, createdBy: string): Promise<void> {
  const startsAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await createCalendarEventAt({
    familyId,
    title,
    startsAt,
    endsAt,
    createdBy
  });
}

export async function createCalendarEventAt(input: {
  familyId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  createdBy: string;
}): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("create_calendar_event_secure", {
    target_family_id: input.familyId,
    title_input: input.title,
    starts_at_input: input.startsAt,
    ends_at_input: input.endsAt
  });

  if (error) {
    throw new Error(error.message);
  }

  /*
  Direct insert into calendar_events replaced by RPC.
  createdBy is enforced server-side via auth.uid().
  */
}

export async function deleteCalendarEvent(familyId: string, eventId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("delete_calendar_event_secure", {
    target_family_id: familyId,
    target_event_id: eventId
  });
  if (error) {
    throw new Error(error.message);
  }

  /*
  Direct delete on calendar_events replaced by RPC.
  */
}

export async function fetchChatMessages(familyId: string): Promise<ChatMessageRecord[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("chat_messages")
    .select("id,family_id,topic,body,sender_user_id,created_at")
    .eq("family_id", familyId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    familyId: row.family_id as string,
    topic: row.topic as string,
    body: row.body as string,
    senderUserId: row.sender_user_id as string,
    createdAt: row.created_at as string
  }));
}

export async function createChatMessage(input: {
  familyId: string;
  topic: string;
  body: string;
}): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("create_chat_message_secure", {
    target_family_id: input.familyId,
    topic_input: input.topic,
    body_input: input.body
  });

  if (error) {
    throw new Error(error.message);
  }

  /*
  Direct insert into chat_messages replaced by RPC.
  Actor identity is enforced server-side via auth.uid().
  */
}

export async function fetchDecisions(familyId: string): Promise<FamilyDecision[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.from("family_decisions").select("id,title,status").eq("family_id", familyId);
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    status: row.status as "open" | "closed"
  }));
}

export async function createDecision(familyId: string, title: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("create_family_decision_secure", {
    target_family_id: familyId,
    title_input: title
  });

  if (error) {
    throw new Error(error.message);
  }

  /*
  Direct insert into family_decisions replaced by RPC.
  Actor identity is enforced server-side via auth.uid().
  */
}

export async function fetchDocuments(familyId: string, role: FamilyRole): Promise<FamilyDocument[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("family_documents")
    .select("id,file_path,visibility_roles")
    .eq("family_id", familyId)
    .contains("visibility_roles", [role]);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    filePath: row.file_path as string,
    visibilityRoles: row.visibility_roles as FamilyRole[]
  }));
}

export async function fetchScheduleRequests(familyId: string): Promise<ScheduleRequestRecord[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("schedule_requests")
    .select("id,type,date,note,status,requested_by,affected_member_ids,approver_member_ids,approved_by_ids")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    type: row.type as string,
    date: row.date as string,
    note: row.note as string,
    status: row.status as "pending" | "approved" | "declined",
    requestedBy: row.requested_by as string,
    affectedMemberIds: ((row.affected_member_ids as string[] | null) ?? []).filter(Boolean),
    approverMemberIds: ((row.approver_member_ids as string[] | null) ?? []).filter(Boolean),
    approvedByIds: ((row.approved_by_ids as string[] | null) ?? []).filter(Boolean)
  }));
}

export async function createScheduleRequest(input: {
  familyId: string;
  type: string;
  date: string;
  note: string;
  affectedMemberIds: string[];
  approverMemberIds: string[];
}): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("create_schedule_request_secure", {
    target_family_id: input.familyId,
    type_input: input.type,
    date_input: input.date,
    note_input: input.note,
    affected_member_ids_input: input.affectedMemberIds,
    approver_member_ids_input: input.approverMemberIds
  });

  if (error) {
    throw new Error(error.message);
  }

  /*
  Direct insert into schedule_requests replaced by RPC.
  Actor identity is enforced server-side via auth.uid().
  */
}

export async function updateScheduleRequestStatus(input: {
  familyId: string;
  requestId: string;
  status: "approved" | "declined";
}): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("update_schedule_request_status_secure", {
    target_family_id: input.familyId,
    target_request_id: input.requestId,
    status_input: input.status
  });
  if (error) {
    throw new Error(error.message);
  }

  /*
  Direct select/update flow on schedule_requests replaced by RPC.
  Actor identity is enforced server-side via auth.uid().
  */
}
