export interface Sailing {
  id: string;
  departure: string;
  arrival: string;
  originStopId?: string;
  destinationStopId?: string;
  travelMinutes?: number;
  stopCallStatus?: string;
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
  companionType: CompanionType;
  activityType: ActivityType;
}

export type CompanionType = "family" | "couple" | "friends" | "solo";
export type ActivityType =
  | "exhibition_performance"
  | "culture_event"
  | "walk_healing"
  | "food_cafe";

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

export interface Stop {
  stop_id: string;
  name_ko: string;
  display_order: number;
}

export interface TimetableMetadata {
  dataset_id: string;
  timezone: string;
  source_url: string;
  effective_from: string;
  effective_until: string | null;
  operating_days_status: string;
  separate_operational_notices_reviewed: boolean;
  service_date_status: string;
}

export interface StopListResponse {
  metadata: TimetableMetadata;
  stops: Stop[];
}

export interface TripDeparture {
  from_stop_id: string;
  to_stop_id: string;
  departure_time: string;
  travel_minutes: number;
  estimated_arrival_time: string;
  arrival_time_source: "calculated";
  arrival_day_offset: number;
  stop_call_status: string;
}

export interface TripQueryResponse {
  metadata: TimetableMetadata;
  departures: TripDeparture[];
}
