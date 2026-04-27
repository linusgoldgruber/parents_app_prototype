export type TourRole = "parent" | "child" | "grandparent" | "caretaker" | "external_mediator" | "social_worker";

export type TourTargetKey =
  | "tab-bar"
  | "tab-home"
  | "tab-schedule"
  | "tab-chat"
  | "tab-handover"
  | "tab-more";

export interface TourStep {
  id: string;
  title: string;
  body: string;
  targetKey: TourTargetKey;
  optionalForRoles?: TourRole[];
}
