export type FamilyRole = "parent" | "child" | "grandparent" | "caretaker" | "external_mediator";

export type FamilyPermission =
  | "chat.read"
  | "chat.send"
  | "calendar.read"
  | "calendar.write"
  | "decision.vote"
  | "decision.create"
  | "document.read"
  | "document.upload"
  | "document.visibility.manage"
  | "family.members.manage";

export const rolePermissions: Record<FamilyRole, FamilyPermission[]> = {
  parent: [
    "chat.read",
    "chat.send",
    "calendar.read",
    "calendar.write",
    "decision.vote",
    "decision.create",
    "document.read",
    "document.upload",
    "document.visibility.manage",
    "family.members.manage"
  ],
  child: ["chat.read", "chat.send", "calendar.read", "decision.vote", "document.read"],
  grandparent: [
    "chat.read",
    "chat.send",
    "calendar.read",
    "decision.vote",
    "document.read",
    "document.upload"
  ],
  caretaker: [
    "chat.read",
    "chat.send",
    "calendar.read",
    "calendar.write",
    "decision.vote",
    "document.read",
    "document.upload"
  ],
  external_mediator: [
    "chat.read",
    "chat.send",
    "calendar.read",
    "decision.vote",
    "document.read"
  ]
};

export function hasPermission(role: FamilyRole, permission: FamilyPermission): boolean {
  return rolePermissions[role].includes(permission);
}
