import { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { APP_TOUR_STEPS, APP_TOUR_VERSION } from "./tourSteps";
import type { TourRole, TourStep } from "./tourTypes";

const APP_TOUR_PROGRESS_STORAGE_KEY = "parentsapp_tour_seen_scopes_v2";

type TourMode = "inactive" | "active" | "paused";

interface UseAppTourInput {
  sessionReady: boolean;
  signedIn: boolean;
  familyId: string | null;
  userId: string | null;
  role: TourRole;
}

interface UseAppTourOutput {
  steps: TourStep[];
  currentStep: TourStep | null;
  stepIndex: number;
  totalSteps: number;
  active: boolean;
  progressLabel: string;
  startTour: () => void;
  skipTour: () => void;
  backStep: () => void;
  advanceStep: () => void;
  completeTour: () => void;
}

export function useAppTour(input: UseAppTourInput): UseAppTourOutput {
  const { sessionReady, signedIn, familyId, userId, role } = input;
  const [tourMode, setTourMode] = useState<TourMode>("inactive");
  const [stepIndex, setStepIndex] = useState(0);
  const [seenScopes, setSeenScopes] = useState<Record<string, true>>({});
  const [storageLoaded, setStorageLoaded] = useState(false);

  const steps = useMemo(() => {
    return APP_TOUR_STEPS.filter((step) => {
      if (!step.optionalForRoles || step.optionalForRoles.length === 0) {
        return true;
      }
      return step.optionalForRoles.includes(role);
    });
  }, [role]);

  const scopeKey = useMemo(() => {
    if (!familyId) {
      return null;
    }
    return `${APP_TOUR_VERSION}:${userId ?? "demo"}:${familyId}`;
  }, [familyId, userId]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const stored = await AsyncStorage.getItem(APP_TOUR_PROGRESS_STORAGE_KEY);
        if (cancelled) {
          return;
        }
        if (!stored) {
          setSeenScopes({});
          return;
        }

        const parsed = JSON.parse(stored) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setSeenScopes({});
          return;
        }

        const normalized: Record<string, true> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (value === true) {
            normalized[key] = true;
          }
        }
        setSeenScopes(normalized);
      } catch {
        setSeenScopes({});
      } finally {
        if (!cancelled) {
          setStorageLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageLoaded) {
      return;
    }
    void AsyncStorage.setItem(APP_TOUR_PROGRESS_STORAGE_KEY, JSON.stringify(seenScopes));
  }, [storageLoaded, seenScopes]);

  useEffect(() => {
    if (!storageLoaded || !sessionReady || !signedIn || !scopeKey || tourMode !== "inactive") {
      return;
    }
    if (seenScopes[scopeKey]) {
      return;
    }

    setSeenScopes((prev) => ({ ...prev, [scopeKey]: true }));
    setStepIndex(0);
    setTourMode("active");
  }, [storageLoaded, sessionReady, signedIn, scopeKey, seenScopes, tourMode]);

  useEffect(() => {
    if (steps.length === 0) {
      setTourMode("inactive");
      setStepIndex(0);
      return;
    }

    setStepIndex((prev) => Math.min(prev, steps.length - 1));
  }, [steps]);

  const currentStep = tourMode === "active" ? steps[stepIndex] ?? null : null;

  const finish = useCallback(() => {
    setTourMode("inactive");
    setStepIndex(0);
  }, []);

  const startTour = useCallback(() => {
    setStepIndex(0);
    setTourMode("active");
  }, []);

  const advanceStep = useCallback(() => {
    if (stepIndex >= steps.length - 1) {
      finish();
      return;
    }
    setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
  }, [stepIndex, steps.length, finish]);

  const backStep = useCallback(() => {
    setStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const skipTour = useCallback(() => {
    finish();
  }, [finish]);

  const completeTour = useCallback(() => {
    finish();
  }, [finish]);

  return {
    steps,
    currentStep,
    stepIndex,
    totalSteps: steps.length,
    active: tourMode === "active",
    progressLabel: `${Math.min(stepIndex + 1, Math.max(steps.length, 1))}/${Math.max(steps.length, 1)}`,
    startTour,
    skipTour,
    backStep,
    advanceStep,
    completeTour
  };
}
