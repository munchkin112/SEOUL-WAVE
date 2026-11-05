import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { timetableClient, TimetableApiError } from "./api/timetable";
import type {
  ActivityType,
  CompanionType,
  RecommendationResult,
  Sailing,
  Stop,
  TimetableMetadata,
  TripDeparture,
} from "./api/types";
import { EventCard } from "./components/EventCard";
import { StationMap } from "./components/StationMap";
import { LandingScreen } from "./components/LandingScreen";
import { StepIndicator } from "./components/StepIndicator";
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

type ViewState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; result: RecommendationResult; sailing: Sailing };
type Notice = { title: string; body: string };
type RequestPhase = "loading" | "ready" | "error";

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

  function requestRecommendation(sailingOverride?: Sailing): boolean {
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
    setView({
      phase: "done",
      result: { status: "unavailable", reason: "api" },
      sailing: target,
    });
    return true;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestRecommendation()) setStep("result");
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
          onClick={(event) => { event.preventDefault(); setStep("home"); }}
          aria-label="SEOUL WAVE 홈"
        >
          <span className="brand-mark" aria-hidden="true">
            <ShipIcon />
          </span>
          <span>SEOUL WAVE</span>
        </a>
        <nav className="primary-nav" aria-label="주요 메뉴">
          <button
            className={step === "home" ? "active" : ""}
            type="button"
            onClick={() => setStep("home")}
          >
            홈
          </button>
          <button
            className={step !== "home" ? "active" : ""}
            type="button"
            onClick={() => setStep("route")}
          >
            나들이 플래너
          </button>
          <button
            type="button"
            onClick={() => {
              setStep("home");
              window.setTimeout(
                () => document.getElementById("guide")?.scrollIntoView({ behavior: "smooth" }),
                0,
              );
            }}
          >
            이용안내
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
        {step === "home" && (
          <LandingScreen
            onStart={() => {
              setFormError("");
              setStep("route");
            }}
          />
        )}

        {step !== "home" && (
          <section className="wizard-screen" aria-label="한강버스 나들이 플래너">
            <StepIndicator step={step} />

            {step === "route" && (
              <section className="wizard-panel" aria-labelledby="route-heading">
                <div className="wizard-heading">
                  <div className="heading-icon"><ShipIcon /></div>
                  <div>
                    <p className="eyebrow">STEP 1 · YOUR ROUTE</p>
                    <h1 id="route-heading">한강 지도에서 여정을 선택해 주세요</h1>
                    <p>출발 선착장과 도착 선착장을 지도에서 차례로 선택합니다.</p>
                  </div>
                </div>

                <StationMap
                  stops={stops}
                  stopsPhase={stopsPhase}
                  fromStopId={fromStopId}
                  toStopId={toStopId}
                  activeTarget={activeTarget}
                  disabled={loading}
                  onTargetChange={setActiveTarget}
                  onSelectStop={selectMapStop}
                />

                {formError && (
                  <p className="form-error" role="alert"><WarningIcon />{formError}</p>
                )}
                {stopsPhase === "error" && stopsNotice && (
                  <ApiNoticeCard notice={stopsNotice} onRetry={retryStops} />
                )}
                {tripsPhase === "error" && tripsNotice && (
                  <ApiNoticeCard notice={tripsNotice} onRetry={retryTrips} />
                )}
                {stopsPhase === "ready" && tripsPhase === "ready" && fromStopId && toStopId && trips.length === 0 && (
                  <p className="status-note" role="status">오늘은 선택한 구간의 운항 회차가 없습니다. 다른 구간을 선택해 주세요.</p>
                )}
                {tripsPhase === "ready" && trips.length > 0 && tripMetadata && (
                  <div className="timetable-note">
                    <span className="info-mark">i</span>
                    <p>
                      도착 시각은 시간표의 소요시간으로 계산했습니다. 운항 여부는 출발 전 공지를 확인해 주세요.
                      <a href={tripMetadata.source_url} target="_blank" rel="noreferrer">시간표 출처 보기</a>
                    </p>
                  </div>
                )}

                <div className="wizard-actions">
                  <button className="secondary-button" type="button" onClick={() => setStep("home")}>처음으로</button>
                  <button className="primary-button" type="button" onClick={continueFromRoute}>배편 선택하기 <span aria-hidden="true">→</span></button>
                </div>
              </section>
            )}

            {step === "preferences" && (
              <section className="wizard-panel" aria-labelledby="preferences-heading">
                <div className="wizard-heading">
                  <div className="heading-icon"><SparkIcon /></div>
                  <div>
                    <p className="eyebrow">STEP 2 · YOUR PREFERENCES</p>
                    <h1 id="preferences-heading">어떤 나들이를 원하시나요?</h1>
                    <p>{originName}에서 출발해 {destinationName}에 도착하는 여정입니다.</p>
                  </div>
                </div>

                <form id="planner-form" className="preferences-form" onSubmit={submit} noValidate>
                  <div className="form-grid preferences-grid">
                    <div className="form-field">
                      <label htmlFor="sailing"><span className="field-symbol clock-symbol">◷</span> 오늘의 출발 회차</label>
                      <select
                        id="sailing"
                        value={selected ? sailingId : ""}
                        disabled={tripsPhase !== "ready" || loading || sailings.length === 0}
                        aria-invalid={Boolean(formError && !selected)}
                        onChange={(event) => {
                          resetResult();
                          setSailingId(event.target.value);
                        }}
                      >
                        <option value="">
                          {tripsPhase === "loading" ? "시간표를 불러오는 중" : sailings.length ? "출발 시각을 선택해 주세요" : "오늘 남은 회차가 없습니다"}
                        </option>
                        {sailings.map((sailing) => (
                          <option key={sailing.id} value={sailing.id}>
                            {formatTime(sailing.departure)} 출발 · {formatTime(sailing.arrival)} 도착 예정
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="form-field">
                      <label htmlFor="companion-type"><span className="field-symbol">♧</span> 누구와 함께?</label>
                      <select
                        id="companion-type"
                        value={companionType}
                        onChange={(event) => {
                          resetResult();
                          setCompanionType(event.target.value as CompanionType);
                        }}
                      >
                        <option value="family">가족</option>
                        <option value="couple">연인</option>
                        <option value="friends">친구</option>
                        <option value="solo">혼자</option>
                      </select>
                    </div>

                    <div className="form-field">
                      <label htmlFor="activity-type"><span className="field-symbol">✧</span> 선호하는 활동</label>
                      <select
                        id="activity-type"
                        value={activityType}
                        onChange={(event) => {
                          resetResult();
                          setActivityType(event.target.value as ActivityType);
                        }}
                      >
                        <option value="exhibition_performance">전시 · 공연</option>
                        <option value="culture_event">문화행사</option>
                        <option value="walk_healing">산책 · 휴식</option>
                        <option value="food_cafe">맛집 · 카페</option>
                      </select>
                    </div>
                  </div>

                  {tripsPhase === "ready" && sailings.length === 0 && (
                    <div className="step-alert step-alert-info" role="status">
                      <span className="alert-icon"><CalendarIcon /></span>
                      <div><strong>오늘 선택할 수 있는 배편이 없습니다</strong><p>선착장 선택 단계로 돌아가 다른 구간을 확인해 주세요.</p></div>
                    </div>
                  )}
                  {formError && (
                    <p id="planner-error" className="form-error" role="alert"><WarningIcon />{formError}</p>
                  )}
                  {tripMetadata && trips.length > 0 && (
                    <div className="timetable-note">
                      <span className="info-mark">i</span>
                      <p>도착 시각은 시간표의 소요시간으로 계산했습니다. 운항 여부는 출발 전 공지를 확인해 주세요. <a href={tripMetadata.source_url} target="_blank" rel="noreferrer">시간표 출처 보기</a></p>
                    </div>
                  )}

                  <div className="wizard-actions">
                    <button className="secondary-button" type="button" onClick={() => setStep("route")}>이전</button>
                    <button className="primary-button" type="submit" disabled={loading || tripsPhase === "loading"}>
                      <SparkIcon /> {loading ? "추천 결과를 준비하고 있어요" : "AI 코스 추천하기"} <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </form>
              </section>
            )}

            {step === "result" && (
              <section className="wizard-panel" aria-labelledby="results-heading" aria-busy={loading}>
                <div className="wizard-heading result-step-heading">
                  <div className="heading-icon"><SparkIcon /></div>
                  <div>
                    <p className="eyebrow">STEP 3 · YOUR RECOMMENDATION</p>
                    <h1 id="results-heading">AI 추천 나들이 코스</h1>
                    <p>{originName} 출발 · {destinationName} 도착 예정 · {selected ? formatTime(selected.departure) : "선택한 배편"}</p>
                  </div>
                </div>
                <div className="results-panel">
                  <div className="result-announcement" role="status" aria-live="polite">
                    {loading ? "선택한 조건으로 추천을 준비하고 있습니다." : "추천 결과 상태가 업데이트되었습니다."}
                  </div>
                  {view.phase === "done" ? (
                    <Results
                      result={view.result}
                      sailing={view.sailing}
                      originName={originName}
                      destinationName={destinationName}
                      onRetry={() => { requestRecommendation(view.sailing); }}
                      onChangeSailing={handleAlternative}
                      onShare={shareConditions}
                      onPrint={() => window.print()}
                    />
                  ) : (
                    <p className="status-note" role="status">추천 결과를 준비할 수 없습니다. 조건을 확인하고 다시 요청해 주세요.</p>
                  )}
                  <div className="results-note">
                    <span className="info-mark">i</span>
                    <p>시간표에서 계산한 도착 시각은 실제 운항 상황과 다를 수 있습니다. 출발 전 운항 공지를 확인해 주세요.</p>
                  </div>
                </div>
                <div className="wizard-actions">
                  <button className="secondary-button" type="button" onClick={() => setStep("route")}>선착장 변경</button>
                  <button className="primary-button" type="button" onClick={() => setStep("preferences")}>조건 수정</button>
                </div>
              </section>
            )}
          </section>
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

function Results({
  result,
  sailing,
  originName,
  destinationName,
  onRetry,
  onChangeSailing,
  onShare,
  onPrint,
}: {
  result: RecommendationResult;
  sailing: Sailing;
  originName: string;
  destinationName: string;
  onRetry: () => void;
  onChangeSailing: (sailing: Sailing) => void;
  onShare: () => void;
  onPrint: () => void;
}) {
  if (result.status === "empty")
    return (
      <div className="empty-state result-empty">
        <span className="state-symbol">
          <CalendarIcon />
        </span>
        <h3>오늘 조건에 맞는 검수 문화행사가 없습니다</h3>
        <p>
          선택한 배편과 활동 유형에 맞는 후보가 없습니다.
          <br />
          다른 회차나 활동 유형을 선택해 다시 확인해 주세요.
        </p>
      </div>
    );

  if (result.status === "unavailable") {
    const message = {
      expired: {
        eyebrow: "문화행사 정보 만료",
        title: "최신 문화행사 정보를 확인할 수 없습니다",
        description:
          "유효한 수집본이 없거나 마지막 수집 후 24시간이 지나 만료되었습니다. 만료된 행사 정보는 추천에 사용하지 않습니다.",
      },
      api: {
        eyebrow: "추천 기능 이용 불가",
        title: "아직 문화행사 추천을 제공할 수 없습니다",
        description:
          "선택한 배편과 나들이 조건은 확인했습니다. 문화행사 추천 기능이 연결되면 결과를 확인할 수 있습니다.",
      },
      db: {
        eyebrow: "행사 정보 저장소 연결 오류",
        title: "행사 정보를 확인할 수 없습니다",
        description:
          "행사 정보를 저장한 데이터베이스에 연결하지 못했습니다. 데이터베이스 복구 후 다시 시도해 주세요.",
      },
    }[result.reason];
    return (
      <div className="service-alert" role="alert">
        <div className="alert-icon">
          <WarningIcon />
        </div>
        <div className="alert-copy">
          <p className="eyebrow">{message.eyebrow}</p>
          <h3>{message.title}</h3>
          <p>{message.description}</p>
        </div>
        {result.reason !== "api" && (
          <button type="button" className="outline-button" onClick={onRetry}>
            다시 시도
          </button>
        )}
      </div>
    );
  }

  if (result.status === "alternative")
    return (
      <div className="alternative-box">
        <span className="pill">배편 변경 제안</span>
        <h3>조금 이른 배편은 어떠세요?</h3>
        <p>
          선택한 {formatTime(sailing.departure)} 회차에서 조건에 맞는 후보를
          찾지 못했습니다.
        </p>
        <strong>
          {formatTime(result.sailing.departure)} 출발 →{" "}
          {formatTime(result.sailing.arrival)} 도착 예정
        </strong>
        <p>대안 회차의 행사 정보를 확인해 주세요.</p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onChangeSailing(result.sailing)}
        >
          이전 회차 변경안 확인
        </button>
      </div>
    );

  const firstEvent = result.events[0];
  return (
    <>
      <div className="result-lead">
        <div>
          <span className="eyebrow">
            {originName} 출발 · {destinationName} 도착 예정
          </span>
          <h3>{originName}에서 출발해 문화행사를 만나는 하루예요.</h3>
          <p>선택한 배편과 나들이 조건에 맞는 문화행사를 담았습니다.</p>
        </div>
      </div>
      {result.status === "limited" && (
          <p className="limited-notice">
          추천 이유를 표시할 수 없어 행사 기본 정보만 안내합니다.
        </p>
      )}
      <div className="course-layout">
        <div className="event-column">
          <h3 className="subsection-title">
            추천 문화행사 <span>{result.events.length}개</span>
          </h3>
          <div className="event-list">
            {result.events.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                sailing={sailing}
                limited={result.status === "limited"}
              />
            ))}
          </div>
        </div>
        {firstEvent && <ScheduleTimeline sailing={sailing} event={firstEvent} />}
        <RouteSummary
          sailing={sailing}
          originName={originName}
          destinationName={destinationName}
        />
      </div>
      <div className="result-actions">
        <button className="outline-button" type="button" onClick={onShare}>
          <ShareIcon /> 조건 공유
        </button>
        <button
          className="primary-button print-button"
          type="button"
          onClick={onPrint}
        >
          <span aria-hidden="true">↓</span> PDF 저장 / 인쇄
        </button>
      </div>
    </>
  );
}

function ScheduleTimeline({
  sailing,
  event,
}: {
  sailing: Sailing;
  event: { travelMinutes: number; visitMinutes: number };
}) {
  const eventArrival = new Date(
    Date.parse(sailing.arrival) + event.travelMinutes * 60_000,
  ).toISOString();
  const visitEnd = new Date(
    Date.parse(eventArrival) + event.visitMinutes * 60_000,
  ).toISOString();
  return (
    <section className="timeline-card" aria-label="추천 일정">
      <h3 className="subsection-title">
        <CalendarIcon /> 추천 일정
      </h3>
      <ol className="timeline-list">
        <li>
          <span className="timeline-dot" />
          <div>
            <time>{formatTime(sailing.departure)}</time>
            <strong>선착장 출발</strong>
            <small>한강버스 탑승</small>
          </div>
        </li>
        <li>
          <span className="timeline-dot" />
          <div>
            <time>{formatTime(sailing.arrival)}</time>
            <strong>도착 선착장 하선</strong>
            <small>배 이동 {sailing.travelMinutes ?? 0}분 · 계산 시각</small>
          </div>
        </li>
        <li>
          <span className="timeline-dot" />
          <div>
            <time>{formatTime(eventArrival)}</time>
            <strong>행사장 도착 예상</strong>
            <small>하선 후 이동 {event.travelMinutes}분</small>
          </div>
        </li>
        <li>
          <span className="timeline-dot end-dot" />
          <div>
            <time>{formatTime(visitEnd)}</time>
            <strong>관람 종료 예상</strong>
            <small>관람 {event.visitMinutes}분</small>
          </div>
        </li>
      </ol>
      <p className="timeline-footnote">
        이동·관람 소요시간은 행사 운영 정보와 함께 확인해 주세요.
      </p>
    </section>
  );
}

function RouteSummary({
  sailing,
  originName,
  destinationName,
}: {
  sailing: Sailing;
  originName: string;
  destinationName: string;
}) {
  return (
    <section className="route-card" aria-label="선택 구간 정보">
      <h3 className="subsection-title">
        <ShipIcon /> 선택 구간 <span className="example-label">도식</span>
      </h3>
      <div className="route-diagram">
        <div className="route-stop">
          <span className="route-stop-dot start-dot" />
          <strong>{originName}</strong>
          <small>출발</small>
        </div>
        <div className="route-path">
          <span className="route-boat">
            <ShipIcon />
          </span>
          <i />
        </div>
        <div className="route-stop">
          <span className="route-stop-dot end-dot" />
          <strong>{destinationName}</strong>
          <small>도착 예정</small>
        </div>
      </div>
      <dl className="route-facts">
        <div>
          <dt>배 이동</dt>
          <dd>{sailing.travelMinutes ?? "—"}분</dd>
        </div>
        <div>
          <dt>출발</dt>
          <dd>{formatTime(sailing.departure)}</dd>
        </div>
        <div>
          <dt>도착 예정</dt>
          <dd>{formatTime(sailing.arrival)}</dd>
        </div>
      </dl>
      <p className="route-disclaimer">
        경로 도식 예시 · 실제 지도·운항 확인 자료가 아닙니다.
      </p>
    </section>
  );
}

function ApiNoticeCard({
  notice,
  onRetry,
}: {
  notice: Notice;
  onRetry: () => void;
}) {
  return (
    <div className="api-notice" role="alert">
      <span className="api-notice-icon">
        <WarningIcon />
      </span>
      <div>
        <strong>{notice.title}</strong>
        <p>{notice.body}</p>
      </div>
      <button className="outline-button" type="button" onClick={onRetry}>
        다시 시도
      </button>
    </div>
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

function ShipIcon() {
  return (
    <svg viewBox="0 0 48 36" fill="none" aria-hidden="true">
      <path d="M5 20h38l-5 9H12l-7-9Z" fill="currentColor" opacity=".18" />
      <path
        d="M5 20h38l-5 9H12l-7-9Z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M13 19V10h19l6 9M20 10V5h8v5M24 5V2"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 33q5-4 10 0t10 0t10 0t10 0"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="19" cy="15" r="1.2" fill="currentColor" />
      <circle cx="25" cy="15" r="1.2" fill="currentColor" />
      <circle cx="31" cy="15" r="1.2" fill="currentColor" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2 14.4 9.6 22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2Z" />
      <path d="m19 2 .8 2.2L22 5l-2.2.8L19 8l-.8-2.2L16 5l2.2-.8L19 2Z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="m8.7 10.7 6.6-4.4m-6.6 7 6.6 4.4"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="2" />
      <path
        d="M7 3v4m10-4v4M3 10h18M7 14h3m4 0h3m-10 4h3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m12 3 10 18H2L12 3Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M12 9v5m0 3h.01"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
