import type { TourStep } from "./tourTypes";

export const APP_TOUR_VERSION = "v2";

export const APP_TOUR_STEPS: TourStep[] = [
  {
    id: "menu-overview",
    title: "Menu Bar",
    body: "This bar is your main navigation. It always stays at the bottom so you can move quickly between core areas.",
    targetKey: "tab-bar"
  },
  {
    id: "menu-home",
    title: "Home",
    body: "Home gives you a quick snapshot of today: key events and pending requests.",
    targetKey: "tab-home"
  },
  {
    id: "menu-schedule",
    title: "Schedule",
    body: "Schedule is where shared calendar planning, care rhythm, and change requests are managed.",
    targetKey: "tab-schedule"
  },
  {
    id: "menu-chat",
    title: "Chat",
    body: "Chat supports topic-based communication and calmer coordination between caregivers.",
    targetKey: "tab-chat"
  },
  {
    id: "menu-handover",
    title: "Handover",
    body: "Handover includes transition checklists and check-ins to reduce stress between homes.",
    targetKey: "tab-handover"
  },
  {
    id: "menu-settings",
    title: "Settings",
    body: "Settings contains profile, language, invite, and governance options for your care group.",
    targetKey: "tab-more"
  }
];
