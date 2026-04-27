# Matrix-First Architecture (ParentsAPP)

## Core Direction

Messaging is built on Matrix as the source of truth for chat events and room membership.
Supabase remains the app data layer for structured entities (families, roles, calendar, decisions, documents metadata).

## Text Diagram

[Mobile/Web App]
-> [API/Edge layer]
-> [Supabase: auth, profiles, family metadata, events, votes, docs metadata]
-> [Matrix Homeserver: room state, message events, E2EE sessions, history]
-> [AI Mediation Service: tone-check and neutral summaries]

## Suggested Boundaries

- Matrix owns:
  - 1:1 + group messaging rooms
  - immutable message timeline
  - membership and event state
  - end-to-end encryption primitives
- Supabase owns:
  - role model and app-level RBAC mapping
  - family groups and relationship mapping
  - calendar events and invitations
  - voting/decisions and expense/doc metadata
  - audit references to Matrix event IDs

## Room Strategy

- `family.main`: default coordination room for each family group.
- `family.private`: optional role-scoped or subgroup conversations.
- `family.decision`: linked room/thread for structured decisions.

Room metadata should include:
- `io.parentsapp.family_id`
- `io.parentsapp.room_type`
- `io.parentsapp.visibility_policy`

## Security Notes

- Enable Matrix E2EE for all family rooms by default.
- Keep message deletion disabled at UI policy level and track redaction actions in audits.
- Store only minimal transcript excerpts for AI calls; redact child-identifying data where possible.
- Keep AI optional and transparent to users.

## MVP Delivery Order

1. Auth + family/role model in Supabase.
2. Matrix room provisioning and message send/receive.
3. Calendar + decisions + docs metadata flows.
4. AI tone-check and mediation summaries with safety guardrails.
5. Cross-platform polish and accessibility pass.
