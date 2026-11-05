import type { RecommendationResult, Sailing } from "../api/types";

export type ViewState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; result: RecommendationResult; sailing: Sailing };

export type Notice = { title: string; body: string };
export type RequestPhase = "loading" | "ready" | "error";
