import { env } from "../../config/env.js";

export interface ToneCheckResult {
  score: "calm" | "neutral" | "tense";
  rewriteSuggestion?: string;
  rationale: string;
}

export interface MediationSummaryInput {
  familyContext: string;
  conversationTranscript: string;
}

export class MediationService {
  getTonePrompt(message: string): string {
    return [
      "You are a neutral family communication assistant.",
      "Do not provide legal, medical, or therapeutic advice.",
      "Assess tone and suggest a calmer rewrite if message is tense.",
      "Output JSON with fields: score, rewriteSuggestion, rationale.",
      `Message: ${message}`
    ].join("\n");
  }

  getSummaryPrompt(input: MediationSummaryInput): string {
    return [
      "You are a neutral family mediator assistant.",
      "Goal: reduce conflict and preserve agency for all members.",
      "Never side with one person.",
      "Return concise sections: Shared Goals, Open Questions, Possible Compromises.",
      `Model: ${env.OPENAI_MODEL}`,
      `Family context: ${input.familyContext}`,
      `Transcript: ${input.conversationTranscript}`
    ].join("\n\n");
  }
}
