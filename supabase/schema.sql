-- Families and membership
create table if not exists families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
alter table families add column if not exists join_code text;
alter table families add column if not exists join_password text;
alter table families add column if not exists family_situation jsonb not null default '{}'::jsonb;
alter table families add column if not exists created_by_user_id uuid;
alter table families add column if not exists third_party_consents jsonb not null default '{}'::jsonb;
alter table families add column if not exists care_rhythm text;
alter table families add column if not exists care_rhythm_start_date date;
alter table families add column if not exists care_rhythm_notes text not null default '';
alter table families add column if not exists care_rhythm_locked boolean not null default false;
alter table families add column if not exists care_rhythm_confirmed_by uuid[] not null default '{}';

create table if not exists family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('parent', 'child', 'grandparent', 'caretaker', 'external_mediator', 'social_worker')),
  display_name text,
  created_at timestamptz not null default now(),
  unique (family_id, user_id)
);
alter table family_members add column if not exists display_name text;
alter table family_members add column if not exists profile_photo_path text;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'family_members_role_check'
  ) then
    alter table family_members drop constraint family_members_role_check;
  end if;

  alter table family_members
    add constraint family_members_role_check
    check (role in ('parent', 'child', 'grandparent', 'caretaker', 'external_mediator', 'social_worker'));
exception
  when duplicate_object then null;
end
$$;

create table if not exists family_role_invites (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  invite_code text not null unique,
  role text not null check (role in ('parent', 'child', 'grandparent', 'caretaker', 'external_mediator', 'social_worker')),
  created_by uuid not null,
  used_by uuid,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Matrix room bindings
create table if not exists matrix_room_bindings (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  app_conversation_id text not null,
  matrix_room_id text not null unique,
  room_type text not null check (room_type in ('family.main', 'family.private', 'family.decision')),
  created_at timestamptz not null default now(),
  unique (family_id, app_conversation_id)
);

-- Calendar
create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists schedule_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  type text not null check (type in ('day_swap', 'coverage', 'extra_time', 'holiday_change')),
  date date not null,
  note text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  requested_by uuid not null,
  affected_member_ids uuid[] not null default '{}',
  approver_member_ids uuid[] not null default '{}',
  approved_by_ids uuid[] not null default '{}',
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table schedule_requests add column if not exists affected_member_ids uuid[] not null default '{}';
alter table schedule_requests add column if not exists approver_member_ids uuid[] not null default '{}';
alter table schedule_requests add column if not exists approved_by_ids uuid[] not null default '{}';

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  topic text not null check (topic in ('logistics', 'school', 'health', 'expenses', 'decisions')),
  body text not null,
  sender_user_id uuid not null,
  created_at timestamptz not null default now()
);

-- Decisions and votes
create table if not exists family_decisions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists decision_options (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references family_decisions(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now()
);

create table if not exists decision_votes (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references family_decisions(id) on delete cascade,
  option_id uuid not null references decision_options(id) on delete cascade,
  voter_id uuid not null,
  created_at timestamptz not null default now(),
  unique (decision_id, voter_id)
);

-- Documents metadata
create table if not exists family_documents (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  uploaded_by uuid not null,
  file_path text not null,
  visibility_roles text[] not null,
  created_at timestamptz not null default now()
);

-- Basic indexes
create index if not exists idx_family_members_family on family_members(family_id);
create unique index if not exists idx_family_members_family_display_name_unique on family_members (family_id, lower(display_name))
where display_name is not null;
create unique index if not exists idx_families_join_code on families(join_code);
create unique index if not exists idx_family_role_invites_code on family_role_invites(invite_code);
create index if not exists idx_family_role_invites_family on family_role_invites(family_id);
create index if not exists idx_calendar_events_family_start on calendar_events(family_id, starts_at);
create index if not exists idx_schedule_requests_family_created on schedule_requests(family_id, created_at desc);
create index if not exists idx_chat_messages_family_created on chat_messages(family_id, created_at asc);
create index if not exists idx_family_decisions_family_status on family_decisions(family_id, status);
create index if not exists idx_family_documents_family on family_documents(family_id);

-- Prototype mode: keep table access simple for authenticated users.
grant usage on schema public to authenticated;
grant select, insert, update, delete on families to authenticated;
grant select, insert, update, delete on family_members to authenticated;
grant select, insert, update, delete on family_role_invites to authenticated;
grant select, insert, update, delete on calendar_events to authenticated;
grant select, insert, update, delete on schedule_requests to authenticated;
grant select, insert, update, delete on chat_messages to authenticated;

create or replace function public.is_family_member(target_family_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = auth.uid()
  );
$$;

revoke all on function public.is_family_member(uuid) from public;
grant execute on function public.is_family_member(uuid) to authenticated;

alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_role_invites enable row level security;
alter table public.matrix_room_bindings enable row level security;
alter table public.calendar_events enable row level security;
alter table public.schedule_requests enable row level security;
alter table public.chat_messages enable row level security;
alter table public.family_decisions enable row level security;
alter table public.decision_options enable row level security;
alter table public.decision_votes enable row level security;
alter table public.family_documents enable row level security;

drop policy if exists families_select_member on public.families;
drop policy if exists families_insert_authenticated on public.families;
drop policy if exists families_update_member on public.families;
create policy families_select_member on public.families for select to authenticated using (public.is_family_member(id));
create policy families_insert_authenticated on public.families for insert to authenticated with check (auth.uid() is not null);
create policy families_update_member on public.families for update to authenticated using (public.is_family_member(id)) with check (public.is_family_member(id));

drop policy if exists family_members_select_same_family on public.family_members;
drop policy if exists family_members_insert_self on public.family_members;
drop policy if exists family_members_update_self on public.family_members;
create policy family_members_select_same_family on public.family_members for select to authenticated using (public.is_family_member(family_id));
create policy family_members_insert_self on public.family_members for insert to authenticated with check (user_id = auth.uid());
create policy family_members_update_self on public.family_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists family_role_invites_select_member on public.family_role_invites;
create policy family_role_invites_select_member on public.family_role_invites for select to authenticated using (public.is_family_member(family_id));

drop policy if exists matrix_room_bindings_member_read on public.matrix_room_bindings;
create policy matrix_room_bindings_member_read on public.matrix_room_bindings for select to authenticated using (public.is_family_member(family_id));

drop policy if exists calendar_events_select_member on public.calendar_events;
create policy calendar_events_select_member on public.calendar_events for select to authenticated using (public.is_family_member(family_id));

drop policy if exists schedule_requests_select_member on public.schedule_requests;
create policy schedule_requests_select_member on public.schedule_requests for select to authenticated using (public.is_family_member(family_id));

drop policy if exists chat_messages_select_member on public.chat_messages;
create policy chat_messages_select_member on public.chat_messages for select to authenticated using (public.is_family_member(family_id));

drop policy if exists family_decisions_select_member on public.family_decisions;
create policy family_decisions_select_member on public.family_decisions for select to authenticated using (public.is_family_member(family_id));

drop policy if exists decision_options_select_member on public.decision_options;
create policy decision_options_select_member
on public.decision_options
for select
to authenticated
using (
  exists (
    select 1
    from public.family_decisions fd
    where fd.id = decision_options.decision_id
      and public.is_family_member(fd.family_id)
  )
);

drop policy if exists decision_votes_select_member on public.decision_votes;
create policy decision_votes_select_member
on public.decision_votes
for select
to authenticated
using (
  exists (
    select 1
    from public.family_decisions fd
    where fd.id = decision_votes.decision_id
      and public.is_family_member(fd.family_id)
  )
);

drop policy if exists family_documents_select_member on public.family_documents;
create policy family_documents_select_member on public.family_documents for select to authenticated using (public.is_family_member(family_id));

create or replace function public.get_my_family_memberships_secure()
returns table (
  family_id uuid,
  family_name text,
  role text,
  join_code text,
  display_name text,
  is_creator boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select
    fm.family_id,
    f.name as family_name,
    fm.role,
    f.join_code,
    fm.display_name,
    (f.created_by_user_id = v_uid) as is_creator
  from public.family_members fm
  join public.families f on f.id = fm.family_id
  where fm.user_id = v_uid
  order by fm.created_at asc;
end;
$$;

create or replace function public.create_family_and_membership(
  family_name_input text,
  join_password_input text,
  family_situation_input jsonb,
  role_input text,
  display_name_input text
)
returns table (
  family_id uuid,
  family_name text,
  role text,
  join_code text,
  display_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_family_id uuid := gen_random_uuid();
  v_role text := lower(trim(role_input));
  v_display_name text := trim(display_name_input);
  v_family_name text := btrim(family_name_input);
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if family_name_input is null or v_family_name = '' then
    raise exception 'Care group name is required';
  end if;
  if v_display_name = '' then
    raise exception 'Display name is required';
  end if;
  if v_role not in ('parent', 'child', 'grandparent', 'caretaker', 'external_mediator', 'social_worker') then
    raise exception 'Invalid role';
  end if;
  if exists (
    select 1
    from public.families f
    where lower(btrim(f.name)) = lower(v_family_name)
  ) then
    raise exception 'Care group name already exists. Please choose a different name.';
  end if;

  insert into public.families (id, name, join_password, family_situation, created_by_user_id)
  values (v_family_id, v_family_name, join_password_input, coalesce(family_situation_input, '{}'::jsonb), v_uid);

  insert into public.family_members (family_id, user_id, role, display_name)
  values (v_family_id, v_uid, v_role, v_display_name);

  return query
  select v_family_id, v_family_name, v_role, null::text, v_display_name;
end;
$$;

create or replace function public.create_family_role_invite_secure(
  target_family_id uuid,
  target_role text
)
returns table (
  invite_code text,
  role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_target_role text := lower(trim(target_role));
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if v_target_role not in ('parent', 'child', 'grandparent', 'caretaker', 'external_mediator', 'social_worker') then
    raise exception 'Invalid role';
  end if;
  if not exists (
    select 1
    from public.families f
    where f.id = target_family_id
      and f.created_by_user_id = v_uid
  ) then
    raise exception 'Only the care group creator can create role invite codes.';
  end if;

  for idx in 1..8 loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    begin
      insert into public.family_role_invites (family_id, invite_code, role, created_by)
      values (target_family_id, v_code, v_target_role, v_uid);
      return query select v_code, v_target_role;
      return;
    exception
      when unique_violation then
        continue;
    end;
  end loop;

  raise exception 'Could not generate a unique invite code. Please try again.';
end;
$$;

create or replace function public.join_family_with_invite(
  invite_code_input text,
  join_password_input text,
  display_name_input text
)
returns table (
  family_id uuid,
  family_name text,
  role text,
  join_code text,
  display_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_invite_id uuid;
  v_family_id uuid;
  v_role text;
  v_used_by uuid;
  v_family_name text;
  v_join_password text;
  v_join_code text;
  v_display_name text := trim(display_name_input);
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if v_display_name = '' then
    raise exception 'Display name is required';
  end if;

  select fri.id, fri.family_id, fri.role, fri.used_by
  into v_invite_id, v_family_id, v_role, v_used_by
  from public.family_role_invites fri
  where fri.invite_code = upper(trim(invite_code_input))
  for update;

  if not found then
    raise exception 'Role invite code not found.';
  end if;
  if v_used_by is not null then
    raise exception 'Role invite code already used.';
  end if;

  select f.name, f.join_password, f.join_code
  into v_family_name, v_join_password, v_join_code
  from public.families f
  where f.id = v_family_id;

  if not found then
    raise exception 'Care group not found for this invite code.';
  end if;
  if coalesce(v_join_password, '') <> coalesce(join_password_input, '') then
    raise exception 'Care group password is incorrect.';
  end if;

  insert into public.family_members (family_id, user_id, role, display_name)
  values (v_family_id, v_uid, v_role, v_display_name)
  on conflict on constraint family_members_family_id_user_id_key
  do update set role = excluded.role, display_name = excluded.display_name;

  update public.family_role_invites
  set used_by = v_uid, used_at = now()
  where id = v_invite_id and used_by is null;

  if not found then
    raise exception 'Role invite code already used.';
  end if;

  return query
  select v_family_id, v_family_name, v_role, v_join_code, v_display_name;
end;
$$;

create or replace function public.set_my_profile_photo_path(
  target_family_id uuid,
  profile_photo_path_input text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_family_member(target_family_id) then
    raise exception 'Not a member of this care group.';
  end if;

  update public.family_members
  set profile_photo_path = profile_photo_path_input
  where family_id = target_family_id
    and user_id = v_uid;
end;
$$;

create or replace function public.set_third_party_consent_secure(
  target_family_id uuid,
  target_caregiver_id uuid,
  consented_input boolean
)
returns table (
  third_party_consents jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_consents jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1
    from public.family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = auth.uid()
      and fm.role = 'parent'
  ) then
    raise exception 'Only primary caregivers can update third-party consents.';
  end if;

  select coalesce(f.third_party_consents, '{}'::jsonb)
  into v_consents
  from public.families f
  where f.id = target_family_id
  for update;

  if not found then
    raise exception 'Care group not found.';
  end if;

  v_consents := jsonb_set(v_consents, array[target_caregiver_id::text], to_jsonb(consented_input), true);

  update public.families
  set third_party_consents = v_consents
  where id = target_family_id;

  return query select v_consents;
end;
$$;

create or replace function public.save_care_rhythm_draft_secure(
  target_family_id uuid,
  rhythm_input text,
  start_date_input date,
  notes_input text
)
returns table (
  rhythm text,
  start_date date,
  notes text,
  locked boolean,
  confirmed_by uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1
    from public.family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = auth.uid()
      and fm.role = 'parent'
  ) then
    raise exception 'Only primary caregivers can update care rhythm.';
  end if;

  update public.families
  set
    care_rhythm = rhythm_input,
    care_rhythm_start_date = start_date_input,
    care_rhythm_notes = coalesce(notes_input, ''),
    care_rhythm_locked = false,
    care_rhythm_confirmed_by = '{}'::uuid[]
  where id = target_family_id;

  return query
  select
    f.care_rhythm,
    f.care_rhythm_start_date,
    f.care_rhythm_notes,
    f.care_rhythm_locked,
    f.care_rhythm_confirmed_by
  from public.families f
  where f.id = target_family_id;
end;
$$;

create or replace function public.confirm_care_rhythm_secure(
  target_family_id uuid,
  rhythm_input text,
  start_date_input date,
  notes_input text,
  primary_caregiver_ids_input uuid[]
)
returns table (
  rhythm text,
  start_date date,
  notes text,
  locked boolean,
  confirmed_by uuid[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing uuid[] := '{}'::uuid[];
  v_primary uuid[] := coalesce(primary_caregiver_ids_input, '{}'::uuid[]);
  v_next uuid[] := '{}'::uuid[];
  v_locked boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not exists (
    select 1
    from public.family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = v_uid
      and fm.role in ('parent', 'external_mediator', 'social_worker')
  ) then
    raise exception 'Only required baseline approvers can confirm care rhythm.';
  end if;

  if array_position(v_primary, v_uid) is null then
    raise exception 'You are not in the required approver set for this baseline.';
  end if;

  select coalesce(f.care_rhythm_confirmed_by, '{}'::uuid[])
  into v_existing
  from public.families f
  where f.id = target_family_id
  for update;

  if not found then
    raise exception 'Care group not found.';
  end if;

  select coalesce(array_agg(distinct member_id), '{}'::uuid[])
  into v_next
  from unnest(v_existing) member_id
  where array_position(v_primary, member_id) is not null;

  if array_position(v_next, v_uid) is null then
    v_next := array_append(v_next, v_uid);
  end if;

  if coalesce(array_length(v_primary, 1), 0) >= 2 then
    select bool_and(array_position(v_next, primary_id) is not null)
    into v_locked
    from unnest(v_primary) as primary_id;
  end if;

  update public.families
  set
    care_rhythm = rhythm_input,
    care_rhythm_start_date = start_date_input,
    care_rhythm_notes = coalesce(notes_input, ''),
    care_rhythm_locked = coalesce(v_locked, false),
    care_rhythm_confirmed_by = v_next
  where id = target_family_id;

  return query
  select
    f.care_rhythm,
    f.care_rhythm_start_date,
    f.care_rhythm_notes,
    f.care_rhythm_locked,
    f.care_rhythm_confirmed_by
  from public.families f
  where f.id = target_family_id;
end;
$$;

create or replace function public.create_calendar_event_secure(
  target_family_id uuid,
  title_input text,
  starts_at_input timestamptz,
  ends_at_input timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_family_member(target_family_id) then
    raise exception 'Not a member of this care group.';
  end if;
  if starts_at_input >= ends_at_input then
    raise exception 'End time must be after start time.';
  end if;

  insert into public.calendar_events (family_id, title, starts_at, ends_at, created_by)
  values (target_family_id, title_input, starts_at_input, ends_at_input, auth.uid());
end;
$$;

create or replace function public.delete_calendar_event_secure(
  target_family_id uuid,
  target_event_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.calendar_events ce
  where ce.family_id = target_family_id
    and ce.id = target_event_id
    and ce.created_by = auth.uid();

  if not found then
    raise exception 'Only the member who created this event can delete it.';
  end if;
end;
$$;

create or replace function public.create_chat_message_secure(
  target_family_id uuid,
  topic_input text,
  body_input text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_family_member(target_family_id) then
    raise exception 'Not a member of this care group.';
  end if;
  if body_input is null or btrim(body_input) = '' then
    raise exception 'Message cannot be empty.';
  end if;

  insert into public.chat_messages (family_id, topic, body, sender_user_id)
  values (target_family_id, topic_input, body_input, auth.uid());
end;
$$;

create or replace function public.create_family_decision_secure(
  target_family_id uuid,
  title_input text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_family_member(target_family_id) then
    raise exception 'Not a member of this care group.';
  end if;
  if title_input is null or btrim(title_input) = '' then
    raise exception 'Decision title is required.';
  end if;

  insert into public.family_decisions (family_id, title, status, created_by)
  values (target_family_id, btrim(title_input), 'open', auth.uid());
end;
$$;

create or replace function public.create_schedule_request_secure(
  target_family_id uuid,
  type_input text,
  date_input date,
  note_input text,
  affected_member_ids_input uuid[],
  approver_member_ids_input uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_family_member(target_family_id) then
    raise exception 'Not a member of this care group.';
  end if;

  insert into public.schedule_requests (
    family_id,
    type,
    date,
    note,
    status,
    requested_by,
    affected_member_ids,
    approver_member_ids,
    approved_by_ids
  )
  values (
    target_family_id,
    type_input,
    date_input,
    note_input,
    'pending',
    auth.uid(),
    coalesce(affected_member_ids_input, '{}'::uuid[]),
    coalesce(approver_member_ids_input, '{}'::uuid[]),
    '{}'::uuid[]
  );
end;
$$;

create or replace function public.update_schedule_request_status_secure(
  target_family_id uuid,
  target_request_id uuid,
  status_input text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_request public.schedule_requests%rowtype;
  v_approved uuid[] := '{}'::uuid[];
  v_fully_approved boolean := false;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into v_request
  from public.schedule_requests sr
  where sr.family_id = target_family_id
    and sr.id = target_request_id
  for update;

  if not found then
    raise exception 'Schedule request not found.';
  end if;
  if v_request.requested_by = v_uid then
    raise exception 'You cannot approve your own request.';
  end if;
  if array_position(coalesce(v_request.approver_member_ids, '{}'::uuid[]), v_uid) is null then
    raise exception 'You are not listed as an approver for this request.';
  end if;

  if status_input = 'declined' then
    update public.schedule_requests
    set
      status = 'declined',
      reviewed_by = v_uid,
      reviewed_at = now()
    where id = target_request_id
      and family_id = target_family_id;
    return;
  end if;

  if status_input <> 'approved' then
    raise exception 'Invalid status transition.';
  end if;

  v_approved := coalesce(v_request.approved_by_ids, '{}'::uuid[]);
  if array_position(v_approved, v_uid) is null then
    v_approved := array_append(v_approved, v_uid);
  end if;

  select bool_and(array_position(v_approved, approver_id) is not null)
  into v_fully_approved
  from unnest(coalesce(v_request.approver_member_ids, '{}'::uuid[])) as approver_id;

  update public.schedule_requests
  set
    status = case when coalesce(v_fully_approved, false) then 'approved' else 'pending' end,
    approved_by_ids = v_approved,
    reviewed_by = v_uid,
    reviewed_at = now()
  where id = target_request_id
    and family_id = target_family_id;
end;
$$;

grant execute on function public.create_family_and_membership(text, text, jsonb, text, text) to authenticated;
grant execute on function public.get_my_family_memberships_secure() to authenticated;
grant execute on function public.create_family_role_invite_secure(uuid, text) to authenticated;
grant execute on function public.join_family_with_invite(text, text, text) to authenticated;
grant execute on function public.set_my_profile_photo_path(uuid, text) to authenticated;
grant execute on function public.set_third_party_consent_secure(uuid, uuid, boolean) to authenticated;
grant execute on function public.save_care_rhythm_draft_secure(uuid, text, date, text) to authenticated;
grant execute on function public.confirm_care_rhythm_secure(uuid, text, date, text, uuid[]) to authenticated;
grant execute on function public.create_calendar_event_secure(uuid, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.delete_calendar_event_secure(uuid, uuid) to authenticated;
grant execute on function public.create_chat_message_secure(uuid, text, text) to authenticated;
grant execute on function public.create_family_decision_secure(uuid, text) to authenticated;
grant execute on function public.create_schedule_request_secure(uuid, text, date, text, uuid[], uuid[]) to authenticated;
grant execute on function public.update_schedule_request_status_secure(uuid, uuid, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  true,
  26214400,
  array['image/jpeg','image/png','image/webp','image/gif','image/bmp','image/tiff','image/heic','image/heif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists profile_photos_select_authenticated on storage.objects;
drop policy if exists profile_photos_insert_authenticated on storage.objects;
drop policy if exists profile_photos_update_authenticated on storage.objects;
drop policy if exists profile_photos_delete_authenticated on storage.objects;

create policy profile_photos_select_authenticated
on storage.objects
for select
to authenticated
using (bucket_id = 'profile-photos');

create policy profile_photos_insert_authenticated
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'profile-photos'
  and owner = auth.uid()
);

create policy profile_photos_update_authenticated
on storage.objects
for update
to authenticated
using (
  bucket_id = 'profile-photos'
  and owner = auth.uid()
)
with check (
  bucket_id = 'profile-photos'
  and owner = auth.uid()
);

create policy profile_photos_delete_authenticated
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'profile-photos'
  and owner = auth.uid()
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end
$$;
