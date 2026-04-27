export type AssistanceState = "informational" | "assistive" | "restricted";
export type LanguageCode = "en" | "de" | "tr" | "ar";

export interface DraftAssessmentInput {
  text: string;
  language: LanguageCode;
  safetyGuardEnabled: boolean;
  aiDisclosureAccepted: boolean;
}

export interface DraftAssessment {
  state: AssistanceState;
  toneRisk: "low" | "medium" | "high";
  reasons: string[];
  suggestions: string[];
  provider: "local" | "api";
}

export interface AssistiveAiAdapter {
  assessDraft(input: DraftAssessmentInput): Promise<DraftAssessment>;
  simplify(text: string): Promise<string>;
  rephraseNeutral(text: string): Promise<string>;
  translateAssistive(text: string, language: LanguageCode): Promise<string>;
}

const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  en: "English",
  de: "Deutsch",
  tr: "Turkce",
  ar: "Arabic"
};

function localAssessDraft(input: DraftAssessmentInput): DraftAssessment {
  const lower = input.text.toLowerCase();
  const highRiskTerms = ["always", "never", "your fault", "useless", "idiot", "stupid", "threat", "lawyer"];
  const mediumRiskTerms = ["you should", "you must", "again", "late", "angry"];

  const highHits = highRiskTerms.filter((term) => lower.includes(term)).length;
  const mediumHits = mediumRiskTerms.filter((term) => lower.includes(term)).length;

  if (highHits > 0) {
    const reasons = ["Potentially escalating wording detected."];
    const suggestions = ["Describe only the concrete event and time.", "Replace accusations with a request and next step."];

    if (input.safetyGuardEnabled && !input.aiDisclosureAccepted) {
      return {
        state: "restricted",
        toneRisk: "high",
        reasons: [...reasons, "Safety guard requires AI disclosure acknowledgement for high-risk drafts."],
        suggestions,
        provider: "local"
      };
    }

    return {
      state: "assistive",
      toneRisk: "high",
      reasons,
      suggestions,
      provider: "local"
    };
  }

  if (mediumHits > 1) {
    return {
      state: "assistive",
      toneRisk: "medium",
      reasons: ["Moderately reactive wording detected."],
      suggestions: ["Use neutral verbs and remove repeated blame wording."],
      provider: "local"
    };
  }

  return {
    state: "informational",
    toneRisk: "low",
    reasons: ["No strong escalation markers detected."],
    suggestions: [],
    provider: "local"
  };
}

function localSimplify(text: string): string {
  return text
    .replace(/\btherefore\b/gi, "so")
    .replace(/\bhowever\b/gi, "but")
    .replace(/\bapproximately\b/gi, "about")
    .replace(/\bregarding\b/gi, "about");
}

function localRephraseNeutral(text: string): string {
  return text
    .replace(/\byou never\b/gi, "I need consistency on")
    .replace(/\byou always\b/gi, "I notice this often")
    .replace(/\byour fault\b/gi, "this situation")
    .replace(/\byou must\b/gi, "can we agree to");
}

function localTranslateAssistive(text: string, language: LanguageCode): string {
  if (language === "en") {
    return text;
  }
  return `[${LANGUAGE_LABELS[language]} assistive draft] ${text}`;
}

class LocalAssistiveAiAdapter implements AssistiveAiAdapter {
  async assessDraft(input: DraftAssessmentInput): Promise<DraftAssessment> {
    return localAssessDraft(input);
  }

  async simplify(text: string): Promise<string> {
    return localSimplify(text);
  }

  async rephraseNeutral(text: string): Promise<string> {
    return localRephraseNeutral(text);
  }

  async translateAssistive(text: string, language: LanguageCode): Promise<string> {
    return localTranslateAssistive(text, language);
  }
}

// API-backed provider can be dropped in later without changing UI logic.
export function getAssistiveAiAdapter(): AssistiveAiAdapter {
  return new LocalAssistiveAiAdapter();
}

