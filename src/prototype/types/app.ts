export type FamilyRole = "parent" | "child" | "grandparent" | "caretaker" | "external_mediator" | "social_worker";

export type TabKey = "home" | "chat" | "calendar" | "decisions" | "documents";

export interface CalendarEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  createdBy?: string | null;
}

export interface FamilyDecision {
  id: string;
  title: string;
  status: "open" | "closed";
}

export interface FamilyDocument {
  id: string;
  filePath: string;
  visibilityRoles: FamilyRole[];
}

export interface MatrixRoom {
  room_id: string;
}

export interface ChatMessage {
  event_id: string;
  sender: string;
  body: string;
  ts: number;
}
