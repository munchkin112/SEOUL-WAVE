export interface Sailing {
  id: string;
  departure: string;
  arrival: string;
}
export interface Exhibition {
  id: string;
  title: string;
  category: string;
  place: string;
  reason: string;
  travelMinutes: number;
  visitMinutes: number;
  totalMinutes: number;
  admission: string;
  fee: string;
  collectedAt: string;
  reviewedAt: string;
}
export type PreviewScenario =
  | "success"
  | "empty"
  | "alternative"
  | "limited"
  | "api-error"
  | "db-error"
  | "expired";
export interface RecommendationRequest {
  sailing: Sailing;
  budgetMinutes?: number;
}
export type RecommendationResult =
  | { status: "success" | "limited"; events: Exhibition[] }
  | { status: "empty" }
  | { status: "alternative"; sailing: Sailing; events: Exhibition[] }
  | { status: "unavailable"; reason: "api" | "db" | "expired" };
export interface RecommendationClient {
  recommend(
    request: RecommendationRequest,
    signal: AbortSignal,
  ): Promise<RecommendationResult>;
}
