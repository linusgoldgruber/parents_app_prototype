import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ActivityIndicator,
  Animated,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Calendar as RNCalendar, type DateData } from "react-native-calendars";
import { RRule } from "rrule";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";
import { ResizeMode, Video } from "expo-av";
import { getDemoFamilyId, hasSupabaseConfig } from "./src/prototype/lib/env";
import {
  createChatMessage,
  confirmCareRhythmBy,
  createCalendarEventAt,
  createFamilyForUser,
  createFamilyRoleInvite,
  createScheduleRequest,
  deleteCalendarEvent as deleteCalendarEventRecord,
  fetchCareRhythmState,
  fetchFamilyMembers,
  getFamilyMemberProfilePhotoSignedUrl,
  fetchScheduleRequests,
  fetchThirdPartyConsents,
  fetchUserFamilies,
  fetchCalendarEvents,
  fetchChatMessages,
  joinFamilyForUser,
  saveCareRhythmDraft,
  updateFamilyMemberProfilePhotoPath,
  upsertThirdPartyConsent,
  updateScheduleRequestStatus
} from "./src/prototype/lib/data";
import { getAssistiveAiAdapter, type AssistanceState, type LanguageCode } from "./src/prototype/lib/assistiveAi";
import { getSupabaseClient, getValidatedSession, signIn, signOut, signUp } from "./src/prototype/lib/supabaseClient";
import { useAppTour } from "./src/prototype/tour/useAppTour";
import type { TourTargetKey } from "./src/prototype/tour/tourTypes";

type FamilyRole = "parent" | "child" | "grandparent" | "caretaker" | "external_mediator" | "social_worker";
type CareParticipantRole = "parent" | "grandparent" | "caretaker" | "external_mediator" | "social_worker";
type AppTab = "home" | "schedule" | "chat" | "handover" | "more";
type AuthMode = "sign_in" | "create_account";
type FamilySetupMode = "create" | "join";
type RequestType = "day_swap" | "coverage" | "extra_time" | "holiday_change";
type RequestUrgency = "low" | "medium" | "high";
type ScheduleTemplateKey = "two_two_three" | "week_on_week_off" | "weekday_weekend" | "custom";
type RequestStatus = "pending" | "approved" | "declined";
type ChatTopic = "logistics" | "school" | "health" | "expenses" | "decisions";
type RecurrenceType = "none" | "weekly" | "monthly";
type AuditScope = "minimal" | "standard";

interface TourRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  recurrence: RecurrenceType;
  color: string;
  createdBy: string;
}

interface ScheduleRequest {
  id: string;
  type: RequestType;
  date: string;
  note: string;
  status: RequestStatus;
  createdBy: string;
  requestedByUserId?: string;
  requestedByDisplayName?: string;
  affectedMemberIds: string[];
  approverMemberIds: string[];
  approvedByIds: string[];
}

interface FamilyMember {
  userId: string;
  role: FamilyRole;
  displayName: string | null;
  profilePhotoPath: string | null;
}

interface TopicMessage {
  id: string;
  sender: string;
  senderUserId?: string;
  body: string;
  createdAt: string;
}

interface SharedFileItem {
  id: string;
  topic: ChatTopic;
  name: string;
  uri: string;
  mimeType: string;
  sizeBytes: number;
  source: "files" | "camera" | "library";
  uploadedAt: string;
  uploadedBy: string;
}

interface CareParticipant {
  id: string;
  name: string;
  role: CareParticipantRole;
  permissions: string[];
}

interface FamilySituationDraft {
  parent: number;
  child: number;
  grandparent: number;
  caretaker: number;
  external_mediator: number;
  social_worker: number;
}

interface PackingItem {
  id: string;
  label: string;
  packed: boolean;
}

interface PackingPresetGroup {
  id: string;
  name: string;
  items: string[];
}

interface CheckInLog {
  id: string;
  timestamp: string;
  note: string;
}

interface ProfessionalAccessRule {
  role: "external_mediator" | "social_worker";
  purpose: string;
  legalBasis: string;
}

const TABS: Array<{ key: AppTab; labelKey: string; icon: string }> = [
  { key: "home", labelKey: "tab_home", icon: "🏠" },
  { key: "schedule", labelKey: "tab_schedule", icon: "📅" },
  { key: "chat", labelKey: "tab_chat", icon: "💬" },
  { key: "handover", labelKey: "tab_handover", icon: "🤝" },
  { key: "more", labelKey: "tab_settings", icon: "⚙️" }
];

const TOPICS: Array<{ key: ChatTopic; labelKey: string }> = [
  { key: "logistics", labelKey: "topic_logistics" },
  { key: "school", labelKey: "topic_school" },
  { key: "health", labelKey: "topic_health" },
  { key: "expenses", labelKey: "topic_expenses" },
  { key: "decisions", labelKey: "topic_decisions" }
];
const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  day_swap: "Day swap",
  coverage: "Coverage request",
  extra_time: "Extra time",
  holiday_change: "Holiday change"
};
const REQUEST_URGENCY_LABELS: Record<RequestUrgency, string> = {
  low: "Low urgency",
  medium: "Medium urgency",
  high: "High urgency"
};
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const PROFILE_PHOTO_BUCKET = "profile-photos";
const PROFILE_PHOTO_STORAGE_KEY = "parentsapp_profile_photo_by_actor";
const TOUR_TARGET_BY_TAB: Record<AppTab, TourTargetKey> = {
  home: "tab-home",
  schedule: "tab-schedule",
  chat: "tab-chat",
  handover: "tab-handover",
  more: "tab-more"
};
const CARE_RHYTHM_TEMPLATES: Array<{ key: ScheduleTemplateKey; label: string; summary: string }> = [
  { key: "two_two_three", label: "2-2-3 Rhythm", summary: "Frequent, predictable transitions for shared weekly balance." },
  { key: "week_on_week_off", label: "Week-On / Week-Off", summary: "Longer blocks with fewer handovers and deeper routine continuity." },
  { key: "weekday_weekend", label: "Weekday / Weekend Split", summary: "School-week consistency with weekend flexibility." },
  { key: "custom", label: "Custom Rhythm", summary: "Use when your care group follows a non-standard pattern." }
];
const DEFAULT_FAMILY_SITUATION: FamilySituationDraft = {
  parent: 2,
  child: 1,
  grandparent: 0,
  caretaker: 0,
  external_mediator: 0,
  social_worker: 0
};
const DEFAULT_PACKING_PRESETS: PackingPresetGroup[] = [
  {
    id: "preset-school-day",
    name: "School Day",
    items: ["School bag", "Lunch box", "Water bottle", "Homework folder", "Jacket"]
  },
  {
    id: "preset-sleepover",
    name: "Sleepover",
    items: ["Pajamas", "Toothbrush", "Medication pouch", "Comfort item", "Change of clothes"]
  }
];
const MAX_CARE_GROUP_NAME_LENGTH = 15;

const APP_ROLES: Array<{ key: FamilyRole; label: string }> = [
  { key: "parent", label: "Primary caregiver" },
  { key: "child", label: "Young person" },
  { key: "grandparent", label: "Grandparent" },
  { key: "caretaker", label: "Caretaker" },
  { key: "external_mediator", label: "External mediator" },
  { key: "social_worker", label: "Social worker" }
];

const EVENT_COLORS = ["#4d9271", "#2e6f55", "#7b8f36", "#7453a6", "#8f4f39"];
const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  en: "English",
  de: "Deutsch",
  tr: "Turkce",
  ar: "Arabic"
};
const CURATED_GUIDANCE = [
  {
    key: "transitions",
    title: "Transition management",
    text: "Build calmer handovers with predictable routines and short factual updates.",
    content: [
      "Transitions after separation are often hardest when routines are unclear. Children usually adapt better when pickup times, locations, and handover expectations stay stable from week to week. A short pre-handover checklist can reduce avoidable tension for everyone involved.",
      "A practical structure is: factual update, key logistics, and one well-being note. Keep updates neutral and child-focused. For example: sleep quality, medication status, homework progress, and any school notes that require follow-up.",
      "When conflict risk is high, limit handover talk to essentials and move longer discussions to asynchronous chat. This keeps transitions calmer and protects children from adult stress spillover. Over time, consistency builds trust and reduces emergency changes."
    ]
  },
  {
    key: "stress",
    title: "Stress after separation",
    text: "Recognize stress signals early and align responses across homes.",
    content: [
      "Stress in children is not always verbal. It may appear as sleep disruption, irritability, clinginess, or temporary regression. These signals are easier to interpret when caregivers keep shared notes about patterns over several days instead of reacting to one isolated moment.",
      "Helpful responses include predictable routines, short reassurance statements, and coordinated expectations across homes. If one home enforces very different rules overnight, stress behaviors can intensify even when intentions are good.",
      "A useful co-care approach is to agree on two to three stable anchors: sleep timing, school preparation routine, and conflict-free transition language. Repeated consistency from all adults is often more protective than any single perfect intervention."
    ]
  },
  {
    key: "communication",
    title: "Age-appropriate communication",
    text: "Use simple, non-blaming language that protects children from adult conflict.",
    content: [
      "Children benefit from simple statements that separate adult conflict from child responsibility. Messages should stay concrete and avoid blame. A child should never be asked to pass emotional or strategic messages between adults.",
      "For younger children, short scripts help: what is happening, what stays the same, and who to ask for help. For older children and teens, offer room for questions and acknowledge mixed feelings without forcing loyalty to one side.",
      "When caregivers disagree, shared phrasing reduces confusion. Agreeing on core wording in advance can prevent escalatory re-interpretations later. The goal is not identical parenting styles; it is communicative safety and predictability for the child."
    ]
  }
];

const UI_TEXT: Record<LanguageCode, Record<string, string>> = {
  en: {
    tab_home: "Home",
    tab_schedule: "Schedule",
    tab_chat: "Chat",
    tab_handover: "Handover",
    tab_settings: "Settings",
    topic_logistics: "Logistics",
    topic_school: "School",
    topic_health: "Health",
    topic_expenses: "Expenses",
    topic_decisions: "Decisions",
    sign_in: "Sign in",
    create_account: "Create account",
    username: "Username",
    email: "Email",
    password: "Password",
    care_group_setup: "Care Group Setup",
    care_group_name: "Care group name",
    create_care_group: "Create care group",
    join_care_group: "Join care group",
    display_name: "Display name (shown to your care group)",
    dashboard: "Dashboard",
    today: "Today",
    evidence_guidance: "Evidence-Based Guidance",
    care_group_calendar: "Care Group Calendar",
    add_calendar_event: "Add Calendar Event",
    requests: "Requests",
    new_change_request: "New Change Request",
    submit_request: "Submit request",
    asynchronous_chat: "Asynchronous Chat",
    send: "Send",
    release_queued: "Release queued",
    user_settings: "User Settings",
    care_team: "Care Team",
    safety_consent_governance: "Safety, Consent, Governance",
    third_party_access: "Third-Party Access (Granular Consent)",
    records: "Records",
    records_timeline: "Immutable timeline: enabled",
    records_export: "Court-ready export: next milestone",
    records_focus: "Current build focuses on schedule + communication + handovers.",
    sign_out: "Sign out"
  },
  de: {
    tab_home: "Start",
    tab_schedule: "Plan",
    tab_chat: "Chat",
    tab_handover: "Ubergabe",
    tab_settings: "Einstellungen",
    topic_logistics: "Logistik",
    topic_school: "Schule",
    topic_health: "Gesundheit",
    topic_expenses: "Kosten",
    topic_decisions: "Entscheidungen",
    sign_in: "Anmelden",
    create_account: "Konto erstellen",
    username: "Benutzername",
    email: "E-Mail",
    password: "Passwort",
    care_group_setup: "Care-Group Setup",
    care_group_name: "Name der Care Group",
    create_care_group: "Care Group erstellen",
    join_care_group: "Care Group beitreten",
    display_name: "Anzeigename (sichtbar fur die Care Group)",
    dashboard: "Ubersicht",
    today: "Heute",
    evidence_guidance: "Evidenzbasierte Hinweise",
    care_group_calendar: "Care-Group Kalender",
    add_calendar_event: "Kalendereintrag hinzufugen",
    requests: "Anfragen",
    new_change_request: "Neue Anderungsanfrage",
    submit_request: "Anfrage senden",
    asynchronous_chat: "Asynchroner Chat",
    send: "Senden",
    release_queued: "Warteschlange senden",
    user_settings: "Nutzereinstellungen",
    care_team: "Care Team",
    safety_consent_governance: "Sicherheit, Einwilligung, Governance",
    third_party_access: "Zugriff Dritter (granulare Einwilligung)",
    records: "Protokolle",
    records_timeline: "Unveranderbare Zeitlinie: aktiv",
    records_export: "Gerichtsreifer Export: nachster Meilenstein",
    records_focus: "Aktueller Build fokussiert auf Plan + Kommunikation + Ubergaben.",
    sign_out: "Abmelden"
  },
  tr: {
    tab_home: "Ana Sayfa",
    tab_schedule: "Plan",
    tab_chat: "Sohbet",
    tab_handover: "Teslim",
    tab_settings: "Ayarlar",
    topic_logistics: "Lojistik",
    topic_school: "Okul",
    topic_health: "Saglik",
    topic_expenses: "Masraflar",
    topic_decisions: "Kararlar",
    sign_in: "Giris yap",
    create_account: "Hesap olustur",
    username: "Kullanici adi",
    email: "E-posta",
    password: "Sifre",
    care_group_setup: "Bakim Grubu Kurulumu",
    care_group_name: "Bakim grubu adi",
    create_care_group: "Bakim grubu olustur",
    join_care_group: "Bakim grubuna katil",
    display_name: "Gorunen ad (bakim grubuna gorunur)",
    dashboard: "Genel Bakis",
    today: "Bugun",
    evidence_guidance: "Kanita Dayali Rehberlik",
    care_group_calendar: "Bakim Grubu Takvimi",
    add_calendar_event: "Takvim etkinligi ekle",
    requests: "Talepler",
    new_change_request: "Yeni degisiklik talebi",
    submit_request: "Talep gonder",
    asynchronous_chat: "Asenkron Sohbet",
    send: "Gonder",
    release_queued: "Kuyruktakileri gonder",
    user_settings: "Kullanici ayarlari",
    care_team: "Bakim Ekibi",
    safety_consent_governance: "Guvenlik, Onam, Yonetisim",
    third_party_access: "Ucuncu taraf erisimi (ayrintili onam)",
    records: "Kayitlar",
    records_timeline: "Degistirilemez zaman cizelgesi: acik",
    records_export: "Mahkeme cikti disa aktarma: sonraki asama",
    records_focus: "Mevcut surum plan + iletisim + teslimlere odakli.",
    sign_out: "Cikis yap"
  },
  ar: {
    tab_home: "الرئيسية",
    tab_schedule: "الجدول",
    tab_chat: "الدردشة",
    tab_handover: "التسليم",
    tab_settings: "الإعدادات",
    topic_logistics: "اللوجستيات",
    topic_school: "المدرسة",
    topic_health: "الصحة",
    topic_expenses: "المصاريف",
    topic_decisions: "القرارات",
    sign_in: "تسجيل الدخول",
    create_account: "إنشاء حساب",
    username: "اسم المستخدم",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    care_group_setup: "إعداد مجموعة الرعاية",
    care_group_name: "اسم مجموعة الرعاية",
    create_care_group: "إنشاء مجموعة رعاية",
    join_care_group: "الانضمام إلى مجموعة رعاية",
    display_name: "الاسم المعروض (مرئي للمجموعة)",
    dashboard: "لوحة المتابعة",
    today: "اليوم",
    evidence_guidance: "إرشادات مبنية على الأدلة",
    care_group_calendar: "تقويم مجموعة الرعاية",
    add_calendar_event: "إضافة حدث للتقويم",
    requests: "الطلبات",
    new_change_request: "طلب تغيير جديد",
    submit_request: "إرسال الطلب",
    asynchronous_chat: "دردشة غير متزامنة",
    send: "إرسال",
    release_queued: "إرسال الرسائل المؤجلة",
    user_settings: "إعدادات المستخدم",
    care_team: "فريق الرعاية",
    safety_consent_governance: "السلامة والموافقة والحوكمة",
    third_party_access: "وصول الأطراف الثالثة (صلاحيات دقيقة)",
    records: "السجلات",
    records_timeline: "سجل زمني غير قابل للتعديل: مفعّل",
    records_export: "تصدير جاهز للمحكمة: المرحلة التالية",
    records_focus: "الإصدار الحالي يركز على الجدولة والتواصل والتسليم.",
    sign_out: "تسجيل الخروج"
  }
};

const DEFAULT_MESSAGES: Record<ChatTopic, TopicMessage[]> = {
  logistics: [
    {
      id: "m1",
      sender: "Caregiver A",
      body: "Can we keep pickup at 17:00 on Friday?",
      createdAt: new Date().toISOString()
    }
  ],
  school: [
    {
      id: "m2",
      sender: "Caregiver B",
      body: "Parent-teacher meeting is next Tuesday at 14:30.",
      createdAt: new Date().toISOString()
    }
  ],
  health: [
    {
      id: "m3",
      sender: "Caregiver A",
      body: "Dentist check-up booked for May 6.",
      createdAt: new Date().toISOString()
    }
  ],
  expenses: [],
  decisions: []
};

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(dateString: string): Date {
  return new Date(`${dateString}T12:00:00`);
}

function getOrdinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) {
    return "th";
  }
  if (day % 10 === 1) {
    return "st";
  }
  if (day % 10 === 2) {
    return "nd";
  }
  if (day % 10 === 3) {
    return "rd";
  }
  return "th";
}

function formatDateForDisplay(dateString: string): string {
  const parsed = parseDate(dateString);
  if (Number.isNaN(parsed.getTime())) {
    return dateString;
  }
  const day = parsed.getDate();
  const month = parsed.toLocaleString("en-US", { month: "long" });
  return `${day}${getOrdinalSuffix(day)} of ${month}`;
}

function addDaysToDateString(dateString: string, days: number): string {
  const date = parseDate(dateString);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function generateHandoverDates(input: {
  rhythm: ScheduleTemplateKey;
  startDate: string;
  rangeStart: string;
  rangeEnd: string;
}): string[] {
  const start = parseDate(input.rangeStart);
  const end = parseDate(input.rangeEnd);
  const results: string[] = [];

  if (input.rhythm === "custom") {
    return results;
  }

  if (input.rhythm === "weekday_weekend") {
    const cursor = new Date(start);
    while (cursor <= end) {
      const weekday = cursor.getDay();
      if (weekday === 1 || weekday === 5) {
        results.push(formatDate(cursor));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return Array.from(new Set(results));
  }

  const intervals = input.rhythm === "week_on_week_off" ? [7] : [2, 2, 3];
  let pointer = parseDate(input.startDate);
  let intervalIndex = 0;

  while (pointer < start) {
    pointer = parseDate(addDaysToDateString(formatDate(pointer), intervals[intervalIndex % intervals.length]));
    intervalIndex += 1;
  }

  while (pointer <= end) {
    results.push(formatDate(pointer));
    pointer = parseDate(addDaysToDateString(formatDate(pointer), intervals[intervalIndex % intervals.length]));
    intervalIndex += 1;
  }

  return Array.from(new Set(results));
}

function getNextHandoverDate(rhythm: ScheduleTemplateKey, startDate: string, fromDate: string): string | null {
  const rangeEnd = addDaysToDateString(fromDate, 120);
  const dates = generateHandoverDates({
    rhythm,
    startDate,
    rangeStart: fromDate,
    rangeEnd
  });
  return dates.find((date) => date >= fromDate) ?? null;
}

function getDaysBetween(fromDate: string, toDate: string): number {
  const from = parseDate(fromDate);
  const to = parseDate(toDate);
  const diffMs = to.getTime() - from.getTime();
  return Math.max(Math.ceil(diffMs / (24 * 60 * 60 * 1000)), 0);
}

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function estimateReadingSeconds(paragraphs: string[]): number {
  const totalWords = paragraphs.reduce((sum, paragraph) => sum + countWords(paragraph), 0);
  const seconds = Math.ceil((totalWords / 180) * 60);
  return Math.max(seconds, 45);
}

function formatDurationCompact(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileExtension(name: string): string {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) {
    return "";
  }
  return trimmed.slice(dot + 1).toLowerCase();
}

function getFileIcon(input: { mimeType: string; name: string }): string {
  const mime = input.mimeType.toLowerCase();
  const ext = getFileExtension(input.name);

  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "heic"].includes(ext)) {
    return "🖼️";
  }
  if (mime === "application/pdf" || ext === "pdf") {
    return "📄";
  }
  if (mime.includes("word") || ["doc", "docx", "odt", "rtf", "txt"].includes(ext)) {
    return "📝";
  }
  if (mime.includes("sheet") || ["xls", "xlsx", "csv", "ods"].includes(ext)) {
    return "📊";
  }
  if (mime.includes("presentation") || ["ppt", "pptx", "odp"].includes(ext)) {
    return "📽️";
  }
  if (mime.startsWith("audio/") || ["mp3", "wav", "m4a", "aac"].includes(ext)) {
    return "🎵";
  }
  if (mime.startsWith("video/") || ["mp4", "mov", "m4v"].includes(ext)) {
    return "🎬";
  }
  if (["zip", "rar", "7z"].includes(ext)) {
    return "🗜️";
  }

  return "📁";
}

function sanitizeFileName(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned || `file-${Date.now()}`;
}

function formatTimeHHMM(value: string): string {
  const parsed = new Date(value);
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function combineDateAndTime(date: string, time: string): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time.trim());
  if (!match) {
    return null;
  }

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const composed = new Date(year, month - 1, day, hours, minutes, 0, 0);

  if (Number.isNaN(composed.getTime())) {
    return null;
  }

  return composed.toISOString();
}

function getRule(event: CalendarEvent): RRule {
  return new RRule({
    freq: event.recurrence === "weekly" ? RRule.WEEKLY : RRule.MONTHLY,
    dtstart: parseDate(event.date)
  });
}

function eventOccursOnDate(event: CalendarEvent, dateString: string): boolean {
  if (event.recurrence === "none") {
    return event.date === dateString;
  }

  const dayStart = parseDate(dateString);
  const dayEnd = new Date(dayStart);
  dayEnd.setHours(23, 59, 59, 999);

  return getRule(event).between(dayStart, dayEnd, true).length > 0;
}

function actorKeysForProfile(input: { userId?: string | null; displayName?: string | null }): string[] {
  const keys: string[] = [];
  if (input.userId?.trim()) {
    keys.push(`user:${input.userId.trim()}`);
  }
  if (input.displayName?.trim()) {
    keys.push(`name:${input.displayName.trim().toLowerCase()}`);
  }
  return Array.from(new Set(keys));
}

function isRenderableImageUri(uri: string): boolean {
  const normalized = uri.trim().toLowerCase();
  return normalized.startsWith("https://") || normalized.startsWith("http://") || normalized.startsWith("file://") || normalized.startsWith("data:image/");
}

function isLocalImageUri(uri: string): boolean {
  const normalized = uri.trim().toLowerCase();
  return normalized.startsWith("file://") || normalized.startsWith("data:image/");
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function extensionForMimeType(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/png") {
    return "png";
  }
  if (normalized === "image/webp") {
    return "webp";
  }
  if (normalized === "image/gif") {
    return "gif";
  }
  if (normalized === "image/bmp") {
    return "bmp";
  }
  if (normalized === "image/tiff") {
    return "tiff";
  }
  if (normalized === "image/heic") {
    return "heic";
  }
  if (normalized === "image/heif") {
    return "heif";
  }
  return "jpg";
}

function isSupportedProfileImage(input: { mimeType: string; name: string }): boolean {
  const mime = input.mimeType.toLowerCase();
  if (mime.startsWith("image/")) {
    return true;
  }
  const ext = getFileExtension(input.name);
  return ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif"].includes(ext);
}

export default function App(): ReactElement {
  const appRootRef = useRef<View | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountUsername, setAccountUsername] = useState("");
  const [status, setStatus] = useState<string>("");
  const [authMode, setAuthMode] = useState<AuthMode>("sign_in");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [role, setRole] = useState<FamilyRole>("parent");
  const [tab, setTab] = useState<AppTab>("home");
  const [familySetupMode, setFamilySetupMode] = useState<FamilySetupMode>("create");
  const [familyNameInput, setFamilyNameInput] = useState("");
  const [joinAccessInput, setJoinAccessInput] = useState("");
  const [familyPasswordInput, setFamilyPasswordInput] = useState("");
  const [onboardingDisplayName, setOnboardingDisplayName] = useState("");
  const [onboardingRole, setOnboardingRole] = useState<FamilyRole | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(hasSupabaseConfig() ? null : getDemoFamilyId());
  const [familyName, setFamilyName] = useState<string>(hasSupabaseConfig() ? "" : "Demo Care Group");
  const [familyJoinCode, setFamilyJoinCode] = useState<string | null>(null);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [currentDisplayName, setCurrentDisplayName] = useState("You");
  const [isCareGroupCreator, setIsCareGroupCreator] = useState(false);
  const [latestRoleInvite, setLatestRoleInvite] = useState<{ code: string; role: FamilyRole } | null>(null);
  const [inviteGeneratorVisible, setInviteGeneratorVisible] = useState(false);
  const [inviteGeneratorBusyRole, setInviteGeneratorBusyRole] = useState<FamilyRole | null>(null);

  const [selectedCareRhythm, setSelectedCareRhythm] = useState<ScheduleTemplateKey>("two_two_three");
  const [careRhythmNotes, setCareRhythmNotes] = useState("");
  const [careRhythmStartDate, setCareRhythmStartDate] = useState(formatDate(new Date()));
  const [careRhythmLocked, setCareRhythmLocked] = useState(false);
  const [careRhythmConfirmedBy, setCareRhythmConfirmedBy] = useState<string[]>([]);

  const [requestType, setRequestType] = useState<RequestType>("day_swap");
  const [requestDate, setRequestDate] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [requestChildPlan, setRequestChildPlan] = useState("");
  const [requestUrgency, setRequestUrgency] = useState<RequestUrgency>("medium");
  const [requestNeedsChildBrief, setRequestNeedsChildBrief] = useState(true);
  const [requestTouchesHandover, setRequestTouchesHandover] = useState(false);
  const [requestDatePickerOpen, setRequestDatePickerOpen] = useState(false);
  const [selectedApproverMemberIds, setSelectedApproverMemberIds] = useState<string[]>([]);
  const [requests, setRequests] = useState<ScheduleRequest[]>([
    {
      id: "r1",
      type: "coverage",
      date: "2026-04-23",
      note: "Work trip. Need pickup coverage.",
      status: "pending",
      createdBy: "Caregiver A",
      affectedMemberIds: [],
      approverMemberIds: [],
      approvedByIds: []
    }
  ]);

  const [selectedDate, setSelectedDate] = useState(formatDate(new Date()));
  const [visibleMonth, setVisibleMonth] = useState(formatDate(new Date()).slice(0, 7));
  const [eventTitle, setEventTitle] = useState("");
  const [eventStartTime, setEventStartTime] = useState("17:00");
  const [eventEndTime, setEventEndTime] = useState("18:00");
  const [eventRecurrence, setEventRecurrence] = useState<RecurrenceType>("none");
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([
    {
      id: "e1",
      title: "School pickup",
      date: formatDate(new Date()),
      startTime: "17:00",
      endTime: "17:30",
      recurrence: "weekly",
      color: EVENT_COLORS[0],
      createdBy: "parent"
    },
    {
      id: "e2",
      title: "Pediatrician",
      date: formatDate(new Date(Date.now() + 86400000 * 3)),
      startTime: "14:30",
      endTime: "15:00",
      recurrence: "none",
      color: EVENT_COLORS[1],
      createdBy: "parent"
    }
  ]);

  const [selectedTopic, setSelectedTopic] = useState<ChatTopic>("logistics");
  const [topicMessages, setTopicMessages] = useState<Record<ChatTopic, TopicMessage[]>>(DEFAULT_MESSAGES);
  const [topicFiles, setTopicFiles] = useState<Record<ChatTopic, SharedFileItem[]>>({
    logistics: [],
    school: [],
    health: [],
    expenses: [],
    decisions: []
  });
  const [chatDraft, setChatDraft] = useState("");
  const [topicLastSeenAt, setTopicLastSeenAt] = useState<Record<ChatTopic, string>>({
    logistics: new Date().toISOString(),
    school: new Date().toISOString(),
    health: new Date().toISOString(),
    expenses: new Date().toISOString(),
    decisions: new Date().toISOString()
  });
  const [toneCoachEnabled, setToneCoachEnabled] = useState(true);
  const [toneOverrideArmed, setToneOverrideArmed] = useState(false);
  const [languagePreference, setLanguagePreference] = useState<LanguageCode>("en");
  const [auditScope, setAuditScope] = useState<AuditScope>("minimal");
  const [aiDisclosureAccepted, setAiDisclosureAccepted] = useState(false);
  const [highConflictGuard, setHighConflictGuard] = useState(true);
  const [draftAssistanceState, setDraftAssistanceState] = useState<AssistanceState>("informational");
  const [draftToneRisk, setDraftToneRisk] = useState<"low" | "medium" | "high">("low");
  const [draftSuggestions, setDraftSuggestions] = useState<string[]>([]);
  const [readArticleKeysByMember, setReadArticleKeysByMember] = useState<Record<string, string[]>>({});
  const [openArticleKey, setOpenArticleKey] = useState<string | null>(null);
  const [articleOpenedAt, setArticleOpenedAt] = useState<number | null>(null);
  const [articleTimerNow, setArticleTimerNow] = useState<number>(Date.now());
  const assistiveAi = useMemo(() => getAssistiveAiAdapter(), []);
  const [professionalAccessRules] = useState<ProfessionalAccessRule[]>([
    {
      role: "external_mediator",
      purpose: "Conflict de-escalation",
      legalBasis: "Dual caregiver consent"
    },
    {
      role: "social_worker",
      purpose: "Support follow-up",
      legalBasis: "Dual caregiver consent + legal mandate when applicable"
    }
  ]);
  const [thirdPartyConsentByFamily, setThirdPartyConsentByFamily] = useState<Record<string, Record<string, boolean>>>({});

  const [packingInput, setPackingInput] = useState("");
  const [packingList, setPackingList] = useState<PackingItem[]>([
    { id: "p1", label: "School bag", packed: false },
    { id: "p2", label: "Medication pouch", packed: false },
    { id: "p3", label: "Sports shoes", packed: false }
  ]);
  const [packingPresetNameInput, setPackingPresetNameInput] = useState("");
  const [packingPresets, setPackingPresets] = useState<PackingPresetGroup[]>(DEFAULT_PACKING_PRESETS);

  const [checkInNote, setCheckInNote] = useState("");
  const [checkInLogs, setCheckInLogs] = useState<CheckInLog[]>([]);
  const chatMessagesScrollRef = useRef<ScrollView | null>(null);
  const chatFilesScrollRef = useRef<ScrollView | null>(null);
  const chatRealtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const familyMembersRealtimeChannelRef = useRef<RealtimeChannel | null>(null);
  const previousUnreadByTopicRef = useRef<Record<ChatTopic, number> | null>(null);
  const [sendingChat, setSendingChat] = useState(false);
  const lastSentMessageRef = useRef<{ topic: ChatTopic; body: string; sentAtMs: number } | null>(null);
  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [uploadInProgress, setUploadInProgress] = useState(false);
  const [filePreviewItem, setFilePreviewItem] = useState<SharedFileItem | null>(null);
  const [pendingUpload, setPendingUpload] = useState<{
    uri: string;
    mimeType: string;
    sizeBytes: number;
    source: "files" | "camera" | "library";
    originalName: string;
  } | null>(null);
  const [uploadDisplayName, setUploadDisplayName] = useState("");
  const [profilePhotoByActor, setProfilePhotoByActor] = useState<Record<string, string>>({});
  const [profileUploadModalVisible, setProfileUploadModalVisible] = useState(false);
  const [profileUploadInProgress, setProfileUploadInProgress] = useState(false);
  const [pendingProfileUpload, setPendingProfileUpload] = useState<{
    uri: string;
    mimeType: string;
    sizeBytes: number;
    source: "files" | "camera" | "library";
    originalName: string;
  } | null>(null);

  const [participants] = useState<CareParticipant[]>([]);
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [tourSpotlight, setTourSpotlight] = useState<TourRect | null>(null);
  const [screenSize, setScreenSize] = useState({ width: 0, height: 0 });
  const tourTargetRefs = useRef<Partial<Record<TourTargetKey, View | null>>>({});
  const tourPulse = useRef(new Animated.Value(0)).current;
  const t = (key: string): string => UI_TEXT[languagePreference][key] ?? UI_TEXT.en[key] ?? key;
  const latestRoleInviteLabel = latestRoleInvite ? APP_ROLES.find((option) => option.key === latestRoleInvite.role)?.label ?? latestRoleInvite.role : null;
  const currentProfileActorKeys = useMemo(() => actorKeysForProfile({ userId, displayName: currentDisplayName }), [userId, currentDisplayName]);
  const currentProfilePhotoUri = useMemo(() => {
    for (const key of currentProfileActorKeys) {
      const uri = profilePhotoByActor[key];
      if (uri && isRenderableImageUri(uri)) {
        return uri;
      }
    }
    return null;
  }, [currentProfileActorKeys, profilePhotoByActor]);
  const packedCount = useMemo(() => packingList.filter((item) => item.packed).length, [packingList]);
  const packingTotal = packingList.length;
  const packingProgress = packingTotal === 0 ? 0 : packedCount / packingTotal;
  const packingRemaining = Math.max(packingTotal - packedCount, 0);
  const {
    currentStep: currentTourStep,
    stepIndex: tourStepIndex,
    totalSteps: tourTotalSteps,
    active: tourActive,
    progressLabel: tourProgressLabel,
    startTour,
    skipTour,
    backStep: backTourStep,
    advanceStep: advanceTourStep,
    completeTour
  } = useAppTour({
    sessionReady,
    signedIn,
    familyId,
    userId,
    role
  });

  useEffect(() => {
    void (async () => {
      if (!hasSupabaseConfig()) {
        setSessionReady(true);
        setSignedIn(true);
        setFamilyId(getDemoFamilyId());
        setFamilyName("Demo Care Group");
        setStatus("Demo mode active. Configure env for live backend.");
        return;
      }

      const session = await getValidatedSession();
      const nextUserId = session?.user?.id ?? null;
      const nextUsername = (session?.user?.user_metadata?.username as string | undefined) ?? "";
      setAccountUsername(nextUsername);
      setUserId(nextUserId);
      setSignedIn(Boolean(nextUserId));
      if (nextUserId) {
        await loadFamilyContext(nextUserId, nextUsername);
      }
      setSessionReady(true);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(PROFILE_PHOTO_STORAGE_KEY);
        if (!stored) {
          return;
        }
        const parsed = JSON.parse(stored) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return;
        }
        const next: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === "string" && isRenderableImageUri(value)) {
            next[key] = value.trim();
          }
        }
        setProfilePhotoByActor(next);
      } catch {
        // Ignore malformed cache and continue with empty state.
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await AsyncStorage.setItem(PROFILE_PHOTO_STORAGE_KEY, JSON.stringify(profilePhotoByActor));
      } catch {
        // Keep runtime resilient if local storage is unavailable.
      }
    })();
  }, [profilePhotoByActor]);

  useEffect(() => {
    if (!signedIn || !hasSupabaseConfig() || !familyId) {
      return;
    }

    void syncCalendarFromSupabase();
    void syncRequestsFromSupabase();
    void syncFamilyMembersFromSupabase();
    void syncThirdPartyConsentsFromSupabase();
    void syncCareRhythmFromSupabase();
    void syncChatFromSupabase();
  }, [signedIn, familyId]);

  useEffect(() => {
    if (!signedIn || !hasSupabaseConfig() || !familyId) {
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }

    if (familyMembersRealtimeChannelRef.current) {
      void supabase.removeChannel(familyMembersRealtimeChannelRef.current);
      familyMembersRealtimeChannelRef.current = null;
    }

    const channel = supabase
      .channel(`family-members-${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "family_members",
          filter: `family_id=eq.${familyId}`
        },
        () => {
          void syncFamilyMembersFromSupabase();
        }
      )
      .subscribe();

    familyMembersRealtimeChannelRef.current = channel;

    return () => {
      if (familyMembersRealtimeChannelRef.current) {
        void supabase.removeChannel(familyMembersRealtimeChannelRef.current);
        familyMembersRealtimeChannelRef.current = null;
      }
    };
  }, [signedIn, familyId]);

  useEffect(() => {
    if (!signedIn || !hasSupabaseConfig() || !familyId) {
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return;
    }

    if (chatRealtimeChannelRef.current) {
      void supabase.removeChannel(chatRealtimeChannelRef.current);
      chatRealtimeChannelRef.current = null;
    }

    const channel = supabase
      .channel(`chat-messages-${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: `family_id=eq.${familyId}`
        },
        () => {
          void syncChatFromSupabase();
        }
      )
      .subscribe();

    chatRealtimeChannelRef.current = channel;

    return () => {
      if (chatRealtimeChannelRef.current) {
        void supabase.removeChannel(chatRealtimeChannelRef.current);
        chatRealtimeChannelRef.current = null;
      }
    };
  }, [signedIn, familyId]);

  useEffect(() => {
    if (tab !== "chat") {
      return;
    }

    setTopicLastSeenAt((prev) => ({
      ...prev,
      [selectedTopic]: new Date().toISOString()
    }));
  }, [tab, selectedTopic]);

  useEffect(() => {
    if (!status.trim()) {
      return;
    }

    const timer = setTimeout(() => {
      setStatus("");
    }, 3500);

    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  useEffect(() => {
    if (!openArticleKey || !articleOpenedAt) {
      return;
    }

    const timer = setInterval(() => {
      setArticleTimerNow(Date.now());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [openArticleKey, articleOpenedAt]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const assessment = await assistiveAi.assessDraft({
        text: chatDraft,
        language: languagePreference,
        safetyGuardEnabled: highConflictGuard,
        aiDisclosureAccepted
      });

      if (cancelled) {
        return;
      }

      setDraftAssistanceState(assessment.state);
      setDraftToneRisk(assessment.toneRisk);
      setDraftSuggestions(assessment.suggestions);
    })();

    return () => {
      cancelled = true;
    };
  }, [chatDraft, languagePreference, highConflictGuard, aiDisclosureAccepted, assistiveAi]);

  const pendingRequestCount = useMemo(
    () => requests.filter((request) => request.status === "pending").length,
    [requests]
  );

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of familyMembers) {
      map.set(member.userId, member.displayName?.trim() || member.role.replace("_", " "));
    }
    return map;
  }, [familyMembers]);

  const requestSelectableMembers = useMemo(() => {
    if (hasSupabaseConfig() && familyMembers.length > 0) {
      return familyMembers.map((member) => ({
        id: member.userId,
        label: member.displayName?.trim() || member.role.replace("_", " ")
      }));
    }

    return participants.map((participant) => ({
      id: participant.id,
      label: participant.name
    }));
  }, [familyMembers, participants]);

  const requestSelectableNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of requestSelectableMembers) {
      map.set(member.id, member.label);
    }
    return map;
  }, [requestSelectableMembers]);

  const requestApproverCandidates = useMemo(() => {
    return requestSelectableMembers.filter((member) => {
      if (userId) {
        return member.id !== userId;
      }
      return member.label !== currentDisplayName;
    });
  }, [requestSelectableMembers, userId, currentDisplayName]);

  const hasOtherMembersForRequests = useMemo(() => {
    if (hasSupabaseConfig()) {
      if (!userId) {
        return familyMembers.length > 0;
      }
      return familyMembers.some((member) => member.userId !== userId);
    }
    return participants.some((participant) => participant.name !== currentDisplayName);
  }, [familyMembers, userId, participants, currentDisplayName]);

  const mainCaregiverMembers = useMemo(() => {
    if (hasSupabaseConfig() && familyMembers.length > 0) {
      return familyMembers.filter((member) => member.role === "parent");
    }
    return participants
      .filter((participant) => participant.role === "parent")
      .map((participant) => ({
        userId: `member:${participant.name.trim().toLowerCase()}`,
        role: "parent" as FamilyRole,
        displayName: participant.name,
        profilePhotoPath: null
      }));
  }, [familyMembers, participants]);
  const mainCaregiverIds = useMemo(() => mainCaregiverMembers.map((member) => member.userId), [mainCaregiverMembers]);
  const baselineApproverMembers = useMemo(() => {
    if (hasSupabaseConfig() && familyMembers.length > 0) {
      return familyMembers.filter(
        (member) => member.role === "parent" || member.role === "external_mediator" || member.role === "social_worker"
      );
    }
    return participants
      .filter((participant) => participant.role === "parent" || participant.role === "external_mediator" || participant.role === "social_worker")
      .map((participant) => ({
        userId: `member:${participant.name.trim().toLowerCase()}`,
        role: (participant.role === "parent" || participant.role === "external_mediator" || participant.role === "social_worker"
          ? participant.role
          : "parent") as FamilyRole,
        displayName: participant.name,
        profilePhotoPath: null
      }));
  }, [familyMembers, participants]);
  const baselineApproverIds = useMemo(() => baselineApproverMembers.map((member) => member.userId), [baselineApproverMembers]);
  const baselineRequiredCount = useMemo(
    () => (careRhythmLocked ? Math.max(1, careRhythmConfirmedBy.length) : Math.max(1, baselineApproverIds.length)),
    [careRhythmLocked, careRhythmConfirmedBy.length, baselineApproverIds.length]
  );
  const mainCaregiverNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of mainCaregiverMembers) {
      map.set(member.userId, member.displayName?.trim() || "Primary caregiver");
    }
    return map;
  }, [mainCaregiverMembers]);
  const currentActorId = userId ?? `member:${currentDisplayName.trim().toLowerCase()}`;
  const isMainCaregiver = hasSupabaseConfig()
    ? Boolean(userId && mainCaregiverIds.includes(userId))
    : role === "parent";
  const isBaselineApprover = hasSupabaseConfig()
    ? Boolean(userId && baselineApproverIds.includes(userId))
    : role === "parent" || role === "external_mediator" || role === "social_worker";
  const consentScopeKey = familyId ?? getDemoFamilyId() ?? "demo";
  const thirdPartyConsentByCaregiver = thirdPartyConsentByFamily[consentScopeKey] ?? {};
  const dualConsentGranted = mainCaregiverIds.length > 0 && mainCaregiverIds.every((id) => Boolean(thirdPartyConsentByCaregiver[id]));
  const requestInterventionState = useMemo<AssistanceState>(() => {
    if (!requestDate.trim() || !requestReason.trim() || !requestChildPlan.trim() || selectedApproverMemberIds.length === 0 || !hasOtherMembersForRequests) {
      return "restricted";
    }

    if (userId && selectedApproverMemberIds.includes(userId)) {
      return "assistive";
    }

    if (requestUrgency === "high" && selectedApproverMemberIds.length < 2) {
      return "assistive";
    }

    return "informational";
  }, [requestDate, requestReason, requestChildPlan, selectedApproverMemberIds, userId, hasOtherMembersForRequests, requestUrgency]);

  useEffect(() => {
    const allowed = new Set(requestApproverCandidates.map((member) => member.id));
    setSelectedApproverMemberIds((prev) => prev.filter((id) => allowed.has(id)));
  }, [requestApproverCandidates]);

  useEffect(() => {
    if (mainCaregiverIds.length === 0) {
      return;
    }

    setThirdPartyConsentByFamily((prev) => {
      const current = prev[consentScopeKey] ?? {};
      const next: Record<string, boolean> = {};
      for (const id of mainCaregiverIds) {
        next[id] = current[id] ?? false;
      }
      return { ...prev, [consentScopeKey]: next };
    });
  }, [mainCaregiverIds, consentScopeKey]);

  useEffect(() => {
    if (careRhythmLocked || baselineApproverIds.length === 0) {
      return;
    }
    setCareRhythmConfirmedBy((prev) => prev.filter((id) => baselineApproverIds.includes(id)));
  }, [careRhythmLocked, baselineApproverIds]);

  const markedDates = useMemo(() => {
    const [yearString, monthString] = visibleMonth.split("-");
    const monthStart = new Date(Number(yearString), Number(monthString) - 1, 1, 0, 0, 0, 0);
    const monthEnd = new Date(Number(yearString), Number(monthString), 0, 23, 59, 59, 999);
    const handoverDates = generateHandoverDates({
      rhythm: selectedCareRhythm,
      startDate: careRhythmStartDate,
      rangeStart: formatDate(monthStart),
      rangeEnd: formatDate(monthEnd)
    });

    const marks: Record<string, { dots?: Array<{ key: string; color: string }>; selected?: boolean; selectedColor?: string }> = {};

    for (const event of calendarEvents) {
      const dates: string[] = [];

      if (event.recurrence === "none") {
        if (event.date >= formatDate(monthStart) && event.date <= formatDate(monthEnd)) {
          dates.push(event.date);
        }
      } else {
        const occurrenceDates = getRule(event)
          .between(monthStart, monthEnd, true)
          .map((date) => formatDate(date));
        dates.push(...occurrenceDates);
      }

      for (const date of dates) {
        const existing = marks[date]?.dots ?? [];
        if (existing.find((dot) => dot.key === event.id)) {
          continue;
        }

        marks[date] = {
          ...marks[date],
          dots: [...existing, { key: event.id, color: event.color }]
        };
      }
    }

    for (const handoverDate of handoverDates) {
      const existing = marks[handoverDate]?.dots ?? [];
      if (!existing.find((dot) => dot.key === `handover-${handoverDate}`)) {
        marks[handoverDate] = {
          ...marks[handoverDate],
          dots: [...existing, { key: `handover-${handoverDate}`, color: "#d1872c" }]
        };
      }
    }

    marks[selectedDate] = {
      ...marks[selectedDate],
      selected: true,
      selectedColor: "#1f7a59"
    };

    return marks;
  }, [calendarEvents, selectedDate, visibleMonth, selectedCareRhythm, careRhythmStartDate]);

  const selectedDateEvents = useMemo(() => {
    return calendarEvents.filter((event) => eventOccursOnDate(event, selectedDate));
  }, [calendarEvents, selectedDate]);
  const visibleMonthRange = useMemo(() => {
    const [yearString, monthString] = visibleMonth.split("-");
    const monthStart = new Date(Number(yearString), Number(monthString) - 1, 1);
    const monthEnd = new Date(Number(yearString), Number(monthString), 0);
    return { start: formatDate(monthStart), end: formatDate(monthEnd) };
  }, [visibleMonth]);
  const handoverDatesForVisibleMonth = useMemo(
    () =>
      generateHandoverDates({
        rhythm: selectedCareRhythm,
        startDate: careRhythmStartDate,
        rangeStart: visibleMonthRange.start,
        rangeEnd: visibleMonthRange.end
      }),
    [selectedCareRhythm, careRhythmStartDate, visibleMonthRange]
  );
  const selectedDateHandover = useMemo(
    () => handoverDatesForVisibleMonth.includes(selectedDate),
    [handoverDatesForVisibleMonth, selectedDate]
  );

  const todayDate = useMemo(() => formatDate(new Date()), []);
  const todayEvents = useMemo(() => {
    return calendarEvents.filter((event) => eventOccursOnDate(event, todayDate));
  }, [calendarEvents, todayDate]);
  const todayPendingRequests = useMemo(() => {
    return requests.filter((request) => request.status === "pending" && request.date === todayDate);
  }, [requests, todayDate]);
  const nextHandoverDate = useMemo(
    () => getNextHandoverDate(selectedCareRhythm, careRhythmStartDate, todayDate),
    [selectedCareRhythm, careRhythmStartDate, todayDate]
  );
  const daysUntilNextHandover = nextHandoverDate ? getDaysBetween(todayDate, nextHandoverDate) : null;
  const handoverBadgeVariantStyle =
    daysUntilNextHandover === 0 ? styles.handoverBadgeToday : daysUntilNextHandover === 1 ? styles.handoverBadgeSoon : styles.handoverBadgeDefault;
  const handoverBadgeTextVariantStyle =
    daysUntilNextHandover === 0
      ? styles.handoverBadgeTextToday
      : daysUntilNextHandover === 1
        ? styles.handoverBadgeTextSoon
        : styles.handoverBadgeTextDefault;
  const currentMemberKey = useMemo(() => {
    if (userId) {
      return `user:${userId}`;
    }
    return `member:${(currentDisplayName || accountUsername || "guest").trim().toLowerCase()}`;
  }, [userId, currentDisplayName, accountUsername]);
  const readArticleKeys = useMemo(() => readArticleKeysByMember[currentMemberKey] ?? [], [readArticleKeysByMember, currentMemberKey]);
  const guidanceRewardByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of CURATED_GUIDANCE) {
      const seconds = estimateReadingSeconds(item.content);
      map.set(item.key, Math.max(5, Math.round(seconds / 10)));
    }
    return map;
  }, []);
  const readScore = useMemo(
    () => readArticleKeys.reduce((sum, key) => sum + (guidanceRewardByKey.get(key) ?? 0), 0),
    [readArticleKeys, guidanceRewardByKey]
  );
  const readProgressPercent = useMemo(
    () => Math.round((readArticleKeys.length / Math.max(CURATED_GUIDANCE.length, 1)) * 100),
    [readArticleKeys.length]
  );
  const activeArticle = useMemo(() => CURATED_GUIDANCE.find((article) => article.key === openArticleKey) ?? null, [openArticleKey]);
  const activeArticleReadMs = estimateReadingSeconds(activeArticle?.content ?? []) * 1000;
  const activeArticleElapsedMs = articleOpenedAt ? Math.max(articleTimerNow - articleOpenedAt, 0) : 0;
  const activeArticleRemainingSeconds = Math.max(Math.ceil((activeArticleReadMs - activeArticleElapsedMs) / 1000), 0);
  const canConfirmArticleRead = Boolean(activeArticle && articleOpenedAt && activeArticleElapsedMs >= activeArticleReadMs);
  const isEmailConfirmationNotice = status.toLowerCase().includes("confirm your email");

  const chatUnreadByTopic = useMemo(() => {
    const byTopic = {} as Record<ChatTopic, number>;
    for (const topic of TOPICS) {
      const lastSeen = new Date(topicLastSeenAt[topic.key] ?? 0).getTime();
      const unreadInTopic = (topicMessages[topic.key] ?? []).filter((message) => {
        const isOwnMessage = userId ? message.senderUserId === userId : message.sender === currentDisplayName;
        return new Date(message.createdAt).getTime() > lastSeen && !isOwnMessage;
      }).length;
      byTopic[topic.key] = unreadInTopic;
    }
    return byTopic;
  }, [topicLastSeenAt, topicMessages, currentDisplayName, userId]);
  const chatUnreadCount = useMemo(
    () => TOPICS.reduce((total, topic) => total + (chatUnreadByTopic[topic.key] ?? 0), 0),
    [chatUnreadByTopic]
  );
  const currentMessages = topicMessages[selectedTopic] ?? [];
  const currentFiles = topicFiles[selectedTopic] ?? [];
  const tourHole = useMemo(() => {
    if (!tourSpotlight || screenSize.width <= 0 || screenSize.height <= 0) {
      return null;
    }
    const isTabTarget = Boolean(currentTourStep?.targetKey.startsWith("tab-"));
    const padding = isTabTarget ? 18 : 10;
    const centerX = tourSpotlight.x + tourSpotlight.width / 2;
    const centerY = tourSpotlight.y + tourSpotlight.height / 2;
    const targetWidth = isTabTarget ? Math.max(tourSpotlight.width + padding * 2, 86) : tourSpotlight.width + padding * 2;
    const targetHeight = isTabTarget ? Math.max(tourSpotlight.height + padding * 2, 86) : tourSpotlight.height + padding * 2;
    const x = Math.max(0, centerX - targetWidth / 2);
    const y = Math.max(0, centerY - targetHeight / 2);
    const width = Math.min(screenSize.width - x, targetWidth);
    const height = Math.min(screenSize.height - y, targetHeight);
    if (width <= 0 || height <= 0) {
      return null;
    }
    return { x, y, width, height };
  }, [tourSpotlight, screenSize.width, screenSize.height, currentTourStep]);
  const tourCardPositionStyle = useMemo(
    () => (tourHole && tourHole.y > screenSize.height * 0.55 ? styles.tourCardTop : styles.tourCardBottom),
    [tourHole, screenSize.height]
  );

  useEffect(() => {
    if (tab !== "chat") {
      return;
    }
    setTopicLastSeenAt((prev) => ({
      ...prev,
      [selectedTopic]: new Date().toISOString()
    }));
  }, [tab, selectedTopic, currentMessages.length]);

  useEffect(() => {
    const previous = previousUnreadByTopicRef.current;
    if (!previous) {
      previousUnreadByTopicRef.current = chatUnreadByTopic;
      return;
    }

    const increasedTopics: string[] = [];
    let totalNewMessages = 0;
    for (const topic of TOPICS) {
      const before = previous[topic.key] ?? 0;
      const after = chatUnreadByTopic[topic.key] ?? 0;
      if (after > before) {
        const added = after - before;
        totalNewMessages += added;
        increasedTopics.push(`${t(topic.labelKey)} (${added})`);
      }
    }

    if (totalNewMessages > 0) {
      const topicSummary = increasedTopics.join(", ");
      setStatus(totalNewMessages === 1 ? `New message in ${topicSummary}.` : `${totalNewMessages} new messages in ${topicSummary}.`);
    }

    previousUnreadByTopicRef.current = chatUnreadByTopic;
  }, [chatUnreadByTopic, t]);

  useEffect(() => {
    if (signedIn) {
      return;
    }
    previousUnreadByTopicRef.current = null;
  }, [signedIn]);

  useEffect(() => {
    if (!tourActive) {
      setTourSpotlight(null);
      return;
    }
    if (!currentTourStep) {
      setTourSpotlight(null);
      return;
    }
    const timer = setTimeout(() => {
      measureTourTarget(currentTourStep.targetKey, true);
    }, 40);
    return () => {
      clearTimeout(timer);
    };
  }, [tourActive, currentTourStep, tab, screenSize.width, screenSize.height]);

  useEffect(() => {
    if (!tourActive) {
      tourPulse.stopAnimation();
      tourPulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(tourPulse, { toValue: 1, duration: 850, useNativeDriver: true }),
        Animated.timing(tourPulse, { toValue: 0, duration: 850, useNativeDriver: true })
      ])
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [tourActive, tourPulse]);

  useEffect(() => {
    chatMessagesScrollRef.current?.scrollToEnd({ animated: true });
  }, [selectedTopic, currentMessages.length]);

  useEffect(() => {
    chatFilesScrollRef.current?.scrollTo({ x: 0, y: 0, animated: true });
  }, [selectedTopic]);

  async function loadFamilyContext(currentUserId: string, suggestedUsername?: string): Promise<void> {
    if (!hasSupabaseConfig()) {
      setFamilyId(getDemoFamilyId());
      setFamilyName("Demo Care Group");
      return;
    }

    try {
      const memberships = await fetchUserFamilies(currentUserId);
      if (memberships.length === 0) {
        setFamilyId(null);
        setFamilyName("");
        setFamilyJoinCode(null);
        setIsCareGroupCreator(false);
        const fallbackName = (suggestedUsername ?? accountUsername).trim();
        if (!onboardingDisplayName.trim() && fallbackName) {
          setOnboardingDisplayName(fallbackName);
        }
        return;
      }

      const active = memberships[0];
      setFamilyId(active.familyId);
      setFamilyName(active.familyName);
      setFamilyJoinCode(active.joinCode);
      setOnboardingRole(active.role);
      setRole(active.role);
      setCurrentDisplayName(active.displayName?.trim() || "You");
      setIsCareGroupCreator(Boolean(active.isCreator));
    } catch (error) {
      setStatus(`Could not load care group data: ${(error as Error).message}`);
    }
  }

  async function syncProfilePhotosFromMembers(members: FamilyMember[]): Promise<void> {
    if (!hasSupabaseConfig()) {
      return;
    }

    const entries = await Promise.all(
      members.map(async (member) => {
        if (!member.profilePhotoPath) {
          return { member, signedUrl: null as string | null };
        }
        const signedUrl = await getFamilyMemberProfilePhotoSignedUrl(member.profilePhotoPath, 60 * 60 * 24 * 7);
        return { member, signedUrl };
      })
    );

    setProfilePhotoByActor((prev) => {
      const next = { ...prev };

      for (const { member, signedUrl } of entries) {
        const keys = actorKeysForProfile({ userId: member.userId, displayName: member.displayName });
        if (!member.profilePhotoPath) {
          for (const key of keys) {
            delete next[key];
          }
          continue;
        }
        if (!signedUrl) {
          continue;
        }
        for (const key of keys) {
          const existingUri = next[key];
          if (member.userId === userId && existingUri && isLocalImageUri(existingUri)) {
            continue;
          }
          next[key] = signedUrl;
        }
      }

      return next;
    });
  }

  async function syncFamilyMembersFromSupabase(): Promise<void> {
    if (!hasSupabaseConfig() || !familyId) {
      return;
    }

    try {
      const members = await fetchFamilyMembers(familyId);
      setFamilyMembers(members);
      await syncProfilePhotosFromMembers(members);
      const mine = members.find((member) => member.userId === userId);
      if (mine?.displayName?.trim()) {
        setCurrentDisplayName(mine.displayName.trim());
      }
    } catch (error) {
      setStatus(`Could not load care group members: ${(error as Error).message}`);
    }
  }

  async function syncThirdPartyConsentsFromSupabase(): Promise<void> {
    if (!hasSupabaseConfig() || !familyId) {
      return;
    }

    try {
      const consentMap = await fetchThirdPartyConsents(familyId);
      setThirdPartyConsentByFamily((prev) => ({ ...prev, [consentScopeKey]: consentMap }));
    } catch (error) {
      setStatus(`Could not load third-party consents: ${(error as Error).message}`);
    }
  }

  async function syncCareRhythmFromSupabase(): Promise<void> {
    if (!hasSupabaseConfig() || !familyId) {
      return;
    }

    try {
      const state = await fetchCareRhythmState(familyId);
      if (state.rhythm) {
        setSelectedCareRhythm(state.rhythm as ScheduleTemplateKey);
      }
      if (state.startDate) {
        setCareRhythmStartDate(state.startDate);
      }
      setCareRhythmNotes(state.notes);
      setCareRhythmLocked(state.locked);
      setCareRhythmConfirmedBy(state.confirmedBy);
    } catch (error) {
      setStatus(`Could not load baseline confirmations: ${(error as Error).message}`);
    }
  }

  async function persistCareRhythmDraft(next: { rhythm: ScheduleTemplateKey; startDate: string; notes: string }): Promise<void> {
    if (!hasSupabaseConfig() || !familyId) {
      return;
    }

    try {
      const state = await saveCareRhythmDraft({
        familyId,
        rhythm: next.rhythm,
        startDate: next.startDate,
        notes: next.notes
      });
      setCareRhythmLocked(state.locked);
      setCareRhythmConfirmedBy(state.confirmedBy);
    } catch (error) {
      setStatus(`Could not save baseline draft: ${(error as Error).message}`);
    }
  }

  async function syncRequestsFromSupabase(): Promise<void> {
    if (!hasSupabaseConfig() || !familyId) {
      return;
    }

    try {
      const rows = await fetchScheduleRequests(familyId);
      setRequests(
        rows.map((request) => ({
          id: request.id,
          type: request.type as RequestType,
          date: request.date,
          note: request.note,
          status: request.status,
          createdBy: request.requestedBy,
          requestedByUserId: request.requestedBy,
          requestedByDisplayName: memberNameById.get(request.requestedBy),
          affectedMemberIds: request.affectedMemberIds,
          approverMemberIds: request.approverMemberIds,
          approvedByIds: request.approvedByIds
        }))
      );
    } catch (error) {
      setStatus(`Request sync failed: ${(error as Error).message}`);
    }
  }

  async function syncChatFromSupabase(): Promise<void> {
    if (!hasSupabaseConfig() || !familyId) {
      return;
    }

    try {
      const freshMembers = await fetchFamilyMembers(familyId);
      if (freshMembers.length > 0) {
        setFamilyMembers(freshMembers);
        await syncProfilePhotosFromMembers(freshMembers);
        const me = freshMembers.find((member) => member.userId === userId);
        if (me?.displayName?.trim()) {
          setCurrentDisplayName(me.displayName.trim());
        }
      }
      const freshMemberNameById = new Map<string, string>();
      for (const member of freshMembers) {
        freshMemberNameById.set(member.userId, member.displayName?.trim() || member.role.replace("_", " "));
      }

      const rows = await fetchChatMessages(familyId);
      const grouped: Record<ChatTopic, TopicMessage[]> = {
        logistics: [],
        school: [],
        health: [],
        expenses: [],
        decisions: []
      };

      for (const row of rows) {
        const topic = row.topic as ChatTopic;
        if (!(topic in grouped)) {
          continue;
        }
        grouped[topic].push({
          id: row.id,
          sender:
            freshMemberNameById.get(row.senderUserId) ??
            memberNameById.get(row.senderUserId) ??
            (row.senderUserId === userId ? currentDisplayName : "Care group member"),
          senderUserId: row.senderUserId,
          body: row.body,
          createdAt: row.createdAt
        });
      }

      setTopicMessages(grouped);
    } catch (error) {
      setStatus(`Could not sync chat: ${(error as Error).message}`);
    }
  }

  function toggleIdInList(targetId: string, setList: (updater: (prev: string[]) => string[]) => void): void {
    setList((prev) => (prev.includes(targetId) ? prev.filter((id) => id !== targetId) : [...prev, targetId]));
  }

  async function requireAuthenticatedUser(): Promise<string | null> {
    if (!hasSupabaseConfig()) {
      return userId;
    }

    const session = await getValidatedSession();
    const activeUserId = session?.user?.id ?? null;
    setUserId(activeUserId);
    return activeUserId;
  }

  async function handleSignIn(): Promise<void> {
    if (!hasSupabaseConfig()) {
      setSignedIn(true);
      return;
    }
    if (authSubmitting) {
      return;
    }

    setAuthSubmitting(true);
    try {
      const result = await signIn(email.trim(), password);
      if (result.error) {
        setStatus(result.error);
        return;
      }

      const session = await getValidatedSession();
      const currentUserId = session?.user?.id ?? null;
      const currentUsername = (session?.user?.user_metadata?.username as string | undefined) ?? "";
      setAccountUsername(currentUsername);
      setUserId(currentUserId);
      if (currentUserId) {
        await loadFamilyContext(currentUserId, currentUsername);
      }
      setSignedIn(true);
      setStatus("Signed in.");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleSignUp(): Promise<void> {
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    const trimmedUsername = accountUsername.trim();
    if (authSubmitting) {
      return;
    }
    if (!trimmedEmail || !trimmedPassword || !trimmedUsername) {
      setStatus("Username, email and password are required.");
      return;
    }

    if (!hasSupabaseConfig()) {
      setStatus("Supabase config missing in .env for account creation.");
      return;
    }

    setAuthSubmitting(true);
    try {
      const result = await signUp(trimmedEmail, trimmedPassword, trimmedUsername);
      if (result.error) {
        const errorLower = result.error.toLowerCase();
        if (errorLower.includes("rate limit") && errorLower.includes("email")) {
          setStatus("Supabase email rate limit hit. Quick fix: disable email confirmation for dev or configure custom SMTP in Supabase Auth settings.");
          return;
        }
        setStatus(result.error);
        return;
      }

      if (result.needsEmailConfirmation) {
        setStatus("Account created. Confirm your email, then sign in.");
        setAuthMode("sign_in");
        return;
      }

      const session = await getValidatedSession();
      const currentUserId = session?.user?.id ?? null;
      const currentUsername = (session?.user?.user_metadata?.username as string | undefined) ?? trimmedUsername;
      setAccountUsername(currentUsername);
      if (!onboardingDisplayName.trim()) {
        setOnboardingDisplayName(currentUsername);
      }
      setUserId(currentUserId);
      if (currentUserId) {
        await loadFamilyContext(currentUserId, currentUsername);
      }
      setSignedIn(true);
      setStatus("Account created and signed in.");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    await signOut();
    skipTour();
    setTourSpotlight(null);
    setSignedIn(false);
    setUserId(null);
    setAccountUsername("");
    setFamilyId(hasSupabaseConfig() ? null : getDemoFamilyId());
    setFamilyName(hasSupabaseConfig() ? "" : "Demo Care Group");
    setFamilyJoinCode(null);
    setFamilyMembers([]);
    setCurrentDisplayName("You");
    setIsCareGroupCreator(false);
    setJoinAccessInput("");
    setLatestRoleInvite(null);
    setStatus("Signed out.");
  }

  async function syncCalendarFromSupabase(): Promise<void> {
    if (!hasSupabaseConfig() || !familyId) {
      return;
    }

    try {
      setCalendarSyncing(true);
      const rows = await fetchCalendarEvents(familyId);
      setCalendarEvents(
        rows.map((event, index) => ({
          id: event.id,
          title: event.title,
          date: event.startsAt.slice(0, 10),
          startTime: formatTimeHHMM(event.startsAt),
          endTime: formatTimeHHMM(event.endsAt),
          recurrence: "none",
          color: EVENT_COLORS[index % EVENT_COLORS.length],
          createdBy: event.createdBy ?? ""
        }))
      );
    } catch (error) {
      setStatus(`Calendar sync failed: ${(error as Error).message}`);
    } finally {
      setCalendarSyncing(false);
    }
  }

  async function handleCreateFamily(): Promise<void> {
    if (!hasSupabaseConfig()) {
      return;
    }

    const activeUserId = await requireAuthenticatedUser();
    if (!activeUserId) {
      setStatus("Please sign in again.");
      return;
    }

    const trimmedFamilyName = familyNameInput.trim();
    if (!trimmedFamilyName || !familyPasswordInput.trim() || !onboardingDisplayName.trim()) {
      setStatus("Care group name, password and display name are required.");
      return;
    }
    if (trimmedFamilyName.length > MAX_CARE_GROUP_NAME_LENGTH) {
      setStatus(`Care group name must be ${MAX_CARE_GROUP_NAME_LENGTH} characters or fewer.`);
      return;
    }
    if (!onboardingRole) {
      setStatus("Select your role in this care group.");
      return;
    }

    try {
      const created = await createFamilyForUser({
        name: trimmedFamilyName,
        joinPassword: familyPasswordInput.trim(),
        role: onboardingRole,
        displayName: onboardingDisplayName.trim(),
        familySituation: DEFAULT_FAMILY_SITUATION
      });
      setFamilyId(created.familyId);
      setFamilyName(created.familyName);
      setFamilyJoinCode(created.joinCode);
      setRole(created.role);
      setFamilyNameInput("");
      setJoinAccessInput("");
      setFamilyPasswordInput("");
      setOnboardingDisplayName("");
      setOnboardingRole(null);
      setLatestRoleInvite(null);
      setCurrentDisplayName(created.displayName ?? "You");
      setIsCareGroupCreator(true);
      setStatus("Care group created.");
    } catch (error) {
      setStatus(`Could not create care group: ${(error as Error).message}`);
    }
  }

  async function handleJoinFamily(): Promise<void> {
    if (!hasSupabaseConfig()) {
      return;
    }

    const activeUserId = await requireAuthenticatedUser();
    if (!activeUserId) {
      setStatus("Please sign in again.");
      return;
    }

    const inviteCode = joinAccessInput.trim();
    if (!inviteCode || !familyPasswordInput.trim() || !onboardingDisplayName.trim()) {
      setStatus("Enter role invite code, plus password and display name.");
      return;
    }

    try {
      const joined = await joinFamilyForUser({
        joinPassword: familyPasswordInput.trim(),
        displayName: onboardingDisplayName.trim(),
        inviteCode
      });
      setFamilyId(joined.familyId);
      setFamilyName(joined.familyName);
      setFamilyJoinCode(joined.joinCode);
      setRole(joined.role);
      setJoinAccessInput("");
      setFamilyPasswordInput("");
      setOnboardingDisplayName("");
      setOnboardingRole(null);
      setCurrentDisplayName(joined.displayName ?? "You");
      setIsCareGroupCreator(false);
      setStatus(`Joined care group as ${APP_ROLES.find((option) => option.key === joined.role)?.label ?? joined.role}.`);
    } catch (error) {
      setStatus(`Could not join care group: ${(error as Error).message}`);
    }
  }

  async function handleCreateRoleInvite(targetRole: FamilyRole): Promise<void> {
    if (!hasSupabaseConfig() || !familyId) {
      return;
    }

    if (!isCareGroupCreator) {
      setStatus("Only the care group creator can create role invite codes.");
      return;
    }

    const activeUserId = await requireAuthenticatedUser();
    if (!activeUserId) {
      setStatus("Please sign in again.");
      return;
    }

    try {
      setInviteGeneratorBusyRole(targetRole);
      const invite = await createFamilyRoleInvite({
        familyId,
        role: targetRole
      });
      setLatestRoleInvite({ code: invite.inviteCode, role: invite.role });
      await Clipboard.setStringAsync(invite.inviteCode);
      setInviteGeneratorVisible(false);
      setStatus("Code copied.");
    } catch (error) {
      setStatus(`Could not create role invite code: ${(error as Error).message}`);
    } finally {
      setInviteGeneratorBusyRole(null);
    }
  }

  async function submitRequest(): Promise<void> {
    if (!requestDate.trim() || !requestReason.trim() || !requestChildPlan.trim()) {
      setStatus("Add date, reason, and child routine plan for this request.");
      return;
    }

    if (!hasOtherMembersForRequests) {
      setStatus("Request approvals will unlock once another care group member has joined.");
      return;
    }

    if (selectedApproverMemberIds.length === 0) {
      setStatus("Select at least one approver.");
      return;
    }

    const selectedTemplate = CARE_RHYTHM_TEMPLATES.find((item) => item.key === selectedCareRhythm);
    const compiledNote = [
      `Reason: ${requestReason.trim()}`,
      `Child routine plan: ${requestChildPlan.trim()}`,
      `Urgency: ${REQUEST_URGENCY_LABELS[requestUrgency]}`,
      `Touches handover: ${requestTouchesHandover ? "Yes" : "No"}`,
      `Child brief needed: ${requestNeedsChildBrief ? "Yes" : "No"}`,
      `Baseline rhythm: ${selectedTemplate?.label ?? "Custom"}`,
      `Baseline locked: ${careRhythmLocked ? "Yes" : "No"}`,
      careRhythmNotes.trim() ? `Rhythm notes: ${careRhythmNotes.trim()}` : ""
    ]
      .filter(Boolean)
      .join("\n");

    if (hasSupabaseConfig()) {
      const activeUserId = await requireAuthenticatedUser();
      if (!familyId || !activeUserId) {
        setStatus("Set up a care group and sign in again.");
        return;
      }

      if (selectedApproverMemberIds.includes(activeUserId)) {
        setStatus("Remove yourself from approvers. Another member must approve.");
        return;
      }

      try {
        await createScheduleRequest({
          familyId,
          type: requestType,
          date: requestDate,
          note: compiledNote,
          affectedMemberIds: [],
          approverMemberIds: selectedApproverMemberIds
        });
        await syncRequestsFromSupabase();
        setRequestDate("");
        setRequestReason("");
        setRequestChildPlan("");
        setRequestUrgency("medium");
        setRequestNeedsChildBrief(true);
        setRequestTouchesHandover(false);
        setRequestDatePickerOpen(false);
        setSelectedApproverMemberIds([]);
        setStatus("Change request submitted.");
      } catch (error) {
        setStatus(`Could not submit request: ${(error as Error).message}`);
      }
      return;
    }

    const request: ScheduleRequest = {
      id: `req-${Date.now()}`,
      type: requestType,
      date: requestDate,
      note: compiledNote,
      status: "pending",
      createdBy: currentDisplayName,
      requestedByUserId: userId ?? undefined,
      requestedByDisplayName: currentDisplayName,
      affectedMemberIds: [],
      approverMemberIds: selectedApproverMemberIds,
      approvedByIds: []
    };

    setRequests((prev) => [request, ...prev]);
    setRequestDate("");
    setRequestReason("");
    setRequestChildPlan("");
    setRequestUrgency("medium");
    setRequestNeedsChildBrief(true);
    setRequestTouchesHandover(false);
    setRequestDatePickerOpen(false);
    setSelectedApproverMemberIds([]);
    setStatus("Change request submitted.");
  }

  async function updateRequestStatus(id: string, statusValue: RequestStatus): Promise<void> {
    const target = requests.find((request) => request.id === id);
    if (!target) {
      return;
    }

    if (target.requestedByUserId && target.requestedByUserId === userId) {
      setStatus("You cannot approve your own request.");
      return;
    }

    if (statusValue !== "declined" && userId && target.approverMemberIds.length > 0 && !target.approverMemberIds.includes(userId)) {
      setStatus("You are not listed as an approver for this request.");
      return;
    }

    if (statusValue !== "declined" && userId && target.approvedByIds.includes(userId)) {
      setStatus("You already approved this request.");
      return;
    }

    if (hasSupabaseConfig()) {
      const activeUserId = await requireAuthenticatedUser();
      if (!familyId || !activeUserId || statusValue === "pending") {
        return;
      }

      try {
        await updateScheduleRequestStatus({
          familyId,
          requestId: id,
          status: statusValue
        });
        await syncRequestsFromSupabase();
      } catch (error) {
        setStatus(`Could not update request: ${(error as Error).message}`);
      }
      return;
    }

    setRequests((prev) =>
      prev.map((request) => {
        if (request.id !== id) {
          return request;
        }

        if (statusValue === "declined") {
          return { ...request, status: "declined" };
        }

        const reviewer = userId ?? "";
        const nextApprovedBy = reviewer ? Array.from(new Set([...request.approvedByIds, reviewer])) : request.approvedByIds;
        const fullyApproved =
          request.approverMemberIds.length > 0 && request.approverMemberIds.every((approverId) => nextApprovedBy.includes(approverId));

        return {
          ...request,
          approvedByIds: nextApprovedBy,
          status: fullyApproved ? "approved" : "pending"
        };
      })
    );
  }

  async function addCalendarEvent(): Promise<void> {
    if (!eventTitle.trim()) {
      setStatus("Event title is required.");
      return;
    }

    if (hasSupabaseConfig()) {
      try {
        const activeUserId = await requireAuthenticatedUser();
        if (!activeUserId) {
          setStatus("Please sign in again before adding events.");
          return;
        }
        if (!familyId) {
          setStatus("Set up or join a care group first.");
          return;
        }

        if (eventRecurrence !== "none") {
          setStatus("Recurring events are local-only for now. Create one-time events for synced care group data.");
          return;
        }

        const startsAt = combineDateAndTime(selectedDate, eventStartTime);
        const endsAt = combineDateAndTime(selectedDate, eventEndTime);
        if (!startsAt || !endsAt) {
          setStatus("Time format must be HH:MM.");
          return;
        }
        if (new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
          setStatus("End time must be after start time.");
          return;
        }

        await createCalendarEventAt({
          familyId,
          title: eventTitle.trim(),
          startsAt,
          endsAt,
          createdBy: activeUserId
        });
        await syncCalendarFromSupabase();
        setEventTitle("");
        setEventRecurrence("none");
        setStatus("Calendar event added.");
        return;
      } catch (error) {
        setStatus(`Could not create event: ${(error as Error).message}`);
        return;
      }
    }

    const event: CalendarEvent = {
      id: `evt-${Date.now()}`,
      title: eventTitle.trim(),
      date: selectedDate,
      startTime: eventStartTime.trim() || "09:00",
      endTime: eventEndTime.trim() || "10:00",
      recurrence: eventRecurrence,
      color: EVENT_COLORS[calendarEvents.length % EVENT_COLORS.length],
      createdBy: currentDisplayName
    };

    setCalendarEvents((prev) => [event, ...prev]);
    setEventTitle("");
    setEventRecurrence("none");
    setStatus("Calendar event added.");
  }

  async function deleteCalendarEvent(id: string): Promise<void> {
    const event = calendarEvents.find((item) => item.id === id);
    if (!event) {
      return;
    }

    const canDelete = hasSupabaseConfig() ? Boolean(userId && event.createdBy === userId) : event.createdBy === currentDisplayName;
    if (!canDelete) {
      setStatus("Only the member who created this event can delete it.");
      return;
    }

    if (hasSupabaseConfig()) {
      try {
        if (!familyId) {
          setStatus("Set up or join a care group first.");
          return;
        }
        await deleteCalendarEventRecord(familyId, id);
        await syncCalendarFromSupabase();
        setStatus("Calendar event deleted.");
      } catch (error) {
        setStatus(`Could not delete event: ${(error as Error).message}`);
      }
      return;
    }

    setCalendarEvents((prev) => prev.filter((event) => event.id !== id));
  }

  function getProfilePhotoUriForActor(input: { userId?: string | null; displayName?: string | null }): string | null {
    for (const key of actorKeysForProfile(input)) {
      const uri = profilePhotoByActor[key];
      if (uri && isRenderableImageUri(uri)) {
        return uri;
      }
    }
    return null;
  }

  function appendTopicMessage(input: { topic: ChatTopic; sender: string; senderUserId?: string; body: string }): void {
    const message: TopicMessage = {
      id: `msg-${Date.now()}`,
      sender: input.sender,
      senderUserId: input.senderUserId,
      body: input.body,
      createdAt: new Date().toISOString()
    };

    setTopicMessages((prev) => ({
      ...prev,
      [input.topic]: [...prev[input.topic], message]
    }));
  }

  function sendTopicMessage(): void {
    if (!chatDraft.trim()) {
      return;
    }
    if (sendingChat) {
      return;
    }

    const sender = currentDisplayName || APP_ROLES.find((item) => item.key === role)?.label || "Care group member";
    const draft = chatDraft.trim();
    const nowMs = Date.now();
    const lastSent = lastSentMessageRef.current;
    if (lastSent && lastSent.topic === selectedTopic && lastSent.body === draft && nowMs - lastSent.sentAtMs < 1500) {
      return;
    }

    if (toneCoachEnabled && draftAssistanceState === "assistive" && !toneOverrideArmed) {
      setToneOverrideArmed(true);
      setStatus("Tone coach detected possible escalation. Review suggestions or press Send again to continue.");
      return;
    }

    if (toneCoachEnabled && draftAssistanceState === "restricted") {
      setStatus("Safety guard active. Adjust wording or governance settings before sending.");
      return;
    }

    if (hasSupabaseConfig()) {
      setSendingChat(true);
      void (async () => {
        const activeUserId = await requireAuthenticatedUser();
        if (!familyId || !activeUserId) {
          setStatus("Please sign in again to send messages.");
          setSendingChat(false);
          return;
        }

        try {
          await createChatMessage({
            familyId,
            topic: selectedTopic,
            body: draft
          });
          appendTopicMessage({ topic: selectedTopic, sender, senderUserId: activeUserId, body: draft });
          lastSentMessageRef.current = { topic: selectedTopic, body: draft, sentAtMs: Date.now() };
          setToneOverrideArmed(false);
          setChatDraft("");
          void syncChatFromSupabase();
        } catch (error) {
          appendTopicMessage({ topic: selectedTopic, sender, senderUserId: activeUserId, body: draft });
          lastSentMessageRef.current = { topic: selectedTopic, body: draft, sentAtMs: Date.now() };
          setToneOverrideArmed(false);
          setChatDraft("");
          setStatus(`Live sync unavailable, message kept locally: ${(error as Error).message}`);
        } finally {
          setSendingChat(false);
        }
      })();
      return;
    }

    appendTopicMessage({ topic: selectedTopic, sender, body: draft });
    lastSentMessageRef.current = { topic: selectedTopic, body: draft, sentAtMs: Date.now() };

    setToneOverrideArmed(false);
    setChatDraft("");
  }

  async function resolveFileSizeBytes(uri: string, fallback: number | null | undefined): Promise<number> {
    if (typeof fallback === "number" && Number.isFinite(fallback) && fallback > 0) {
      return fallback;
    }
    try {
      const info = (await FileSystem.getInfoAsync(uri)) as { exists: boolean; size?: number };
      if (info.exists && typeof info.size === "number" && info.size > 0) {
        return info.size;
      }
    } catch {
      // Keep fallback behavior below if file metadata cannot be read.
    }
    return 0;
  }

  function defaultUploadName(input: { source: "files" | "camera" | "library"; originalName: string; mimeType: string }): string {
    const original = input.originalName.trim();
    if (original) {
      return original;
    }

    const stamp = new Date().toISOString().slice(0, 10);
    if (input.source === "camera" || input.source === "library") {
      return `Image-${stamp}.jpg`;
    }
    if (input.mimeType === "application/pdf") {
      return `Document-${stamp}.pdf`;
    }
    return `File-${stamp}`;
  }

  function resetUploadModalState(): void {
    setPendingUpload(null);
    setUploadDisplayName("");
    setUploadInProgress(false);
  }

  function openUploadModal(): void {
    resetUploadModalState();
    setUploadModalVisible(true);
  }

  function closeUploadModal(): void {
    setUploadModalVisible(false);
    resetUploadModalState();
  }

  function resetProfileUploadModalState(): void {
    setPendingProfileUpload(null);
    setProfileUploadInProgress(false);
  }

  function openProfileUploadModal(): void {
    resetProfileUploadModalState();
    setProfileUploadModalVisible(true);
  }

  function closeProfileUploadModal(): void {
    setProfileUploadModalVisible(false);
    resetProfileUploadModalState();
  }

  async function stageProfileUploadFromFiles(): Promise<void> {
    if (profileUploadInProgress) {
      return;
    }

    setProfileUploadInProgress(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["image/*", "image/heic", "image/heif", "image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/tiff"],
        multiple: false,
        copyToCacheDirectory: true
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const sizeBytes = await resolveFileSizeBytes(asset.uri, asset.size);
      if (sizeBytes > MAX_UPLOAD_BYTES) {
        setStatus("File too large. Max upload size is 25 MB.");
        return;
      }

      const mimeType = asset.mimeType || "application/octet-stream";
      const originalName = asset.name || "";
      if (!isSupportedProfileImage({ mimeType, name: originalName })) {
        setStatus("Please select a supported image file for the profile picture.");
        return;
      }

      setPendingProfileUpload({
        uri: asset.uri,
        mimeType: mimeType === "application/octet-stream" ? "image/jpeg" : mimeType,
        sizeBytes,
        source: "files",
        originalName
      });
    } catch (error) {
      setStatus(`Could not select profile picture: ${(error as Error).message}`);
    } finally {
      setProfileUploadInProgress(false);
    }
  }

  async function stageProfileUploadFromCamera(): Promise<void> {
    if (profileUploadInProgress) {
      return;
    }

    setProfileUploadInProgress(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setStatus("Camera permission is required to capture a profile picture.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9
      });
      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const sizeBytes = await resolveFileSizeBytes(asset.uri, asset.fileSize);
      if (sizeBytes > MAX_UPLOAD_BYTES) {
        setStatus("Captured file is too large. Max upload size is 25 MB.");
        return;
      }

      setPendingProfileUpload({
        uri: asset.uri,
        mimeType: asset.mimeType || "image/jpeg",
        sizeBytes,
        source: "camera",
        originalName: asset.fileName || ""
      });
    } catch (error) {
      setStatus(`Could not open camera: ${(error as Error).message}`);
    } finally {
      setProfileUploadInProgress(false);
    }
  }

  async function stageProfileUploadFromLibrary(): Promise<void> {
    if (profileUploadInProgress) {
      return;
    }

    setProfileUploadInProgress(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setStatus("Photo library permission is required.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9
      });
      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const sizeBytes = await resolveFileSizeBytes(asset.uri, asset.fileSize);
      if (sizeBytes > MAX_UPLOAD_BYTES) {
        setStatus("Selected file is too large. Max upload size is 25 MB.");
        return;
      }

      setPendingProfileUpload({
        uri: asset.uri,
        mimeType: asset.mimeType || "image/jpeg",
        sizeBytes,
        source: "library",
        originalName: asset.fileName || ""
      });
    } catch (error) {
      setStatus(`Could not open photo library: ${(error as Error).message}`);
    } finally {
      setProfileUploadInProgress(false);
    }
  }

  async function persistProfileUploadUri(input: { uri: string; mimeType: string; originalName: string }): Promise<string> {
    if (!FileSystem.documentDirectory) {
      return input.uri;
    }

    const directory = `${FileSystem.documentDirectory}profile-photos`;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const extension = getFileExtension(input.originalName) || extensionForMimeType(input.mimeType);
    const destination = `${directory}/${Date.now()}-${Math.round(Math.random() * 1e6)}.${extension}`;

    if (input.uri.startsWith("file://")) {
      await FileSystem.copyAsync({ from: input.uri, to: destination });
    } else {
      await FileSystem.downloadAsync(input.uri, destination);
    }

    return destination;
  }

  async function uploadProfilePhotoToSupabase(input: {
    familyId: string;
    userId: string;
    uri: string;
    mimeType: string;
    originalName: string;
  }): Promise<string> {
    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error("Supabase client not available.");
    }

    const extension = getFileExtension(input.originalName) || extensionForMimeType(input.mimeType);
    const objectPath = `${input.familyId}/${input.userId}/avatar-${Date.now()}.${extension}`;
    const base64Payload = await FileSystem.readAsStringAsync(input.uri, { encoding: FileSystem.EncodingType.Base64 });
    if (!base64Payload.trim()) {
      throw new Error("Could not read selected profile picture.");
    }
    const bytes = base64ToUint8Array(base64Payload);
    const { error } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).upload(objectPath, bytes, {
      upsert: true,
      contentType: input.mimeType
    });
    if (error) {
      throw new Error(error.message);
    }

    return objectPath;
  }

  async function confirmProfileUpload(): Promise<void> {
    if (!pendingProfileUpload) {
      setStatus("Select a profile picture first.");
      return;
    }

    try {
      const localFallbackUri = await persistProfileUploadUri({
        uri: pendingProfileUpload.uri,
        mimeType: pendingProfileUpload.mimeType,
        originalName: pendingProfileUpload.originalName
      });
      let resolvedPhotoUri = localFallbackUri;
      const activeUserId = await requireAuthenticatedUser();

      if (hasSupabaseConfig() && familyId && activeUserId) {
        const objectPath = await uploadProfilePhotoToSupabase({
          familyId,
          userId: activeUserId,
          uri: localFallbackUri,
          mimeType: pendingProfileUpload.mimeType,
          originalName: pendingProfileUpload.originalName
        });
        await updateFamilyMemberProfilePhotoPath({
          familyId,
          profilePhotoPath: objectPath
        });
        const remotePhotoUri = await getFamilyMemberProfilePhotoSignedUrl(objectPath, 60 * 60 * 24 * 7);
        resolvedPhotoUri = remotePhotoUri || localFallbackUri;
        setFamilyMembers((prev) =>
          prev.map((member) => (member.userId === activeUserId ? { ...member, profilePhotoPath: objectPath } : member))
        );
      }

      const nextKeys = actorKeysForProfile({ userId: activeUserId ?? userId, displayName: currentDisplayName });
      if (nextKeys.length === 0) {
        setStatus("Could not determine profile owner key.");
        return;
      }

      setProfilePhotoByActor((prev) => {
        const next = { ...prev };
        for (const key of nextKeys) {
          next[key] = resolvedPhotoUri;
        }
        return next;
      });
      setStatus("Profile picture updated.");
      closeProfileUploadModal();
    } catch (error) {
      setStatus(`Could not save profile picture: ${(error as Error).message}`);
    }
  }

  async function stageUploadFromFiles(): Promise<void> {
    if (uploadInProgress) {
      return;
    }

    setUploadInProgress(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "image/*",
          "application/pdf",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "text/plain",
          "text/csv",
          "*/*"
        ],
        multiple: false,
        copyToCacheDirectory: true
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const sizeBytes = await resolveFileSizeBytes(asset.uri, asset.size);
      if (sizeBytes > MAX_UPLOAD_BYTES) {
        setStatus("File too large. Max upload size is 25 MB.");
        return;
      }

      const mimeType = asset.mimeType || "application/octet-stream";
      const originalName = asset.name || "";
      setPendingUpload({
        uri: asset.uri,
        mimeType,
        sizeBytes,
        source: "files",
        originalName
      });
      setUploadDisplayName(defaultUploadName({ source: "files", originalName, mimeType }));
    } catch (error) {
      setStatus(`Could not select file: ${(error as Error).message}`);
    } finally {
      setUploadInProgress(false);
    }
  }

  async function stageUploadFromCamera(): Promise<void> {
    if (uploadInProgress) {
      return;
    }

    setUploadInProgress(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setStatus("Camera permission is required to capture a file.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9
      });
      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const sizeBytes = await resolveFileSizeBytes(asset.uri, asset.fileSize);
      if (sizeBytes > MAX_UPLOAD_BYTES) {
        setStatus("Captured file is too large. Max upload size is 25 MB.");
        return;
      }

      const mimeType = asset.mimeType || "image/jpeg";
      const originalName = asset.fileName || "";
      setPendingUpload({
        uri: asset.uri,
        mimeType,
        sizeBytes,
        source: "camera",
        originalName
      });
      setUploadDisplayName(defaultUploadName({ source: "camera", originalName, mimeType }));
    } catch (error) {
      setStatus(`Could not open camera: ${(error as Error).message}`);
    } finally {
      setUploadInProgress(false);
    }
  }

  async function stageUploadFromLibrary(): Promise<void> {
    if (uploadInProgress) {
      return;
    }

    setUploadInProgress(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setStatus("Photo library permission is required.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9
      });
      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      const sizeBytes = await resolveFileSizeBytes(asset.uri, asset.fileSize);
      if (sizeBytes > MAX_UPLOAD_BYTES) {
        setStatus("Selected file is too large. Max upload size is 25 MB.");
        return;
      }

      const mimeType = asset.mimeType || "image/jpeg";
      const originalName = asset.fileName || "";
      setPendingUpload({
        uri: asset.uri,
        mimeType,
        sizeBytes,
        source: "library",
        originalName
      });
      setUploadDisplayName(defaultUploadName({ source: "library", originalName, mimeType }));
    } catch (error) {
      setStatus(`Could not open photo library: ${(error as Error).message}`);
    } finally {
      setUploadInProgress(false);
    }
  }

  function confirmPendingUpload(): void {
    if (!pendingUpload) {
      setStatus("Select a file source first.");
      return;
    }

    const finalNameRaw = uploadDisplayName.trim() || defaultUploadName(pendingUpload);
    const typedExt = getFileExtension(finalNameRaw);
    const originalExt = getFileExtension(pendingUpload.originalName);
    const finalName = !typedExt && originalExt ? `${finalNameRaw}.${originalExt}` : finalNameRaw;
    const uploadedBy = currentDisplayName || APP_ROLES.find((item) => item.key === role)?.label || "Care group member";

    const fileItem: SharedFileItem = {
      id: `file-${Date.now()}`,
      topic: selectedTopic,
      name: finalName,
      uri: pendingUpload.uri,
      mimeType: pendingUpload.mimeType,
      sizeBytes: pendingUpload.sizeBytes,
      source: pendingUpload.source,
      uploadedAt: new Date().toISOString(),
      uploadedBy
    };

    setTopicFiles((prev) => ({
      ...prev,
      [selectedTopic]: [fileItem, ...(prev[selectedTopic] ?? [])]
    }));
    setStatus("File added to this chat topic.");
    closeUploadModal();
  }

  function canPreviewInline(file: SharedFileItem): boolean {
    return file.mimeType.toLowerCase().startsWith("image/");
  }

  function canPreviewInlineVideo(file: SharedFileItem): boolean {
    return file.mimeType.toLowerCase().startsWith("video/");
  }

  async function performFileDownload(file: SharedFileItem): Promise<void> {
    try {
      if (!FileSystem.documentDirectory) {
        setStatus("Download location is not available on this device.");
        return;
      }

      const downloadsDir = `${FileSystem.documentDirectory}downloads`;
      await FileSystem.makeDirectoryAsync(downloadsDir, { intermediates: true });

      const safeName = sanitizeFileName(file.name);
      const destination = `${downloadsDir}/${Date.now()}-${safeName}`;

      if (file.uri.startsWith("file://")) {
        await FileSystem.copyAsync({ from: file.uri, to: destination });
      } else {
        await FileSystem.downloadAsync(file.uri, destination);
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(destination, {
          mimeType: file.mimeType,
          dialogTitle: "Save or share file"
        });
      } else {
        const canOpen = await Linking.canOpenURL(destination);
        if (canOpen) {
          await Linking.openURL(destination);
        }
      }

      setStatus("File downloaded. Use the share sheet to save it on your device.");
    } catch (error) {
      setStatus(`Could not download file: ${(error as Error).message}`);
    }
  }

  function askToDownloadFile(file: SharedFileItem): void {
    Alert.alert("Download file?", `Do you want to download "${file.name}" to your device?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Yes, download", onPress: () => void performFileDownload(file) }
    ]);
  }

  async function applySimplifyDraft(): Promise<void> {
    setChatDraft(await assistiveAi.simplify(chatDraft));
  }

  async function applyNeutralRephraseDraft(): Promise<void> {
    setChatDraft(await assistiveAi.rephraseNeutral(chatDraft));
  }

  async function applyAssistiveTranslateDraft(): Promise<void> {
    setChatDraft(await assistiveAi.translateAssistive(chatDraft, languagePreference));
  }

  function togglePackingItem(id: string): void {
    setPackingList((prev) =>
      prev.map((item) => {
        if (item.id !== id) {
          return item;
        }

        return {
          ...item,
          packed: !item.packed
        };
      })
    );
  }

  function addPackingItem(): void {
    if (!packingInput.trim()) {
      return;
    }

    setPackingList((prev) => [...prev, { id: `p-${Date.now()}`, label: packingInput.trim(), packed: false }]);
    setPackingInput("");
  }

  function savePackingPreset(): void {
    const name = packingPresetNameInput.trim();
    if (!name) {
      setStatus("Add a preset group name first.");
      return;
    }

    const items = Array.from(
      new Set(
        packingList
          .map((item) => item.label.trim())
          .filter(Boolean)
      )
    );
    if (items.length === 0) {
      setStatus("Add at least one packing item before saving a preset.");
      return;
    }

    const existing = packingPresets.find((preset) => preset.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      setPackingPresets((prev) => prev.map((preset) => (preset.id === existing.id ? { ...preset, items } : preset)));
      setPackingPresetNameInput("");
      setStatus(`Updated preset "${name}".`);
      return;
    }

    setPackingPresets((prev) => [...prev, { id: `pack-preset-${Date.now()}`, name, items }]);
    setPackingPresetNameInput("");
    setStatus(`Saved preset "${name}".`);
  }

  function applyPackingPreset(preset: PackingPresetGroup): void {
    const nextItems = preset.items.map((label, index) => ({
      id: `p-${Date.now()}-${index}`,
      label,
      packed: false
    }));
    setPackingList(nextItems);
    setStatus(`Loaded preset "${preset.name}".`);
  }

  function deletePackingPreset(id: string): void {
    setPackingPresets((prev) => prev.filter((preset) => preset.id !== id));
  }

  function addCheckIn(): void {
    const entry: CheckInLog = {
      id: `ci-${Date.now()}`,
      timestamp: new Date().toISOString(),
      note: checkInNote.trim() || "Handover check-in"
    };

    setCheckInLogs((prev) => [entry, ...prev]);
    setCheckInNote("");
  }

  async function copyInviteCode(inviteCode: string): Promise<void> {
    try {
      await Clipboard.setStringAsync(inviteCode);
      setStatus("Invite code copied.");
    } catch (error) {
      setStatus(`Could not copy invite code: ${(error as Error).message}`);
    }
  }

  function handleDayPress(day: DateData): void {
    setSelectedDate(day.dateString);
    setEventStartTime("17:00");
    setEventEndTime("18:00");
  }

  function handleRequestDatePick(day: DateData): void {
    setRequestDate(day.dateString);
    setRequestDatePickerOpen(false);
  }

  function handleCareRhythmChange(nextRhythm: ScheduleTemplateKey): void {
    if (careRhythmLocked) {
      setStatus("Baseline care rhythm is locked. Submit a change request to adjust it.");
      return;
    }
    setSelectedCareRhythm(nextRhythm);
    setCareRhythmConfirmedBy([]);
    void persistCareRhythmDraft({ rhythm: nextRhythm, startDate: careRhythmStartDate, notes: careRhythmNotes });
  }

  async function confirmCareRhythm(): Promise<void> {
    if (!isBaselineApprover) {
      setStatus("Only required baseline approvers can confirm this care rhythm.");
      return;
    }

    if (careRhythmLocked) {
      setStatus("Baseline care rhythm already locked.");
      return;
    }

    const actorId = hasSupabaseConfig() ? userId : currentActorId;
    if (!actorId) {
      setStatus("Please sign in again.");
      return;
    }

    if (hasSupabaseConfig() && familyId) {
      try {
        const state = await confirmCareRhythmBy({
          familyId,
          approverMemberIds: baselineApproverIds,
          rhythm: selectedCareRhythm,
          startDate: careRhythmStartDate,
          notes: careRhythmNotes
        });
        setCareRhythmConfirmedBy(state.confirmedBy);
        setCareRhythmLocked(state.locked);
        if (state.locked) {
          setStatus("Baseline care rhythm locked by all required approvers.");
        } else {
          setStatus(`Baseline confirmation saved. Waiting for remaining approvers (${state.confirmedBy.length}/${Math.max(1, baselineApproverIds.length)}).`);
        }
      } catch (error) {
        setStatus(`Could not save baseline confirmation: ${(error as Error).message}`);
      }
      return;
    }

    setCareRhythmConfirmedBy((prev) => {
      const next = prev.includes(actorId) ? prev : [...prev, actorId];
      const requiredCount = Math.max(1, baselineApproverIds.length);
      if (next.length >= requiredCount) {
        setCareRhythmLocked(true);
        setStatus("Baseline care rhythm locked by all required approvers.");
      } else {
        setStatus(`Baseline confirmation saved. Waiting for remaining approvers (${next.length}/${requiredCount}).`);
      }
      return next;
    });
  }

  function toggleThirdPartyConsentFor(memberId: string): void {
    if (!isMainCaregiver) {
      setStatus("Only primary caregivers can manage third-party access consent.");
      return;
    }

    const actorId = hasSupabaseConfig() ? userId : currentActorId;
    if (!actorId) {
      setStatus("Please sign in again.");
      return;
    }

    if (memberId !== actorId) {
      setStatus("You can only update your own consent.");
      return;
    }

    const current = thirdPartyConsentByCaregiver[memberId] ?? false;
    const nextValue = !current;

    if (hasSupabaseConfig() && familyId) {
      void (async () => {
        try {
          const updated = await upsertThirdPartyConsent({
            familyId,
            caregiverId: memberId,
            consented: nextValue
          });
          setThirdPartyConsentByFamily((prev) => ({ ...prev, [consentScopeKey]: updated }));
        } catch (error) {
          setStatus(`Could not save third-party consent: ${(error as Error).message}`);
        }
      })();
      return;
    }

    setThirdPartyConsentByFamily((prev) => {
      const local = prev[consentScopeKey] ?? {};
      return {
        ...prev,
        [consentScopeKey]: {
          ...local,
          [memberId]: nextValue
        }
      };
    });
  }

  function openGuidanceArticle(articleKey: string): void {
    setOpenArticleKey(articleKey);
    setArticleOpenedAt(Date.now());
    setArticleTimerNow(Date.now());
  }

  function closeGuidanceArticle(): void {
    setOpenArticleKey(null);
    setArticleOpenedAt(null);
  }

  function confirmGuidanceRead(): void {
    if (!activeArticle || !canConfirmArticleRead) {
      return;
    }

    const rewardPoints = guidanceRewardByKey.get(activeArticle.key) ?? 0;
    setReadArticleKeysByMember((prev) => {
      const current = prev[currentMemberKey] ?? [];
      const nextKeys = current.includes(activeArticle.key) ? current : [...current, activeArticle.key];
      return { ...prev, [currentMemberKey]: nextKeys };
    });
    setStatus(`Article marked as read. +${rewardPoints} points`);
    closeGuidanceArticle();
  }

  function registerTourTargetRef(target: TourTargetKey, node: View | null): void {
    tourTargetRefs.current[target] = node;
  }

  function setTourSpotlightRect(next: TourRect | null): void {
    setTourSpotlight((prev) => {
      if (!prev && !next) {
        return prev;
      }
      if (!next) {
        return null;
      }
      if (!prev) {
        return next;
      }
      const epsilon = 0.5;
      const unchanged =
        Math.abs(prev.x - next.x) < epsilon &&
        Math.abs(prev.y - next.y) < epsilon &&
        Math.abs(prev.width - next.width) < epsilon &&
        Math.abs(prev.height - next.height) < epsilon;
      return unchanged ? prev : next;
    });
  }

  function handleTourTargetLayout(target: TourTargetKey): void {
    if (!tourActive || currentTourStep?.targetKey !== target) {
      return;
    }
    measureTourTarget(target, false);
  }

  function measureTourTarget(target: TourTargetKey, clearOnFail: boolean): void {
    const node = tourTargetRefs.current[target];
    if (!node) {
      if (clearOnFail) {
        setTourSpotlightRect(null);
      }
      return;
    }

    const root = appRootRef.current;
    if (root) {
      node.measureLayout(
        root,
        (x, y, width, height) => {
          if (width <= 0 || height <= 0) {
            if (clearOnFail) {
              setTourSpotlightRect(null);
            }
            return;
          }
          setTourSpotlightRect({ x, y, width, height });
        },
        () => {
          if (clearOnFail) {
            setTourSpotlightRect(null);
          }
        }
      );
      return;
    }

    node.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) {
        if (clearOnFail) {
          setTourSpotlightRect(null);
        }
        return;
      }
      setTourSpotlightRect({ x, y, width, height });
    });
  }

  function handleTourTargetPress(target: TourTargetKey, onPress?: () => void): void {
    if (tourActive) {
      return;
    }
    onPress?.();
  }

  function handleTourOverlayPress(): void {
    if (!tourActive) {
      return;
    }
    const finishing = tourStepIndex >= tourTotalSteps - 1;
    if (finishing) {
      completeTour();
      setTourSpotlightRect(null);
      setStatus("Tour complete. You can restart it any time from Settings.");
      return;
    }
    advanceTourStep();
    setTourSpotlightRect(null);
  }

  if (!sessionReady) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.centered}>
          <ActivityIndicator />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (!signedIn) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.screen}>
          <View style={styles.card}>
            <Text style={styles.title}>ParentsAPP</Text>
            <Text style={styles.hint}>
              {hasSupabaseConfig() ? "Use your account to sign in or create one." : "Use Supabase auth for live accounts, or continue in local demo mode."}
            </Text>
            <View style={styles.rowWrap}>
              <Pressable style={[styles.chip, authMode === "sign_in" ? styles.chipActive : undefined]} onPress={() => setAuthMode("sign_in")}>
                <Text style={styles.chipText}>{t("sign_in")}</Text>
              </Pressable>
              <Pressable
                style={[styles.chip, authMode === "create_account" ? styles.chipActive : undefined]}
                onPress={() => setAuthMode("create_account")}
              >
                <Text style={styles.chipText}>{t("create_account")}</Text>
              </Pressable>
            </View>
            {authMode === "create_account" && (
              <TextInput
                value={accountUsername}
                onChangeText={setAccountUsername}
                placeholder={t("username")}
                style={styles.input}
                autoCapitalize="none"
              />
            )}
            <TextInput value={email} onChangeText={setEmail} placeholder={t("email")} style={styles.input} autoCapitalize="none" />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={t("password")}
              secureTextEntry
              style={styles.input}
              autoCapitalize="none"
            />
            {authMode === "sign_in" ? (
              <Pressable style={[styles.primaryButton, authSubmitting ? styles.disabledButton : undefined]} onPress={() => void handleSignIn()} disabled={authSubmitting}>
                <Text style={styles.primaryButtonText}>{authSubmitting ? "Please wait..." : t("sign_in")}</Text>
              </Pressable>
            ) : (
              <Pressable style={[styles.primaryButton, authSubmitting ? styles.disabledButton : undefined]} onPress={() => void handleSignUp()} disabled={authSubmitting}>
                <Text style={styles.primaryButtonText}>{authSubmitting ? "Please wait..." : t("create_account")}</Text>
              </Pressable>
            )}
            {!hasSupabaseConfig() && (
              <Pressable style={styles.secondaryButton} onPress={() => setSignedIn(true)}>
                <Text style={styles.secondaryButtonText}>Continue in demo mode</Text>
              </Pressable>
            )}
            <Text style={[styles.statusText, isEmailConfirmationNotice ? styles.statusTextEmphasis : undefined]}>{status}</Text>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (hasSupabaseConfig() && !familyId) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.screen}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.authScrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
          <Text style={styles.title}>{t("care_group_setup")}</Text>
          <Text style={styles.hint}>{`${t("create_care_group")} / ${t("join_care_group")}`}</Text>
            <View style={styles.rowWrap}>
              <Pressable
                style={[styles.chip, familySetupMode === "create" ? styles.chipActive : undefined]}
                onPress={() => setFamilySetupMode("create")}
              >
                <Text style={styles.chipText}>{t("create_care_group")}</Text>
              </Pressable>
              <Pressable
                style={[styles.chip, familySetupMode === "join" ? styles.chipActive : undefined]}
                onPress={() => setFamilySetupMode("join")}
              >
                <Text style={styles.chipText}>{t("join_care_group")}</Text>
              </Pressable>
            </View>
            {familySetupMode === "create" && (
              <>
                <TextInput
                  value={familyNameInput}
                  onChangeText={(value) => setFamilyNameInput(value.slice(0, MAX_CARE_GROUP_NAME_LENGTH))}
                  placeholder={t("care_group_name")}
                  style={styles.input}
                  maxLength={MAX_CARE_GROUP_NAME_LENGTH}
                />
                <Text style={styles.smallText}>{`${familyNameInput.length}/${MAX_CARE_GROUP_NAME_LENGTH}`}</Text>
              </>
            )}
            {familySetupMode !== "create" && (
              <>
                <TextInput
                  value={joinAccessInput}
                  onChangeText={setJoinAccessInput}
                  placeholder="Role invite code"
                  style={styles.input}
                  autoCapitalize="characters"
                />
                <Text style={styles.smallText}>Enter only the role invite code you received.</Text>
              </>
            )}
            <TextInput
              value={familyPasswordInput}
              onChangeText={setFamilyPasswordInput}
              placeholder="Care group password"
              secureTextEntry
              style={styles.input}
              autoCapitalize="none"
            />
            <TextInput
              value={onboardingDisplayName}
              onChangeText={setOnboardingDisplayName}
              placeholder={t("display_name")}
              style={styles.input}
            />
            {familySetupMode === "create" ? (
              <>
                <Text style={styles.smallText}>Your role in this care group</Text>
                <View style={styles.rowWrap}>
                  {APP_ROLES.map((option) => (
                    <Pressable
                      key={option.key}
                      style={[styles.chip, onboardingRole === option.key ? styles.chipActive : undefined]}
                      onPress={() => setOnboardingRole(option.key)}
                    >
                      <Text style={styles.chipText}>{option.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : (
              <>
                <Text style={styles.smallText}>Your role is assigned by invite code to prevent accidental privilege escalation.</Text>
              </>
            )}
            <Pressable
              style={styles.primaryButton}
              onPress={familySetupMode === "create" ? () => void handleCreateFamily() : () => void handleJoinFamily()}
            >
              <Text style={styles.primaryButtonText}>{familySetupMode === "create" ? t("create_care_group") : t("join_care_group")}</Text>
            </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => void handleSignOut()}>
            <Text style={styles.secondaryButtonText}>{t("sign_out")}</Text>
          </Pressable>
            <Text style={[styles.statusText, isEmailConfirmationNotice ? styles.statusTextEmphasis : undefined]}>{status}</Text>
          </View>
          </ScrollView>
          </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView
        ref={appRootRef}
        collapsable={false}
        style={styles.screen}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setScreenSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
        }}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit>
              {`${familyName || "Care"}`}
            </Text>
            {hasSupabaseConfig() ? (
              <Text style={styles.smallText}>Invite codes are in Settings.</Text>
            ) : (
              <Text style={styles.smallText}>Demo mode</Text>
            )}
          </View>
          <View style={[styles.handoverBadge, handoverBadgeVariantStyle]}>
            <Text style={[styles.handoverBadgeText, handoverBadgeTextVariantStyle]}>
              Handover:{" "}
              {daysUntilNextHandover === null
                ? "n/a"
                : daysUntilNextHandover === 0
                  ? "today"
                  : `${daysUntilNextHandover} day(s)`}
            </Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
        {tab === "home" && (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{`Today, ${formatDateForDisplay(todayDate)}`}</Text>
              {todayEvents.length === 0 && todayPendingRequests.length === 0 ? (
                <Text style={styles.smallText}>All due duties done for now.</Text>
              ) : (
                <>
                  <Text style={styles.smallText}>Calendar</Text>
                  {todayEvents.length === 0 ? (
                    <Text style={styles.smallText}>No calendar events scheduled today.</Text>
                  ) : (
                    todayEvents.map((event) => (
                      <View key={`today-${event.id}`} style={styles.listItem}>
                        <Text style={styles.eventTitleText}>{event.title}</Text>
                        <Text style={styles.smallText}>
                          {event.startTime} - {event.endTime}
                        </Text>
                      </View>
                    ))
                  )}
                  <Text style={styles.smallText}>Pending requests for today</Text>
                  {todayPendingRequests.length === 0 ? (
                    <Text style={styles.smallText}>No pending change requests due today.</Text>
                  ) : (
                    todayPendingRequests.map((request) => (
                      <View key={`today-req-${request.id}`} style={styles.listItem}>
                        <Text style={styles.bodyText}>{REQUEST_TYPE_LABELS[request.type]}</Text>
                        <Text style={styles.smallText}>{request.note}</Text>
                      </View>
                    ))
                  )}
                </>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("evidence_guidance")}</Text>
              <Text style={styles.smallText}>Member progress is tracked individually for each care-group member.</Text>
              {CURATED_GUIDANCE.map((item) => (
                <Pressable key={item.key} style={styles.guidanceItem} onPress={() => openGuidanceArticle(item.key)}>
                  <View style={styles.guidanceHeaderRow}>
                    <Text style={styles.bodyText}>{item.title}</Text>
                    <Text style={readArticleKeys.includes(item.key) ? styles.guidanceReadBadge : styles.guidanceUnreadBadge}>
                      {readArticleKeys.includes(item.key) ? "Read" : "Unread"}
                    </Text>
                  </View>
                  <Text style={styles.smallText}>{item.text}</Text>
                  <Text style={styles.smallText}>
                    Estimated read time: {formatDurationCompact(estimateReadingSeconds(item.content))} · Reward:{" "}
                    {guidanceRewardByKey.get(item.key) ?? 0} pts
                  </Text>
                </Pressable>
              ))}
              <View style={styles.scoreCard}>
                <Text style={styles.sectionTitle}>Reading score: {readScore}</Text>
                <Text style={styles.smallText}>
                  Progress: {readArticleKeys.length}/{CURATED_GUIDANCE.length} articles ({readProgressPercent}%)
                </Text>
              </View>
              <Text style={styles.smallText}>Supportive only, not legal or clinical advice.</Text>
            </View>
          </>
        )}

        {tab === "schedule" && (
          <>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("care_group_calendar")}</Text>
              {hasSupabaseConfig() && (
                <Pressable style={styles.secondaryButtonCompact} onPress={() => void syncCalendarFromSupabase()} disabled={calendarSyncing}>
                <Text style={styles.secondaryButtonText}>{calendarSyncing ? "Refreshing..." : "Refresh care group calendar"}</Text>
                </Pressable>
              )}
              <RNCalendar
                current={selectedDate}
                markingType="multi-dot"
                markedDates={markedDates}
                onDayPress={handleDayPress}
                onMonthChange={(month) => setVisibleMonth(month.dateString.slice(0, 7))}
                theme={{
                  todayTextColor: "#1f7a59",
                  arrowColor: "#1f7a59",
                  selectedDayTextColor: "#ffffff",
                  dotColor: "#1f7a59"
                }}
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("add_calendar_event")}</Text>
              <TextInput value={eventTitle} onChangeText={setEventTitle} style={styles.input} placeholder="Title" />
              <View style={styles.rowWrap}>
                <TextInput
                  value={eventStartTime}
                  onChangeText={setEventStartTime}
                  style={[styles.input, styles.timeInput]}
                  placeholder="Start HH:MM"
                  autoCapitalize="none"
                />
                <TextInput
                  value={eventEndTime}
                  onChangeText={setEventEndTime}
                  style={[styles.input, styles.timeInput]}
                  placeholder="End HH:MM"
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.rowWrap}>
                {(["none", "weekly", "monthly"] as RecurrenceType[]).map((option) => (
                  <Pressable
                    key={option}
                    style={[styles.chip, eventRecurrence === option ? styles.chipActive : undefined]}
                    onPress={() => setEventRecurrence(option)}
                  >
                    <Text style={styles.chipText}>{option}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={styles.primaryButton} onPress={addCalendarEvent}>
                <Text style={styles.primaryButtonText}>Add event on {formatDateForDisplay(selectedDate)}</Text>
              </Pressable>
              {hasSupabaseConfig() && (
                <Text style={styles.smallText}>Care group sync currently supports one-time events. Recurrence is local-only for now.</Text>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Events on {formatDateForDisplay(selectedDate)}</Text>
              {selectedDateEvents.length === 0 && <Text style={styles.smallText}>No events for this date.</Text>}
              {selectedDateHandover && (
                <View style={styles.listItem}>
                  <Text style={styles.bodyText}>Handover day</Text>
                  <Text style={styles.smallText}>Generated from the baseline care rhythm.</Text>
                </View>
              )}
              {selectedDateEvents.map((event) => (
                <View key={event.id} style={styles.listItem}>
                  <Text style={styles.eventTitleText}>{event.title}</Text>
                  <Text style={styles.smallText}>
                    {event.startTime} - {event.endTime} · {event.recurrence}
                  </Text>
                  {(hasSupabaseConfig() ? Boolean(userId && event.createdBy === userId) : event.createdBy === currentDisplayName) ? (
                    <Pressable style={styles.secondaryButtonCompact} onPress={() => deleteCalendarEvent(event.id)}>
                      <Text style={styles.secondaryButtonText}>Delete</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.smallText}>Only the creator can delete this event.</Text>
                  )}
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Care Rhythm (Baseline)</Text>
              <Text style={styles.smallText}>A stable baseline helps children know what to expect and reduces conflict around logistics.</Text>
              <Text style={styles.smallText}>Rhythm start date: {formatDateForDisplay(careRhythmStartDate)}</Text>
              <Text style={styles.smallText}>
                Lock status: {careRhythmLocked ? "Locked (change via request only)" : "Pending required confirmations"}
              </Text>
              <Pressable
                style={[styles.secondaryButtonCompact, careRhythmLocked ? styles.disabledButton : undefined]}
                onPress={() => {
                  if (careRhythmLocked) {
                    return;
                  }
                  const nextStartDate = selectedDate;
                  setCareRhythmStartDate(nextStartDate);
                  setCareRhythmConfirmedBy([]);
                  void persistCareRhythmDraft({ rhythm: selectedCareRhythm, startDate: nextStartDate, notes: careRhythmNotes });
                }}
                disabled={careRhythmLocked}
              >
                <Text style={styles.secondaryButtonText}>Use selected calendar date as rhythm start</Text>
              </Pressable>
              <View style={styles.rowWrap}>
                {CARE_RHYTHM_TEMPLATES.map((template) => (
                  <Pressable
                    key={template.key}
                    style={[
                      styles.chip,
                      selectedCareRhythm === template.key ? styles.chipActive : undefined,
                      careRhythmLocked ? styles.disabledButton : undefined
                    ]}
                    onPress={() => handleCareRhythmChange(template.key)}
                    disabled={careRhythmLocked}
                  >
                    <Text style={styles.chipText}>{template.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.smallText}>
                {CARE_RHYTHM_TEMPLATES.find((template) => template.key === selectedCareRhythm)?.summary ?? "Choose the baseline care rhythm."}
              </Text>
              <TextInput
                value={careRhythmNotes}
                onChangeText={setCareRhythmNotes}
                onEndEditing={() => {
                  void persistCareRhythmDraft({
                    rhythm: selectedCareRhythm,
                    startDate: careRhythmStartDate,
                    notes: careRhythmNotes
                  });
                }}
                style={styles.input}
                placeholder="Optional rhythm notes (school, activities, transport, etc.)"
                editable={!careRhythmLocked}
              />
              <Pressable
                style={[styles.primaryButtonCompact, !isBaselineApprover ? styles.disabledButton : undefined]}
                onPress={() => void confirmCareRhythm()}
                disabled={!isBaselineApprover}
              >
                <Text style={styles.primaryButtonText}>Confirm baseline (required approvers)</Text>
              </Pressable>
              <Text style={styles.smallText}>Confirmed by: {careRhythmConfirmedBy.length}/{baselineRequiredCount} required approvers</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("new_change_request")}</Text>
              <Text style={styles.smallText}>Use requests only for exceptions to the baseline care rhythm.</Text>
              <View style={styles.rowWrap}>
                {(["day_swap", "coverage", "extra_time", "holiday_change"] as RequestType[]).map((typeOption) => (
                  <Pressable
                    key={typeOption}
                    style={[styles.chip, requestType === typeOption ? styles.chipActive : undefined]}
                    onPress={() => setRequestType(typeOption)}
                  >
                    <Text style={styles.chipText}>{REQUEST_TYPE_LABELS[typeOption]}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput value={requestDate ? formatDateForDisplay(requestDate) : ""} editable={false} style={styles.input} placeholder="Select requested date" />
              <Pressable style={styles.secondaryButtonCompact} onPress={() => setRequestDatePickerOpen((prev) => !prev)}>
                <Text style={styles.secondaryButtonText}>{requestDatePickerOpen ? "Close date picker" : "Select date"}</Text>
              </Pressable>
              {requestDatePickerOpen && (
                <RNCalendar
                  current={requestDate || selectedDate}
                  onDayPress={handleRequestDatePick}
                  theme={{
                    todayTextColor: "#1f7a59",
                    arrowColor: "#1f7a59",
                    selectedDayTextColor: "#ffffff"
                  }}
                />
              )}
              <TextInput
                value={requestReason}
                onChangeText={setRequestReason}
                style={styles.input}
                placeholder="Why is this change needed?"
              />
              <TextInput
                value={requestChildPlan}
                onChangeText={setRequestChildPlan}
                style={styles.input}
                placeholder="How will child routines stay stable?"
              />
              <Text style={styles.smallText}>Urgency</Text>
              <View style={styles.rowWrap}>
                {(["low", "medium", "high"] as RequestUrgency[]).map((urgency) => (
                  <Pressable
                    key={urgency}
                    style={[styles.chip, requestUrgency === urgency ? styles.chipActive : undefined]}
                    onPress={() => setRequestUrgency(urgency)}
                  >
                    <Text style={styles.chipText}>{REQUEST_URGENCY_LABELS[urgency]}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.rowWrap}>
                <Pressable
                  style={[styles.chip, requestTouchesHandover ? styles.chipActive : undefined]}
                  onPress={() => setRequestTouchesHandover((prev) => !prev)}
                >
                  <Text style={styles.chipText}>{requestTouchesHandover ? "Touches handover: yes" : "Touches handover: no"}</Text>
                </Pressable>
                <Pressable
                  style={[styles.chip, requestNeedsChildBrief ? styles.chipActive : undefined]}
                  onPress={() => setRequestNeedsChildBrief((prev) => !prev)}
                >
                  <Text style={styles.chipText}>{requestNeedsChildBrief ? "Child brief needed: yes" : "Child brief needed: no"}</Text>
                </Pressable>
              </View>
              <Text style={styles.smallText}>Request intervention state: {requestInterventionState}</Text>
              {!hasOtherMembersForRequests && (
                <Text style={styles.smallText}>Approvals become available as soon as another care group member joins.</Text>
              )}
              {requestInterventionState === "restricted" && (
                <Text style={styles.smallText}>Complete date, reason, child routine plan, and required approvers to continue.</Text>
              )}
              {requestInterventionState === "assistive" && (
                <Text style={styles.smallText}>Suggestion: include neutral approvers and ensure child routine impact is clearly addressed.</Text>
              )}
              <Text style={styles.smallText}>Required approvers</Text>
              <View style={styles.rowWrap}>
                {requestApproverCandidates.map((member) => (
                  <Pressable
                    key={`approver-${member.id}`}
                    style={[styles.chip, selectedApproverMemberIds.includes(member.id) ? styles.chipActive : undefined]}
                    onPress={() => toggleIdInList(member.id, setSelectedApproverMemberIds)}
                  >
                    <Text style={styles.chipText}>{member.label}</Text>
                  </Pressable>
                ))}
                {requestApproverCandidates.length === 0 && (
                  <Text style={styles.smallText}>No eligible approvers available yet.</Text>
                )}
              </View>
              <Pressable style={[styles.primaryButton, !hasOtherMembersForRequests ? styles.disabledButton : undefined]} onPress={submitRequest} disabled={!hasOtherMembersForRequests}>
                <Text style={styles.primaryButtonText}>{t("submit_request")}</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("requests")}</Text>
              {requests.map((request) => (
                <View key={request.id} style={styles.listItem}>
                  <Text style={styles.bodyText}>
                    {REQUEST_TYPE_LABELS[request.type]} · {formatDateForDisplay(request.date)}
                  </Text>
                  <Text style={styles.smallText}>{request.note}</Text>
                  <Text style={styles.smallText}>Status: {request.status}</Text>
                  {hasSupabaseConfig() && (
                    <Text style={styles.smallText}>
                      Requested by:{" "}
                      {request.requestedByUserId === userId
                        ? `${currentDisplayName} (You)`
                        : request.requestedByDisplayName ||
                          (request.requestedByUserId
                            ? (memberNameById.get(request.requestedByUserId) ?? requestSelectableNameById.get(request.requestedByUserId))
                            : null) ||
                          "Unknown"}
                    </Text>
                  )}
                  <Text style={styles.smallText}>
                    Approvers:{" "}
                    {request.approverMemberIds.length > 0
                      ? request.approverMemberIds
                          .map((memberId) => memberNameById.get(memberId) ?? requestSelectableNameById.get(memberId) ?? memberId)
                          .join(", ")
                      : "None selected"}
                  </Text>
                  <Text style={styles.smallText}>
                    Approved by:{" "}
                    {request.approvedByIds.length > 0
                      ? request.approvedByIds
                          .map((memberId) => memberNameById.get(memberId) ?? requestSelectableNameById.get(memberId) ?? memberId)
                          .join(", ")
                      : "No approvals yet"}
                  </Text>
                  {request.status === "pending" && (
                    request.requestedByUserId === userId ? (
                      <Text style={styles.smallText}>Waiting for selected approvers to review.</Text>
                    ) : userId && request.approverMemberIds.length > 0 && !request.approverMemberIds.includes(userId) ? (
                      <Text style={styles.smallText}>You are not a required approver for this request.</Text>
                    ) : (
                      <View style={styles.rowWrap}>
                        <Pressable style={styles.primaryButtonCompact} onPress={() => void updateRequestStatus(request.id, "approved")}>
                          <Text style={styles.primaryButtonText}>Approve</Text>
                        </Pressable>
                        <Pressable style={styles.secondaryButtonCompact} onPress={() => void updateRequestStatus(request.id, "declined")}>
                          <Text style={styles.secondaryButtonText}>Decline</Text>
                        </Pressable>
                      </View>
                    )
                  )}
                </View>
              ))}
            </View>
          </>
        )}

        {tab === "chat" && (
          <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("tab_chat")}</Text>
            <Text style={styles.smallText}>Draft-first communication helps reduce reactive escalation.</Text>
            <View style={styles.rowWrap}>
              {TOPICS.map((topic) => (
                <Pressable
                  key={topic.key}
                  style={[styles.chip, selectedTopic === topic.key ? styles.chipActive : undefined]}
                  onPress={() => setSelectedTopic(topic.key)}
                >
                  <View style={styles.chipContent}>
                    <Text style={styles.chipText}>{t(topic.labelKey)}</Text>
                    {(chatUnreadByTopic[topic.key] ?? 0) > 0 && (
                      <View style={styles.chipUnreadBadge}>
                        <Text style={styles.chipUnreadBadgeText}>
                          {(chatUnreadByTopic[topic.key] ?? 0) > 99 ? "99+" : String(chatUnreadByTopic[topic.key] ?? 0)}
                        </Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              ))}
            </View>
            <View style={styles.rowWrap}>
              <Pressable style={[styles.chip, toneCoachEnabled ? styles.chipActive : undefined]} onPress={() => setToneCoachEnabled((prev) => !prev)}>
                <Text style={styles.chipText}>{toneCoachEnabled ? "Tone coach on" : "Tone coach off"}</Text>
              </Pressable>
            </View>

            <ScrollView
              ref={chatMessagesScrollRef}
              style={styles.messageList}
              contentContainerStyle={styles.messageListContent}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => chatMessagesScrollRef.current?.scrollToEnd({ animated: true })}
            >
              {currentMessages.map((message) => {
                const isOwnMessage = userId ? message.senderUserId === userId : message.sender === currentDisplayName;
                const messageProfilePhotoUri = getProfilePhotoUriForActor({ userId: message.senderUserId, displayName: message.sender });
                const messageInitial = message.sender.trim().charAt(0).toUpperCase() || "?";
                return (
                <View key={message.id} style={styles.messageRow}>
                  <View style={styles.messageAvatarWrap}>
                    {messageProfilePhotoUri ? (
                      <Image source={{ uri: messageProfilePhotoUri }} style={styles.messageAvatarImage} />
                    ) : (
                      <Text style={styles.messageAvatarInitial}>{messageInitial}</Text>
                    )}
                  </View>
                  <View style={[styles.messageBubble, isOwnMessage ? styles.messageBubbleMine : styles.messageBubbleOther]}>
                    <Text style={styles.messageSender}>{message.sender}</Text>
                    <Text style={styles.messageBody}>{message.body}</Text>
                    <Text style={styles.smallText}>{new Date(message.createdAt).toLocaleString()}</Text>
                  </View>
                </View>
                );
              })}
              {currentMessages.length === 0 && <Text style={styles.smallText}>No messages in this thread yet.</Text>}
            </ScrollView>

            <TextInput value={chatDraft} onChangeText={setChatDraft} style={styles.input} placeholder="Write a child-focused message" />
            <View style={styles.chatComposerActions}>
              <Pressable style={[styles.secondaryButtonCompact, styles.chatActionButton]} onPress={() => void applySimplifyDraft()}>
                <Text style={[styles.secondaryButtonText, styles.chatActionText]}>Simplify</Text>
              </Pressable>
              <Pressable style={[styles.secondaryButtonCompact, styles.chatActionButton]} onPress={() => void applyNeutralRephraseDraft()}>
                <Text style={[styles.secondaryButtonText, styles.chatActionText]}>Rephrase</Text>
              </Pressable>
              <Pressable style={[styles.secondaryButtonCompact, styles.chatActionButton]} onPress={() => void applyAssistiveTranslateDraft()}>
                <Text style={[styles.secondaryButtonText, styles.chatActionText]}>Translate</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryButtonCompact, styles.chatActionButton, sendingChat ? styles.disabledButton : undefined]}
                onPress={sendTopicMessage}
                disabled={sendingChat}
              >
                <Text style={[styles.primaryButtonText, styles.chatActionText]}>{sendingChat ? "Sending..." : t("send")}</Text>
              </Pressable>
            </View>
            {toneCoachEnabled && chatDraft.trim().length > 0 && (
              <View style={styles.card}>
                <Text style={styles.smallText}>Intervention state: {draftAssistanceState}</Text>
                <Text style={styles.smallText}>Tone check: {draftToneRisk}</Text>
                {draftSuggestions.map((suggestion) => (
                  <Text key={suggestion} style={styles.smallText}>
                    - {suggestion}
                  </Text>
                ))}
              </View>
            )}
            {toneCoachEnabled && draftAssistanceState === "restricted" && (
              <Text style={styles.smallText}>Safety note: this draft may escalate conflict. Consider a neutral rewrite.</Text>
            )}
          </View>
          <View style={styles.card}>
            <View style={styles.filesSection}>
              <Text style={styles.sectionTitle}>Files</Text>
              <Text style={styles.smallText}>Upload and share files for this topic. Max size: 25 MB.</Text>
                <ScrollView
                  ref={chatFilesScrollRef}
                  horizontal
                style={styles.filesStrip}
                contentContainerStyle={styles.filesStripContent}
                showsHorizontalScrollIndicator={false}
                >
                  {currentFiles.map((file) => (
                    <Pressable key={file.id} style={styles.fileTile} onPress={() => setFilePreviewItem(file)}>
                      <Text style={styles.fileTileIcon}>{getFileIcon({ mimeType: file.mimeType, name: file.name })}</Text>
                      <Text style={styles.fileTileName} numberOfLines={2}>
                        {file.name}
                      </Text>
                      <Text style={styles.fileTileMeta}>{formatFileSize(file.sizeBytes)}</Text>
                    </Pressable>
                  ))}
                {currentFiles.length === 0 && (
                  <View style={styles.fileTileEmpty}>
                    <Text style={styles.smallText}>No files shared yet.</Text>
                  </View>
                )}
              </ScrollView>
              <Pressable style={styles.secondaryButtonCompact} onPress={openUploadModal}>
                <Text style={styles.secondaryButtonText}>Upload file</Text>
              </Pressable>
            </View>
          </View>
          </>
        )}

        {tab === "handover" && (
          <>
            <View style={styles.card}>
              <View style={styles.packingHeaderRow}>
                <Text style={styles.sectionTitle}>Packing List</Text>
                <Text style={styles.packingMeta}>
                  {packedCount}/{packingTotal} ready
                </Text>
              </View>
              <Text style={styles.smallText}>
                Shared handover checklist. {packingRemaining === 0 ? "Everything is ready." : `${packingRemaining} item${packingRemaining === 1 ? "" : "s"} left.`}
              </Text>
              <View style={styles.packingProgressTrack}>
                <View style={[styles.packingProgressFill, { width: `${Math.round(packingProgress * 100)}%` }]} />
              </View>
              {packingList.map((item) => (
                <Pressable key={item.id} style={[styles.packingRow, item.packed ? styles.packingRowPacked : undefined]} onPress={() => togglePackingItem(item.id)}>
                  <View style={[styles.packingCheck, item.packed ? styles.packingCheckPacked : undefined]}>
                    <Text style={styles.packingCheckText}>{item.packed ? "X" : ""}</Text>
                  </View>
                  <Text style={[styles.packingItemLabel, item.packed ? styles.packingItemLabelPacked : undefined]}>{item.label}</Text>
                  <Text style={[styles.packingStatus, item.packed ? styles.packingStatusPacked : undefined]}>{item.packed ? "Ready" : "Pending"}</Text>
                </Pressable>
              ))}
              <View style={styles.packingInputRow}>
                <TextInput value={packingInput} onChangeText={setPackingInput} style={[styles.input, styles.packingInput]} placeholder="Add item" />
                <Pressable style={styles.secondaryButtonCompact} onPress={addPackingItem}>
                  <Text style={styles.secondaryButtonText}>Add</Text>
                </Pressable>
              </View>
              <View style={styles.packingPresetBlock}>
                <Text style={styles.smallText}>Preset groups for faster handovers</Text>
                <Text style={styles.smallText}>Build your list once, name it, and reuse it later.</Text>
                <View style={styles.packingInputRow}>
                  <TextInput
                    value={packingPresetNameInput}
                    onChangeText={setPackingPresetNameInput}
                    style={[styles.input, styles.packingInput]}
                    placeholder="Preset group name"
                  />
                  <Pressable style={styles.secondaryButtonCompact} onPress={savePackingPreset}>
                    <Text style={styles.secondaryButtonText}>Save</Text>
                  </Pressable>
                </View>
                {packingPresets.map((preset) => (
                  <View key={preset.id} style={styles.packingPresetCard}>
                    <Text style={styles.bodyText}>{preset.name}</Text>
                    <Text style={styles.smallText}>{preset.items.join(" · ")}</Text>
                    <View style={styles.rowWrap}>
                      <Pressable style={styles.secondaryButtonCompact} onPress={() => applyPackingPreset(preset)}>
                        <Text style={styles.secondaryButtonText}>Use preset</Text>
                      </Pressable>
                      <Pressable style={styles.secondaryButtonCompact} onPress={() => deletePackingPreset(preset.id)}>
                        <Text style={styles.secondaryButtonText}>Delete</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Check-in Logs</Text>
              <TextInput value={checkInNote} onChangeText={setCheckInNote} style={styles.input} placeholder="Optional note" />
              <Pressable style={styles.primaryButton} onPress={addCheckIn}>
                <Text style={styles.primaryButtonText}>Add check-in</Text>
              </Pressable>
              {checkInLogs.map((log) => (
                <View key={log.id} style={styles.listItem}>
                  <Text style={styles.bodyText}>{new Date(log.timestamp).toLocaleString()}</Text>
                  <Text style={styles.smallText}>{log.note}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {tab === "more" && (
          <>
            <View style={styles.card}>
              <Text style={styles.settingsUsername}>{accountUsername || currentDisplayName}</Text>
              <Pressable style={styles.profilePhotoButton} onPress={openProfileUploadModal}>
                {currentProfilePhotoUri ? (
                  <Image source={{ uri: currentProfilePhotoUri }} style={styles.profilePhotoImage} />
                ) : (
                  <View style={styles.profilePhotoPlaceholder}>
                    <Text style={styles.profilePhotoPlaceholderText}>Add profile photo</Text>
                  </View>
                )}
              </Pressable>
              <Text style={styles.smallText}>Tap photo area to upload from files, camera, or photos (max 25 MB).</Text>
              <Pressable style={styles.secondaryButtonCompact} onPress={() => void handleSignOut()}>
                <Text style={styles.secondaryButtonText}>{t("sign_out")}</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButtonCompact}
                onPress={() => {
                  startTour();
                  setStatus("Tour started. Tap anywhere to move through steps.");
                }}
              >
                <Text style={styles.secondaryButtonText}>Take a Tour!</Text>
              </Pressable>
              {hasSupabaseConfig() && (
                <>
                  <Pressable
                    style={styles.secondaryButtonCompact}
                    onPress={() => {
                      setFamilyId(null);
                      setFamilyName("");
                      setFamilyJoinCode(null);
                      setIsCareGroupCreator(false);
                      setJoinAccessInput("");
                      setLatestRoleInvite(null);
                      setFamilySetupMode("join");
                    }}
                  >
                    <Text style={styles.secondaryButtonText}>Switch care group</Text>
                  </Pressable>
                </>
              )}
              <Text style={styles.smallText}>Active role</Text>
              <Text style={styles.bodyText}>{APP_ROLES.find((option) => option.key === role)?.label ?? role}</Text>
              <Text style={styles.smallText}>Role is locked. Request role updates through care-group governance.</Text>
              {hasSupabaseConfig() && familyId && (
                <>

                  {isCareGroupCreator ? (
                    <>
                      <Text style={styles.smallText}>Share invite code and group password separately.</Text>
                      <Pressable style={styles.secondaryButtonCompact} onPress={() => setInviteGeneratorVisible(true)}>
                        <Text style={styles.secondaryButtonText}>Generate invite code</Text>
                      </Pressable>
                      {latestRoleInvite && (
                        <View style={styles.invitePreviewCard}>
                          <Text style={styles.bodyText}>Latest invite ({latestRoleInviteLabel ?? "-"})</Text>
                          <Text selectable style={styles.smallText}>{latestRoleInvite.code}</Text>
                          <Pressable style={styles.secondaryButtonCompact} onPress={() => void copyInviteCode(latestRoleInvite.code)}>
                            <Text style={styles.secondaryButtonText}>Copy code</Text>
                          </Pressable>
                        </View>
                      )}
                      <Text style={styles.smallText}>Codes are one-time only. Generate a fresh code for each new member.</Text>
                    </>
                  ) : (
                    <Text style={styles.smallText}>Invite code generation is available only to the care group creator.</Text>
                  )}
                </>
              )}
              <Text style={styles.smallText}>Language accessibility</Text>
              <View style={styles.rowWrap}>
                {(Object.keys(LANGUAGE_LABELS) as LanguageCode[]).map((code) => (
                  <Pressable key={code} style={[styles.chip, languagePreference === code ? styles.chipActive : undefined]} onPress={() => setLanguagePreference(code)}>
                    <Text style={styles.chipText}>{LANGUAGE_LABELS[code]}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.smallText}>Requests use required approvers and cannot be self-approved.</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Care Group Snapshot</Text>
              {hasSupabaseConfig() && (
                <Text style={styles.bodyText}>Care group members connected: {familyMembers.length}</Text>
              )}
              <Text style={styles.bodyText}>
                Baseline rhythm: {CARE_RHYTHM_TEMPLATES.find((template) => template.key === selectedCareRhythm)?.label ?? "Custom"}
              </Text>
              <Text style={styles.bodyText}>Pending requests: {pendingRequestCount}</Text>
              <Text style={styles.bodyText}>Selected date: {formatDateForDisplay(selectedDate)}</Text>
              <Text style={styles.bodyText}>Events on selected date: {selectedDateEvents.length}</Text>
              <Text style={styles.bodyText}>Care team members: {participants.length}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("safety_consent_governance")}</Text>
              <Text style={styles.smallText}>Assistive AI backend: local prototype adapter (API-ready integration path).</Text>
              <Text style={styles.smallText}>AI disclosure and support boundaries</Text>
              <Pressable style={[styles.chip, aiDisclosureAccepted ? styles.chipActive : undefined]} onPress={() => setAiDisclosureAccepted((prev) => !prev)}>
                <Text style={styles.chipText}>{aiDisclosureAccepted ? "AI disclosure acknowledged" : "Disclosure (Placeholder)"}</Text>
              </Pressable>
              <Text style={styles.smallText}>Audit scope</Text>
              <View style={styles.rowWrap}>
                {(["minimal", "standard"] as AuditScope[]).map((scope) => (
                  <Pressable key={scope} style={[styles.chip, auditScope === scope ? styles.chipActive : undefined]} onPress={() => setAuditScope(scope)}>
                    <Text style={styles.chipText}>{scope}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={[styles.chip, highConflictGuard ? styles.chipActive : undefined]} onPress={() => setHighConflictGuard((prev) => !prev)}>
                <Text style={styles.chipText}>{highConflictGuard ? "High-conflict guard on" : "High-conflict guard off"}</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("third_party_access")}</Text>
              <Text style={styles.smallText}>Consent from all primary caregivers is required before third-party access is active.</Text>
              <Text style={styles.smallText}>
                {isMainCaregiver ? "You can record your consent below." : "Only primary caregivers can record consent."}
              </Text>
              <View style={styles.rowWrap}>
                {mainCaregiverIds.map((memberId) => (
                  <Pressable
                    key={memberId}
                    style={[
                      styles.chip,
                      thirdPartyConsentByCaregiver[memberId] ? styles.chipActive : undefined,
                      !isMainCaregiver || currentActorId !== memberId ? styles.disabledButton : undefined
                    ]}
                    onPress={() => toggleThirdPartyConsentFor(memberId)}
                    disabled={!isMainCaregiver || currentActorId !== memberId}
                  >
                    <Text style={styles.chipText}>
                      {(mainCaregiverNameById.get(memberId) ?? "Primary caregiver") +
                        (thirdPartyConsentByCaregiver[memberId] ? ": consented" : ": pending")}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {mainCaregiverIds.length === 0 && (
                <Text style={styles.smallText}>Add at least one primary caregiver to activate this workflow.</Text>
              )}
              <Text style={styles.smallText}>Consent status: {dualConsentGranted ? "active" : "inactive"}</Text>
              {professionalAccessRules.map((rule) => (
                <View key={rule.role} style={styles.listItem}>
                  <Text style={styles.bodyText}>{rule.role.replace("_", " ")}</Text>
                  <Text style={styles.smallText}>Purpose: {rule.purpose}</Text>
                  <Text style={styles.smallText}>Legal basis: {rule.legalBasis}</Text>
                  <Text style={styles.smallText}>Scope is managed by policy defaults in this prototype build.</Text>
                </View>
              ))}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("care_team")}</Text>
              {(hasSupabaseConfig()
                ? familyMembers.map((member) => ({
                    id: member.userId,
                    name: member.displayName?.trim() || member.role.replace("_", " "),
                    role: member.role,
                    permissions: [] as string[]
                  }))
                : participants
              ).map((participant) => (
                <View key={participant.id} style={styles.listItem}>
                  <Text style={styles.bodyText}>
                    {participant.name} ({participant.role.replace("_", " ")})
                  </Text>
                  {participant.permissions.length > 0 && (
                    <Text style={styles.smallText}>Permissions: {participant.permissions.join(", ")}</Text>
                  )}
                </View>
              ))}
              <Text style={styles.smallText}>Participant invitation is disabled in this prototype build.</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>{t("records")}</Text>
              <Text style={styles.bodyText}>{t("records_timeline")}</Text>
              <Text style={styles.bodyText}>{t("records_export")}</Text>
              <Text style={styles.smallText}>{t("records_focus")}</Text>
            </View>
          </>
        )}
        </ScrollView>

        <View
          ref={(node) => registerTourTargetRef("tab-bar", node)}
          collapsable={false}
          onLayout={() => handleTourTargetLayout("tab-bar")}
          style={styles.tabBar}
        >
          {TABS.map((item) => (
            <View
              key={item.key}
              ref={(node) => registerTourTargetRef(TOUR_TARGET_BY_TAB[item.key], node)}
              collapsable={false}
              onLayout={() => handleTourTargetLayout(TOUR_TARGET_BY_TAB[item.key])}
              style={styles.tabButtonWrap}
            >
              <Pressable
                style={[styles.tabButton, tab === item.key ? styles.tabButtonActive : undefined]}
                onPress={() => handleTourTargetPress(TOUR_TARGET_BY_TAB[item.key], () => setTab(item.key))}
                hitSlop={24}
                pressRetentionOffset={24}
                accessibilityRole="button"
                accessibilityLabel={`${t(item.labelKey)} tab`}
                accessibilityHint="Opens this section."
              >
                <View style={styles.tabIconWrap}>
                  <Text style={styles.tabIcon}>{item.icon}</Text>
                  {item.key === "chat" && chatUnreadCount > 0 && (
                    <View style={styles.tabBadge}>
                      <Text style={styles.tabBadgeText}>{chatUnreadCount > 99 ? "99+" : String(chatUnreadCount)}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.tabButtonText} numberOfLines={1} adjustsFontSizeToFit>
                  {t(item.labelKey)}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>

        {tourActive && currentTourStep && (
          <View style={styles.tourOverlay} pointerEvents="auto">
            <Pressable
              style={styles.tourTapSurface}
              onPress={handleTourOverlayPress}
              accessibilityRole="button"
              accessibilityLabel="Continue tour"
              accessibilityHint="Tap anywhere to continue to the next step."
            />
            {tourHole && (
              <>
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.tourPulseRing,
                    {
                      top: tourHole.y,
                      left: tourHole.x,
                      width: tourHole.width,
                      height: tourHole.height,
                      opacity: tourPulse.interpolate({ inputRange: [0, 1], outputRange: [0.95, 0.26] }),
                      transform: [{ scale: tourPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] }) }]
                    }
                  ]}
                />
                <Text
                  pointerEvents="none"
                  style={[
                    styles.tourPointerEmoji,
                    {
                      top: tourHole.y > screenSize.height * 0.55 ? Math.max(tourHole.y - 34, 12) : Math.min(tourHole.y + tourHole.height + 4, screenSize.height - 44),
                      left: Math.max(10, Math.min(tourHole.x + tourHole.width / 2 - 14, screenSize.width - 38))
                    }
                  ]}
                >
                  {tourHole.y > screenSize.height * 0.55 ? "👇" : "👆"}
                </Text>
              </>
            )}
            <View style={[styles.tourCard, tourCardPositionStyle]}>
              <Text style={styles.tourMetaText}>Tour step {tourProgressLabel}</Text>
              <Text style={styles.tourTitleText}>{currentTourStep.title}</Text>
              <Text style={styles.tourBodyText}>{currentTourStep.body}</Text>
              <Text style={styles.tourActionText}>Tap anywhere on the screen to continue.</Text>
              <View style={styles.tourControlsRow}>
                <Pressable
                  style={[styles.secondaryButtonCompact, tourStepIndex === 0 ? styles.disabledButton : undefined]}
                  onPress={backTourStep}
                  disabled={tourStepIndex === 0}
                  accessibilityRole="button"
                  accessibilityLabel="Previous tour step"
                >
                  <Text style={styles.secondaryButtonText}>Back</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButtonCompact}
                  onPress={() => {
                    skipTour();
                    setTourSpotlightRect(null);
                    setStatus("Tour skipped. You can restart it any time from Settings.");
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Skip tour"
                >
                  <Text style={styles.secondaryButtonText}>Skip</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        {status ? (
          <View style={styles.statusToastWrap} pointerEvents="none">
            <Text style={[styles.statusToastText, isEmailConfirmationNotice ? styles.statusToastTextEmphasis : undefined]}>{status}</Text>
          </View>
        ) : null}
        <Modal visible={inviteGeneratorVisible} transparent animationType="fade" onRequestClose={() => setInviteGeneratorVisible(false)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.sectionTitle}>Select Member Type</Text>
              <Text style={styles.smallText}>Choose who you want to invite. A one-time code will be generated and copied automatically.</Text>
              <View style={styles.rowWrap}>
                {APP_ROLES.map((option) => (
                  <Pressable
                    key={`invite-generator-${option.key}`}
                    style={[styles.secondaryButtonCompact, inviteGeneratorBusyRole ? styles.disabledButton : undefined]}
                    onPress={() => void handleCreateRoleInvite(option.key)}
                    disabled={Boolean(inviteGeneratorBusyRole)}
                  >
                    <Text style={styles.secondaryButtonText}>
                      {inviteGeneratorBusyRole === option.key ? "Generating..." : option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Pressable style={styles.secondaryButtonCompact} onPress={() => setInviteGeneratorVisible(false)} disabled={Boolean(inviteGeneratorBusyRole)}>
                <Text style={styles.secondaryButtonText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
        <Modal visible={Boolean(filePreviewItem)} transparent animationType="fade" onRequestClose={() => setFilePreviewItem(null)}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.sectionTitle}>File Preview</Text>
              <Text style={styles.bodyText}>{filePreviewItem?.name}</Text>
              <Text style={styles.smallText}>
                {filePreviewItem ? `${formatFileSize(filePreviewItem.sizeBytes)} · ${filePreviewItem.mimeType}` : ""}
              </Text>
              {filePreviewItem && canPreviewInline(filePreviewItem) ? (
                <Image source={{ uri: filePreviewItem.uri }} style={styles.filePreviewImage} resizeMode="contain" />
              ) : filePreviewItem && canPreviewInlineVideo(filePreviewItem) ? (
                <Video
                  source={{ uri: filePreviewItem.uri }}
                  style={styles.filePreviewVideo}
                  useNativeControls
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={false}
                  isLooping={false}
                />
              ) : (
                <View style={styles.filePreviewFallback}>
                  <Text style={styles.fileTileIcon}>
                    {filePreviewItem ? getFileIcon({ mimeType: filePreviewItem.mimeType, name: filePreviewItem.name }) : "📁"}
                  </Text>
                  <Text style={styles.smallText}>In-app preview is limited for this file type.</Text>
                </View>
              )}
              <View style={styles.rowWrap}>
                <Pressable style={styles.secondaryButtonCompact} onPress={() => setFilePreviewItem(null)}>
                  <Text style={styles.secondaryButtonText}>Close</Text>
                </Pressable>
                <Pressable
                  style={styles.primaryButtonCompact}
                  onPress={() => {
                    if (filePreviewItem) {
                      askToDownloadFile(filePreviewItem);
                    }
                  }}
                >
                  <Text style={styles.primaryButtonText}>Download</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <Modal visible={uploadModalVisible} transparent animationType="fade" onRequestClose={closeUploadModal}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.sectionTitle}>Upload File</Text>
              <Text style={styles.smallText}>Choose source, then set a display name before adding.</Text>
              <View style={styles.rowWrap}>
                <Pressable style={styles.secondaryButtonCompact} onPress={() => void stageUploadFromFiles()} disabled={uploadInProgress}>
                  <Text style={styles.secondaryButtonText}>From Files</Text>
                </Pressable>
                <Pressable style={styles.secondaryButtonCompact} onPress={() => void stageUploadFromCamera()} disabled={uploadInProgress}>
                  <Text style={styles.secondaryButtonText}>Camera</Text>
                </Pressable>
                <Pressable style={styles.secondaryButtonCompact} onPress={() => void stageUploadFromLibrary()} disabled={uploadInProgress}>
                  <Text style={styles.secondaryButtonText}>Photos</Text>
                </Pressable>
              </View>
              {pendingUpload ? (
                <>
                  <Text style={styles.smallText}>
                    Selected: {pendingUpload.originalName || "(Unnamed file)"} · {formatFileSize(pendingUpload.sizeBytes)}
                  </Text>
                  <TextInput value={uploadDisplayName} onChangeText={setUploadDisplayName} style={styles.input} placeholder="File display name" />
                  <Text style={styles.smallText}>Allowed max upload size is 25 MB.</Text>
                </>
              ) : (
                <Text style={styles.smallText}>No file selected yet.</Text>
              )}
              <View style={styles.rowWrap}>
                <Pressable style={styles.secondaryButtonCompact} onPress={closeUploadModal}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryButtonCompact, !pendingUpload ? styles.disabledButton : undefined]}
                  onPress={confirmPendingUpload}
                  disabled={!pendingUpload}
                >
                  <Text style={styles.primaryButtonText}>Add to topic</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <Modal visible={profileUploadModalVisible} transparent animationType="fade" onRequestClose={closeProfileUploadModal}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.sectionTitle}>Upload Profile Picture</Text>
              <Text style={styles.smallText}>Choose a source. Supported image formats include JPG, PNG, HEIC, WEBP, GIF, BMP and TIFF.</Text>
              <View style={styles.rowWrap}>
                <Pressable style={styles.secondaryButtonCompact} onPress={() => void stageProfileUploadFromFiles()} disabled={profileUploadInProgress}>
                  <Text style={styles.secondaryButtonText}>From Files</Text>
                </Pressable>
                <Pressable style={styles.secondaryButtonCompact} onPress={() => void stageProfileUploadFromCamera()} disabled={profileUploadInProgress}>
                  <Text style={styles.secondaryButtonText}>Camera</Text>
                </Pressable>
                <Pressable style={styles.secondaryButtonCompact} onPress={() => void stageProfileUploadFromLibrary()} disabled={profileUploadInProgress}>
                  <Text style={styles.secondaryButtonText}>Photos</Text>
                </Pressable>
              </View>
              {pendingProfileUpload ? (
                <Text style={styles.smallText}>
                  Selected: {pendingProfileUpload.originalName || "(Unnamed file)"} · {formatFileSize(pendingProfileUpload.sizeBytes)}
                </Text>
              ) : (
                <Text style={styles.smallText}>No profile picture selected yet.</Text>
              )}
              <Text style={styles.smallText}>Allowed max upload size is 25 MB.</Text>
              <View style={styles.rowWrap}>
                <Pressable style={styles.secondaryButtonCompact} onPress={closeProfileUploadModal}>
                  <Text style={styles.secondaryButtonText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryButtonCompact, !pendingProfileUpload ? styles.disabledButton : undefined]}
                  onPress={() => void confirmProfileUpload()}
                  disabled={!pendingProfileUpload}
                >
                  <Text style={styles.primaryButtonText}>Use profile picture</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
        <Modal visible={Boolean(activeArticle)} transparent animationType="fade" onRequestClose={closeGuidanceArticle}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <Text style={styles.sectionTitle}>{activeArticle?.title}</Text>
              <Text style={styles.smallText}>
                Estimated reading time: {formatDurationCompact(Math.ceil(activeArticleReadMs / 1000))}
              </Text>
              <ScrollView style={styles.modalBody}>
                {activeArticle?.content.map((paragraph) => (
                  <Text key={paragraph} style={styles.modalArticleParagraph}>
                    {paragraph}
                  </Text>
                ))}
              </ScrollView>
              <Text style={styles.smallText}>
                {canConfirmArticleRead ? "Reading time completed." : `Read timer: ${formatDurationCompact(activeArticleRemainingSeconds)} remaining`}
              </Text>
              <View style={styles.rowWrap}>
                <Pressable style={styles.secondaryButtonCompact} onPress={closeGuidanceArticle}>
                  <Text style={styles.secondaryButtonText}>Close</Text>
                </Pressable>
                <Pressable
                  style={[styles.primaryButtonCompact, !canConfirmArticleRead ? styles.disabledButton : undefined]}
                  onPress={confirmGuidanceRead}
                  disabled={!canConfirmArticleRead}
                >
                  <Text style={styles.primaryButtonText}>Read</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#f0f6f3"
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  handoverBadge: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 128,
    alignItems: "center"
  },
  handoverBadgeDefault: {
    borderColor: "#b8ccbf",
    backgroundColor: "#edf5f1"
  },
  handoverBadgeSoon: {
    borderWidth: 2,
    borderColor: "#d08a17",
    backgroundColor: "#fff3db"
  },
  handoverBadgeToday: {
    borderWidth: 2,
    borderColor: "#b22424",
    backgroundColor: "#ffe5e5"
  },
  handoverBadgeText: {
    fontSize: 13
  },
  handoverBadgeTextDefault: {
    color: "#2a5442",
    fontWeight: "700"
  },
  handoverBadgeTextSoon: {
    color: "#6f4300",
    fontWeight: "800"
  },
  handoverBadgeTextToday: {
    color: "#7a1313",
    fontWeight: "900"
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 178,
    gap: 10
  },
  authScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    flexGrow: 1
  },
  card: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d4e2db",
    borderRadius: 14,
    padding: 12,
    gap: 9
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1f332b",
    flexShrink: 1
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1e3a30",
    flexShrink: 1
  },
  bodyText: {
    fontSize: 14,
    color: "#2c463b",
    flexShrink: 1,
    lineHeight: 20
  },
  eventTitleText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#2c463b",
    fontWeight: "700",
    flexShrink: 1
  },
  smallText: {
    fontSize: 12,
    color: "#5a756a",
    flexShrink: 1,
    lineHeight: 17
  },
  settingsUsername: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1f332b"
  },
  profilePhotoButton: {
    alignSelf: "flex-start"
  },
  profilePhotoImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderColor: "#b8ccbf"
  },
  profilePhotoPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#9db4a8",
    backgroundColor: "#eef5f1",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8
  },
  profilePhotoPlaceholderText: {
    fontSize: 11,
    lineHeight: 13,
    color: "#3f5a4f",
    textAlign: "center",
    fontWeight: "600"
  },
  statusText: {
    color: "#486255",
    fontSize: 12,
    paddingHorizontal: 16,
    paddingBottom: 8
  },
  statusTextEmphasis: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "700",
    color: "#8a220e",
    backgroundColor: "#ffe9e3",
    borderWidth: 1,
    borderColor: "#f6b2a3",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  hint: {
    color: "#3f5a4f",
    fontSize: 13
  },
  linkText: {
    color: "#216f52",
    fontWeight: "600"
  },
  input: {
    borderWidth: 1,
    borderColor: "#bfd2c8",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: "#fbfdfc"
  },
  timeInput: {
    minWidth: 130
  },
  primaryButton: {
    backgroundColor: "#1f7a59",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center"
  },
  secondaryButton: {
    backgroundColor: "#e5eee9",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center"
  },
  primaryButtonCompact: {
    backgroundColor: "#1f7a59",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center"
  },
  secondaryButtonCompact: {
    backgroundColor: "#e5eee9",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center"
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700"
  },
  secondaryButtonText: {
    color: "#214739",
    fontWeight: "600"
  },
  disabledButton: {
    opacity: 0.45
  },
  rowWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  familySituationGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  familySituationInputWrap: {
    minWidth: 150,
    flexGrow: 1,
    gap: 4
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#b8ccbf",
    backgroundColor: "#eef5f1",
    paddingHorizontal: 10,
    paddingVertical: 7
  },
  chipContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6
  },
  chipActive: {
    borderColor: "#6fb291",
    backgroundColor: "#d5ecdf"
  },
  chipText: {
    fontSize: 12,
    color: "#204235",
    fontWeight: "600",
    textTransform: "capitalize",
    flexShrink: 1
  },
  chipUnreadBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    backgroundColor: "#c53434",
    alignItems: "center",
    justifyContent: "center"
  },
  chipUnreadBadgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700"
  },
  listItem: {
    borderTopWidth: 1,
    borderTopColor: "#e4ece7",
    paddingTop: 7,
    gap: 2
  },
  invitePreviewCard: {
    borderWidth: 1,
    borderColor: "#d8e7df",
    backgroundColor: "#f5faf7",
    borderRadius: 10,
    padding: 10,
    gap: 4
  },
  guidanceItem: {
    borderWidth: 1,
    borderColor: "#dbe7e1",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#fbfdfc",
    gap: 4
  },
  guidanceHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  guidanceUnreadBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
    backgroundColor: "#c53434",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999
  },
  guidanceReadBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: "#ffffff",
    backgroundColor: "#2f8a5c",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999
  },
  scoreCard: {
    borderWidth: 1,
    borderColor: "#cde2d6",
    borderRadius: 10,
    padding: 10,
    backgroundColor: "#eef7f1",
    gap: 4
  },
  messageList: {
    maxHeight: 320,
    minHeight: 180
  },
  messageListContent: {
    gap: 8,
    paddingBottom: 6
  },
  filesSection: {
    marginTop: 2,
    gap: 8
  },
  filesStrip: {
    maxHeight: 126
  },
  filesStripContent: {
    gap: 10,
    paddingVertical: 2
  },
  fileTile: {
    width: 102,
    borderWidth: 1,
    borderColor: "#d5e3dc",
    backgroundColor: "#fbfdfc",
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 3
  },
  fileTileEmpty: {
    minWidth: 180,
    borderWidth: 1,
    borderColor: "#d5e3dc",
    backgroundColor: "#fbfdfc",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
    justifyContent: "center"
  },
  fileTileIcon: {
    fontSize: 30
  },
  fileTileName: {
    fontSize: 12,
    color: "#1f352c",
    textAlign: "center",
    width: "100%"
  },
  fileTileMeta: {
    fontSize: 11,
    color: "#5f7c70"
  },
  filePreviewImage: {
    width: "100%",
    height: 260,
    borderRadius: 10,
    backgroundColor: "#eef5f1"
  },
  filePreviewVideo: {
    width: "100%",
    height: 260,
    borderRadius: 10,
    backgroundColor: "#0f1714"
  },
  filePreviewFallback: {
    width: "100%",
    minHeight: 180,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d5e3dc",
    backgroundColor: "#fbfdfc",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 12
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8
  },
  messageAvatarWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#b9cdc1",
    backgroundColor: "#eaf3ee",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden"
  },
  messageAvatarImage: {
    width: "100%",
    height: "100%"
  },
  messageAvatarInitial: {
    fontSize: 12,
    color: "#365849",
    fontWeight: "700"
  },
  messageBubble: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#d5e3dc",
    borderRadius: 8,
    padding: 8,
    gap: 3
  },
  messageBubbleMine: {
    backgroundColor: "#dff3e8"
  },
  messageBubbleOther: {
    backgroundColor: "#fbfdfc"
  },
  messageSender: {
    fontSize: 11,
    color: "#5f7c70",
    fontWeight: "600"
  },
  messageBody: {
    fontSize: 14,
    color: "#1f352c"
  },
  packingHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8
  },
  packingMeta: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2e6a50",
    backgroundColor: "#e3f2ea",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  packingProgressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#e5eee9",
    overflow: "hidden"
  },
  packingProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#1f7a59"
  },
  packingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 42,
    borderWidth: 1,
    borderColor: "#d7e5dd",
    borderRadius: 10,
    paddingHorizontal: 10,
    backgroundColor: "#fbfdfc"
  },
  packingRowPacked: {
    backgroundColor: "#eef7f2",
    borderColor: "#cfe2d8"
  },
  packingCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#8ba99a",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff"
  },
  packingCheckPacked: {
    borderColor: "#1f7a59",
    backgroundColor: "#1f7a59"
  },
  packingCheckText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 14
  },
  packingItemLabel: {
    flex: 1,
    fontSize: 14,
    color: "#2c463b",
    lineHeight: 20
  },
  packingItemLabelPacked: {
    color: "#5a756a",
    textDecorationLine: "line-through"
  },
  packingStatus: {
    fontSize: 11,
    fontWeight: "700",
    color: "#6a7f74",
    textTransform: "uppercase"
  },
  packingStatusPacked: {
    color: "#2e6a50"
  },
  packingInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  packingPresetBlock: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#e4ece7",
    paddingTop: 10,
    gap: 8
  },
  packingPresetCard: {
    borderWidth: 1,
    borderColor: "#d8e7df",
    backgroundColor: "#f8fcfa",
    borderRadius: 10,
    padding: 10,
    gap: 6
  },
  chatComposerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8
  },
  chatActionButton: {
    flex: 1
  },
  chatActionText: {
    textAlign: "center",
    fontSize: 12
  },
  packingInput: {
    flex: 1
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 30
  },
  checkbox: {
    width: 28,
    color: "#1e5a43",
    fontWeight: "700"
  },
  tabBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#d3dfd8",
    flexDirection: "row",
    paddingTop: 8,
    paddingBottom: 20
  },
  tabButtonWrap: {
    flex: 1
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    minHeight: 102,
    gap: 2
  },
  tabButtonActive: {
    backgroundColor: "#e8f3ed"
  },
  tabIconWrap: {
    minHeight: 34,
    minWidth: 34,
    alignItems: "center",
    justifyContent: "center"
  },
  tabIcon: {
    fontSize: 28,
    color: "#294b3d",
    fontWeight: "700"
  },
  tabButtonText: {
    fontSize: 13,
    color: "#294b3d",
    fontWeight: "600"
  },
  tabBadge: {
    position: "absolute",
    top: -4,
    right: -12,
    backgroundColor: "#cd2c2c",
    borderRadius: 12,
    paddingHorizontal: 6,
    minHeight: 18,
    alignItems: "center",
    justifyContent: "center"
  },
  tabBadgeText: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700"
  },
  statusToastWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 152,
    alignItems: "center"
  },
  statusToastText: {
    backgroundColor: "#4b525c",
    color: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    fontSize: 12,
    fontWeight: "600"
  },
  statusToastTextEmphasis: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    backgroundColor: "#555c66",
    borderWidth: 1,
    borderColor: "#6d7480"
  },
  tourOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30
  },
  tourTapSurface: {
    ...StyleSheet.absoluteFillObject
  },
  tourPulseRing: {
    position: "absolute",
    borderWidth: 3,
    borderColor: "#145741",
    borderRadius: 24
  },
  tourPointerEmoji: {
    position: "absolute",
    fontSize: 26,
    textShadowColor: "rgba(0, 0, 0, 0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3
  },
  tourMetaText: {
    fontSize: 12,
    color: "#ecfff6",
    fontWeight: "700"
  },
  tourTitleText: {
    fontSize: 18,
    color: "#ffffff",
    fontWeight: "800"
  },
  tourBodyText: {
    fontSize: 14,
    lineHeight: 21,
    color: "#e8fff4"
  },
  tourActionText: {
    fontSize: 13,
    color: "#f5fff9",
    fontWeight: "700"
  },
  tourControlsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  tourCard: {
    position: "absolute",
    left: 16,
    right: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#0f6248",
    backgroundColor: "#17815f",
    padding: 12,
    gap: 8
  },
  tourCardTop: {
    top: 52
  },
  tourCardBottom: {
    bottom: 146
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(20, 31, 26, 0.5)",
    justifyContent: "center",
    padding: 16
  },
  modalCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#d4e2db",
    padding: 14,
    maxHeight: "85%",
    gap: 10
  },
  modalBody: {
    maxHeight: 340
  },
  modalArticleParagraph: {
    fontSize: 14,
    lineHeight: 22,
    color: "#1f352c",
    marginBottom: 10
  }
});
