import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { timetableClient, TimetableApiError } from "./api/timetable";
import {
  recommendationClient,
  RecommendationApiError,
} from "./api/recommendations";
import type {
  ActivityType,
  CompanionType,
  Sailing,
  Stop,
  TimetableMetadata,
  TripDeparture,
} from "./api/types";
import { CalendarIcon, ShareIcon, ShipIcon } from "./components/icons";
import { HomePage } from "./pages/HomePage";
import { CatalogPage } from "./pages/CatalogPage";
import { PlannerPage } from "./pages/PlannerPage";
import { RecommendationPage } from "./pages/RecommendationPage";
import type { Notice, RequestPhase, ViewState } from "./pages/types";
import {
  canContinueFromPreferences,
  canContinueFromRoute,
  nextPlannerStep,
  type PlannerStep,
} from "./plannerFlow";
import { applyMapSelection, type PierSelectionTarget } from "./stationMap";
import {
  availableSailings,
  formatTime,
  sailingFromTrip,
  todayInSeoul,
} from "./recommendation";

function timetableErrorNotice(error: unknown): Notice {
  if (error instanceof TimetableApiError) {
    if (error.code === "route_not_in_timetable")
      return {
        title: "해당 구간의 시간표가 없습니다",
        body: "다른 출발·도착 선착장 조합을 선택해 주세요.",
      };
    if (error.code === "same_stop")
      return {
        title: "출발지와 도착지가 같습니다",
        body: "서로 다른 선착장을 선택해 주세요.",
      };
    if (error.status === 401 || error.status === 403)
      return {
        title: "서비스 인증을 확인할 수 없습니다",
        body: "다시 입장한 뒤 이용해 주세요.",
      };
    if (error.status === 503)
      return {
        title: "시간표 자료를 읽을 수 없습니다",
        body: "시간표 파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      };
    return {
      title: "시간표를 불러오지 못했습니다",
      body: error.message || "잠시 후 다시 시도해 주세요.",
    };
  }
  return {
    title: "시간표 API에 연결할 수 없습니다",
    body: "백엔드 서버 상태를 확인한 뒤 다시 시도해 주세요.",
  };
}

export default function App({ onLogout }: { onLogout: () => Promise<void> }) {
  const [logoutError, setLogoutError] = useState("");
  const [step, setStep] = useState<PlannerStep>("home");
  const [isCatalogPage, setIsCatalogPage] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [stops, setStops] = useState<Stop[]>([]);
  const [stopsPhase, setStopsPhase] = useState<RequestPhase>("loading");
  const [stopsNotice, setStopsNotice] = useState<Notice | null>(null);
  const [stopsRetry, setStopsRetry] = useState(0);
  const [trips, setTrips] = useState<TripDeparture[]>([]);
  const [tripMetadata, setTripMetadata] = useState<TimetableMetadata | null>(null);
  const initialParams = useMemo(
    () => new URLSearchParams(window.location.search),
    [],
  );
  const [fromStopId, setFromStopId] = useState(
    () => initialParams.get("from") ?? "",
  );
  const [toStopId, setToStopId] = useState(
    () => initialParams.get("to") ?? "",
  );
  const [tripsPhase, setTripsPhase] = useState<RequestPhase>(() => {
    if (!fromStopId || !toStopId) return "ready";
    return fromStopId === toStopId ? "error" : "loading";
  });
  const [tripsNotice, setTripsNotice] = useState<Notice | null>(() =>
    fromStopId && fromStopId === toStopId
      ? { title: "출발지와 도착지가 같습니다", body: "서로 다른 선착장을 선택해 주세요." }
      : null,
  );
  const [tripsRetry, setTripsRetry] = useState(0);
  const sharedDeparture = useRef(initialParams.get("departure") ?? "");
  const [sailingId, setSailingId] = useState("");
  const [activeTarget, setActiveTarget] = useState<PierSelectionTarget>(() =>
    fromStopId ? "destination" : "origin",
  );
  const initialCompanion = initialParams.get("companion_type");
  const initialActivity = initialParams.get("activity_type");
  const [companionType, setCompanionType] = useState<CompanionType>(
    initialCompanion === "couple" ||
      initialCompanion === "friends" ||
      initialCompanion === "solo"
      ? initialCompanion
      : "family",
  );
  const [activityType, setActivityType] = useState<ActivityType>(
    initialActivity === "culture_event" ||
      initialActivity === "walk_healing" ||
      initialActivity === "food_cafe"
      ? initialActivity
      : "exhibition_performance",
  );
  const [formError, setFormError] = useState("");
  const [view, setView] = useState<ViewState>({ phase: "idle" });
  const recommendationAbortController = useRef<AbortController | null>(null);
  const [toast, setToast] = useState("");
  const [alternativePending, setAlternativePending] = useState<Sailing | null>(
    null,
  );

  useEffect(() => {
    const clock = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      window.clearInterval(clock);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    timetableClient
      .getStops(controller.signal)
      .then((response) => {
        setStops(response.stops);
        setStopsPhase("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setStopsNotice(timetableErrorNotice(error));
        setStopsPhase("error");
        setTrips([]);
        setTripMetadata(null);
        setTripsNotice(null);
        setTripsPhase("ready");
      });
    return () => controller.abort();
  }, [stopsRetry]);

  useEffect(() => {
    if (
      stopsPhase !== "ready" ||
      !fromStopId ||
      !toStopId ||
      fromStopId === toStopId
    )
      return;

    const controller = new AbortController();
    timetableClient
      .getTrips(fromStopId, toStopId, controller.signal)
      .then((response) => {
        setTrips(response.departures);
        setTripMetadata(response.metadata);
        setTripsPhase("ready");
        if (sharedDeparture.current) {
          const match = response.departures.find(
            (trip) => trip.departure_time === sharedDeparture.current,
          );
          if (match)
            setSailingId(
              match.from_stop_id +
                "-" +
                match.to_stop_id +
                "-" +
                match.departure_time,
            );
          sharedDeparture.current = "";
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setTrips([]);
        setTripsNotice(timetableErrorNotice(error));
        setTripsPhase("error");
      });
    return () => controller.abort();
  }, [fromStopId, toStopId, stopsPhase, tripsRetry]);
  const sailings = useMemo(() => {
    const serviceDate = todayInSeoul(now);
    return availableSailings(
      trips.map((trip) => sailingFromTrip(trip, serviceDate)),
      now,
    ).filter(
      (sailing) =>
        todayInSeoul(new Date(sailing.departure)) === serviceDate,
    );
  }, [trips, now]);
  const selected = sailings.find((sailing) => sailing.id === sailingId);
  const loading = view.phase === "loading";
  const originName =
    stops.find((stop) => stop.stop_id === fromStopId)?.name_ko ?? "출발";
  const destinationName =
    stops.find((stop) => stop.stop_id === toStopId)?.name_ko ?? "도착";

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function updateRoute(nextFrom: string, nextTo: string) {
    resetResult();
    setFromStopId(nextFrom);
    setToStopId(nextTo);
    setSailingId("");
    setTrips([]);
    setTripMetadata(null);
    if (nextFrom && nextTo && nextFrom === nextTo) {
      setTripsNotice({
        title: "출발지와 도착지가 같습니다",
        body: "서로 다른 선착장을 선택해 주세요.",
      });
      setTripsPhase("error");
    } else {
      setTripsNotice(null);
      setTripsPhase(nextFrom && nextTo ? "loading" : "ready");
    }
  }

  function selectMapStop(stopId: string) {
    const selection = applyMapSelection(
      { fromStopId, toStopId },
      activeTarget,
      stopId,
    );
    if (selection.error) {
      setFormError(
        selection.error === "same-stop"
          ? "출발지와 도착지가 같습니다. 다른 선착장을 선택해 주세요."
          : "먼저 출발 선착장을 선택해 주세요.",
      );
      if (selection.error === "origin-required") setActiveTarget("origin");
      return;
    }
    setActiveTarget(selection.nextTarget);
    updateRoute(selection.route.fromStopId, selection.route.toStopId);
  }

  function retryStops() {
    setStopsPhase("loading");
    setStopsNotice(null);
    setStopsRetry((count) => count + 1);
  }

  function retryTrips() {
    setTripsPhase("loading");
    setTripsNotice(null);
    setTripsRetry((count) => count + 1);
  }
  function resetResult() {
    recommendationAbortController.current?.abort();
    recommendationAbortController.current = null;
    setView({ phase: "idle" });
    setFormError("");
    setAlternativePending(null);
  }

  function continueFromRoute() {
    if (!canContinueFromRoute(fromStopId, toStopId, tripsPhase)) {
      const message =
        !fromStopId || !toStopId
          ? "출발과 도착 선착장을 모두 선택해 주세요."
          : fromStopId === toStopId
            ? "출발과 도착 선착장은 다르게 선택해 주세요."
            : tripsPhase === "loading"
              ? "운항 시간표를 불러오는 중입니다. 잠시만 기다려 주세요."
              : "운항 시간표를 확인할 수 없습니다. 시간표를 다시 불러와 주세요.";
      setFormError(message);
      return;
    }
    setFormError("");
    setStep(nextPlannerStep("route"));
  }

  async function requestRecommendation(sailingOverride?: Sailing): Promise<boolean> {
    if (!fromStopId) {
      setFormError("출발 선착장을 선택해 주세요.");
      return false;
    }
    if (!toStopId) {
      setFormError("도착 선착장을 선택해 주세요.");
      return false;
    }
    if (tripsPhase === "loading") {
      setFormError("시간표를 불러오는 중입니다. 잠시만 기다려 주세요.");
      return false;
    }
    if (tripsPhase === "error") {
      setFormError("운항 시간표를 확인할 수 없습니다. 선착장 선택 단계에서 다시 시도해 주세요.");
      return false;
    }
    if (!sailingOverride && !canContinueFromPreferences(sailingId)) {
      setFormError("오늘 출발할 배편을 선택해 주세요.");
      return false;
    }
    const target = sailingOverride ?? selected;
    if (!target) {
      setFormError("오늘 아직 출발하지 않은 회차를 선택해 주세요.");
      return false;
    }
    const checkedNow = new Date();
    if (
      Date.parse(target.departure) <= checkedNow.getTime() ||
      todayInSeoul(new Date(target.departure)) !== todayInSeoul(checkedNow)
    ) {
      setNow(checkedNow);
      setFormError("출발 시간이 지난 회차입니다. 다른 회차를 선택해 주세요.");
      return false;
    }

    setFormError("");
    recommendationAbortController.current?.abort();
    const controller = new AbortController();
    recommendationAbortController.current = controller;
    setView({ phase: "loading" });
    try {
      const result = await recommendationClient.recommend(
        { sailing: target, companionType, activityType },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setView({ phase: "done", result, sailing: target });
      }
    } catch (error: unknown) {
      if (controller.signal.aborted) return false;
      const recommendationError = error instanceof RecommendationApiError
        ? error
        : new RecommendationApiError(
          "추천을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          500,
          "RECOMMENDATION_REQUEST_FAILED",
          true,
        );
      setView({
        phase: "done",
        result: {
          status: "unavailable",
          reason: recommendationError.code === "DATABASE_UNAVAILABLE" ? "db" : "api",
          code: recommendationError.code ?? undefined,
          message: recommendationError.message,
        },
        sailing: target,
      });
    } finally {
      if (recommendationAbortController.current === controller) {
        recommendationAbortController.current = null;
      }
    }
    return true;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void requestRecommendation().then((accepted) => {
      if (accepted) setStep("result");
    });
  }
  function handleAlternative(proposed: Sailing) {
    const current = selected;
    if (!current) return;
    const earlier = sailings
      .filter((item) => Date.parse(item.departure) < Date.parse(current.departure))
      .sort(
        (left, right) =>
          Date.parse(right.departure) - Date.parse(left.departure),
      )[0];
    if (!earlier) {
      setFormError("이 구간에는 선택할 수 있는 더 이른 회차가 없습니다.");
      return;
    }
    if (Date.parse(proposed.departure) >= Date.parse(current.departure)) {
      setFormError("변경 제안이 원래 회차보다 이르지 않습니다.");
      return;
    }
    setAlternativePending(earlier);
  }

  function shareConditions() {
    if (!selected) {
      setToast("먼저 출발 구간과 오늘의 회차를 선택해 주세요.");
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("from", fromStopId);
    url.searchParams.set("to", toStopId);
    url.searchParams.set("departure", formatTime(selected.departure));
    url.searchParams.set("companion_type", companionType);
    url.searchParams.set("activity_type", activityType);
    url.searchParams.delete("budget");
    if (!navigator.clipboard) {
      setToast("이 브라우저에서는 링크를 복사할 수 없습니다.");
      return;
    }
    navigator.clipboard
      .writeText(url.toString())
      .then(() => setToast("선택한 여정 조건을 공유 링크로 복사했어요."))
      .catch(() => setToast("링크를 복사하지 못했습니다. 브라우저 권한을 확인해 주세요."));
  }

  async function handleLogout() {
    setLogoutError("");
    try {
      await onLogout();
    } catch {
      setLogoutError(
        "로그아웃하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
      );
    }
  }

  return (
    <>
      <header className="site-header" id="top">
        <a
          className="brand"
          href="#top"
          onClick={(event) => {
            event.preventDefault();
            setIsCatalogPage(false);
            setStep("home");
          }}
          aria-label="SEOUL WAVE 홈"
        >
          <span className="brand-mark" aria-hidden="true">
            <ShipIcon />
          </span>
          <span>SEOUL WAVE</span>
        </a>
        <nav className="primary-nav" aria-label="주요 메뉴">
          <button
            className={!isCatalogPage && step === "home" ? "active" : ""}
            type="button"
            onClick={() => {
              setIsCatalogPage(false);
              setStep("home");
            }}
          >
            홈
          </button>
          <button
            className={!isCatalogPage && step !== "home" ? "active" : ""}
            type="button"
            onClick={() => {
              setIsCatalogPage(false);
              setStep("route");
            }}
          >
            나들이 플래너
          </button>
          <button
            className={isCatalogPage ? "active" : ""}
            type="button"
            onClick={() => setIsCatalogPage(true)}
          >
            문화행사·장소
          </button>
        </nav>
        <div className="header-actions">
          <button
            className="share-button"
            type="button"
            onClick={shareConditions}
          >
            <ShareIcon /> 조건 공유
          </button>
          <button
            className="logout-button"
            type="button"
            onClick={() => void handleLogout()}
          >
            로그아웃
          </button>
        </div>
      </header>

      {logoutError && (
        <p className="logout-error" role="alert">
          {logoutError}
        </p>
      )}

      <main id="main" className="page-shell">
        {isCatalogPage && <CatalogPage />}
        {!isCatalogPage && step === "home" && (
          <HomePage
            onStart={() => {
              setFormError("");
              setStep("route");
            }}
          />
        )}

        {!isCatalogPage && (step === "route" || step === "preferences") && (
          <PlannerPage
            step={step}
            stops={stops}
            stopsPhase={stopsPhase}
            stopsNotice={stopsNotice}
            retryStops={retryStops}
            fromStopId={fromStopId}
            toStopId={toStopId}
            activeTarget={activeTarget}
            loading={loading}
            setActiveTarget={setActiveTarget}
            selectMapStop={selectMapStop}
            formError={formError}
            tripsNotice={tripsNotice}
            retryTrips={retryTrips}
            tripsPhase={tripsPhase}
            trips={trips}
            tripMetadata={tripMetadata}
            setStep={setStep}
            continueFromRoute={continueFromRoute}
            originName={originName}
            destinationName={destinationName}
            sailings={sailings}
            selected={selected}
            sailingId={sailingId}
            resetResult={resetResult}
            setSailingId={setSailingId}
            companionType={companionType}
            setCompanionType={setCompanionType}
            activityType={activityType}
            setActivityType={setActivityType}
            submit={submit}
          />
        )}
        {!isCatalogPage && step === "result" && (
          <RecommendationPage
            view={view}
            selected={selected}
            loading={loading}
            originName={originName}
            destinationName={destinationName}
            onRetry={() => {
              if (view.phase === "done") void requestRecommendation(view.sailing);
            }}
            onChangeSailing={handleAlternative}
            onShare={shareConditions}
            onPrint={() => window.print()}
            onSetStep={setStep}
          />
        )}

        <footer className="site-footer">
          <span>SEOUL WAVE · 한강버스 문화행사 추천</span>
          <span>오늘의 한강, 그다음의 발견.</span>
        </footer>
      </main>
      {loading && <LoadingDialog />}
      {alternativePending && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="alternative-title"
          >
            <span className="dialog-icon">
              <CalendarIcon />
            </span>
            <h2 id="alternative-title">이전 회차로 바꿀까요?</h2>
            <p>
              {formatTime(alternativePending.departure)} 출발 회차로 조건을 다시
              확인합니다.
            </p>
            <div className="dialog-actions">
              <button
                className="outline-button"
                type="button"
                onClick={() => setAlternativePending(null)}
              >
                취소
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  const next = alternativePending;
                  setSailingId(next.id);
                  setAlternativePending(null);
                  void requestRecommendation(next);
                }}
              >
                회차 변경
              </button>
            </div>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span className="toast-check">✓</span>
          {toast}
          <button
            type="button"
            aria-label="알림 닫기"
            onClick={() => setToast("")}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}

function LoadingDialog() {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="loading-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="loading-title"
        aria-describedby="loading-description"
      >
        <span className="spinner" aria-hidden="true" />
        <p className="eyebrow">YOUR DAY OUT</p>
        <h2 id="loading-title">나들이 코스를 준비하고 있어요</h2>
        <p id="loading-description">
          운항 정보와 문화행사 정보를 확인하고 있습니다.
        </p>
      </section>
    </div>
  );
}
