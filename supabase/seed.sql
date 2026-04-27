-- Prototype Family Seed
-- Use this after running schema.sql

insert into families (id, name, join_code, join_password)
values ('11111111-1111-1111-1111-111111111111', 'Prototype Family', 'DEMOFAMILY', 'demo123')
on conflict (id) do update
set join_code = excluded.join_code,
    join_password = excluded.join_password;

-- Example members (replace user_id values with real auth user UUIDs)
insert into family_members (family_id, user_id, role, display_name)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'parent', 'Alex'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000002', 'child', 'Sam'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000003', 'grandparent', 'Grandma Eva'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000004', 'external_mediator', 'Jordan')
on conflict (family_id, user_id) do update
set display_name = excluded.display_name;

insert into family_documents (family_id, uploaded_by, file_path, visibility_roles)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'school/report-card.pdf', array['parent', 'child', 'grandparent']),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'health/vaccination-record.pdf', array['parent', 'caretaker'])
on conflict do nothing;
