import { useEffect, useRef, useState } from "react";
import { createDemoSailings, createMockClient } from "./api/mock";
import type {
  PreviewScenario,
  RecommendationResult,
  Sailing,
} from "./api/types";
import { EventCard } from "./components/EventCard";
import {
  availableSailings,
  formatTime,
  parseBudget,
  todayInSeoul,
} from "./recommendation";

const scenarios: { value: PreviewScenario; label: string }[] = [
  { value: "success", label: "추천 성공" },
  { value: "empty", label: "결과 없음" },
  { value: "alternative", label: "이전 회차 변경안" },
  { value: "limited", label: "설명 축소" },
  { value: "api-error", label: "API 장애" },
  { value: "db-error", label: "DB 장애" },
  { value: "expired", label: "데이터 이용 불가" },
];
type ViewState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; result: RecommendationResult; sailing: Sailing };

export default function App({ onLogout }: { onLogout: () => Promise<void> }) {
  const [logoutError, setLogoutError] = useState('');
  async function handleLogout() {
    setLogoutError('');
    try {
      await onLogout();
    } catch {
      setLogoutError('로그아웃하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.');
    }
  }
  const [now, setNow] = useState(() => new Date());
  const [demoSailings] = useState(() => createDemoSailings(new Date()));
  const [routeSelected, setRouteSelected] = useState(false);
  const [sailingId, setSailingId] = useState("");
  const [budget, setBudget] = useState("");
  const [error, setError] = useState("");
  const [scenario, setScenario] = useState<PreviewScenario>("success");
  const [view, setView] = useState<ViewState>({ phase: "idle" });
  const controller = useRef<AbortController | null>(null);
  const requestPending = useRef(false);
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      clearInterval(clock);
      controller.current?.abort();
    };
  }, []);
  const sailings = availableSailings(demoSailings, now).filter(
    (sailing) =>
      todayInSeoul(new Date(sailing.departure)) === todayInSeoul(now),
  );
  const selected = sailings.find((sailing) => sailing.id === sailingId);
  const loading = view.phase === "loading";
  function reset() {
    controller.current?.abort();
    requestPending.current = false;
    setView({ phase: "idle" });
    setError("");
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestPending.current) return;
    if (!routeSelected || !selected) {
      setError("구간과 오늘의 출발 회차를 선택해 주세요.");
      return;
    }
    const checkedNow = new Date();
    if (
      Date.parse(selected.departure) <= checkedNow.getTime() ||
      todayInSeoul(new Date(selected.departure)) !== todayInSeoul(checkedNow)
    ) {
      setNow(checkedNow);
      setError("출발 시간이 지난 회차입니다. 다른 회차를 선택해 주세요.");
      return;
    }
    let budgetMinutes: number | undefined;
    try {
      budgetMinutes = parseBudget(budget);
    } catch (failure) {
      setError((failure as Error).message);
      return;
    }
    const pending = new AbortController();
    controller.current = pending;
    requestPending.current = true;
    setError("");
    setView({ phase: "loading" });
    try {
      const result = await createMockClient(scenario).recommend(
        { sailing: selected, budgetMinutes },
        pending.signal,
      );
      if (!pending.signal.aborted)
        setView({ phase: "done", result, sailing: selected });
    } catch {
      if (!pending.signal.aborted)
        setView({
          phase: "done",
          result: { status: "unavailable", reason: "api" },
          sailing: selected,
        });
    } finally {
      if (controller.current === pending) requestPending.current = false;
    }
  }
  return (
    <>
      <header className="site-header">
        <a className="brand" href="#main">
          <span className="brand-mark" aria-hidden="true">
            ≈
          </span>{" "}
          SEOUL WAVE<span className="brand-sub">한강버스 문화행사 추천</span>
        </a>
        <div className="header-actions">
          <span className="header-note">한강에서 만나는 서울의 문화행사</span>
          <button className="logout-button" type="button" onClick={() => void handleLogout()}>
            로그아웃
          </button>
        </div>
      </header>
      {logoutError && <p className="logout-error" role="alert">{logoutError}</p>}
      <main id="main" className="page-shell">
        <div className="demo-banner">
          <span className="demo-tag">화면 미리보기</span>모든
          구간·배편·문화행사는 가상 데이터입니다. 실제 운항·방문 안내가
          아닙니다.
        </div>
        <section className="intro">
          <div>
            <p className="eyebrow">A DAY ALONG THE HAN RIVER</p>
            <h1>
              한강을 건너,
              <br />
              오늘의 문화행사로.
            </h1>
            <p className="intro-copy">
              배편을 고르면, 도착 후 즐길 수 있는 서울의 문화행사를
              찾아드립니다.
              <br />
              하선 후 이동 30분 이내의 문화행사를 최대 3개까지 안내합니다.
            </p>
          </div>
          <div className="today">
            <span>오늘의 여정</span>
            <strong>{todayInSeoul(now).replaceAll("-", ". ")}</strong>
            <small>한국 시간 KST · 기기 시각 기준 미리보기</small>
          </div>
        </section>
        <div className="workspace">
          <section className="journey-panel" aria-labelledby="journey-heading">
            <div className="panel-heading">
              <span className="section-number">01</span>
              <h2 id="journey-heading">어떤 배편으로 떠나세요?</h2>
            </div>
            <form onSubmit={submit} noValidate>
              <fieldset disabled={loading}>
                <legend>지원 구간 선택</legend>
                <p className="field-hint">
                  검수된 구간 1개만 지원할 예정입니다.
                </p>
                <div className="route-map">
                  <span className="river-label" aria-hidden="true">
                    H A N &nbsp; R I V E R
                  </span>
                  <div className="river-line" aria-hidden="true" />
                  <button
                    type="button"
                    className={`route-choice ${routeSelected ? "selected" : ""}`}
                    aria-pressed={routeSelected}
                    onClick={() => {
                      reset();
                      setRouteSelected(true);
                    }}
                  >
                    <span className="route-stops">
                      <i />
                      시연 출발<span className="route-arrow">→</span>
                      <i />
                      시연 도착
                    </span>
                    <span className="route-caption">
                      가상 구간 선택 {routeSelected ? "✓" : "↗"}
                    </span>
                  </button>
                  <span className="unsupported">다른 구간 · 미지원</span>
                </div>
              </fieldset>
              <fieldset disabled={loading}>
                <legend>
                  <label htmlFor="sailing">오늘의 출발 회차</label>
                </legend>
                <select
                  id="sailing"
                  value={selected ? sailingId : ""}
                  disabled={!routeSelected || sailings.length === 0}
                  onChange={(event) => {
                    reset();
                    setSailingId(event.target.value);
                  }}
                >
                  <option value="">
                    {sailings.length
                      ? "출발 시각을 선택해 주세요"
                      : "오늘 선택 가능한 시연 회차가 없습니다"}
                  </option>
                  {sailings.map((sailing) => (
                    <option key={sailing.id} value={sailing.id}>
                      {formatTime(sailing.departure)} 출발 →{" "}
                      {formatTime(sailing.arrival)} 도착예정
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  {selected
                    ? `배 이동 30분 · ${formatTime(selected.arrival)} 계산 도착예정`
                    : "아직 출발하지 않은 회차만 표시합니다."}
                  <br />
                  시연 시간표 · 실제 출처·운항 여부 미확인
                </p>
              </fieldset>
              <fieldset disabled={loading}>
                <legend>
                  <label htmlFor="budget">
                    총 여행시간 <span className="optional">선택</span>
                  </label>
                </legend>
                <div className="budget-input">
                  <input
                    id="budget"
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    placeholder="시간 제한 없이"
                    value={budget}
                    aria-describedby="budget-hint form-error"
                    aria-invalid={Boolean(error)}
                    onChange={(event) => {
                      reset();
                      setBudget(event.target.value);
                    }}
                  />
                  <span>분</span>
                </div>
                <p id="budget-hint" className="field-hint">
                  배 출발부터 이동·대기·관람 종료까지 포함합니다.
                  <br />
                  귀가와 복귀 배편은 포함하지 않습니다.
                </p>
              </fieldset>
              <p id="form-error" className="form-error" role="alert">
                {error}
              </p>
              <button
                className="primary-button"
                type="submit"
                disabled={loading || !routeSelected || !selected}
              >
                {loading
                  ? "문화행사를 찾고 있습니다…"
                  : "조건에 맞는 문화행사 찾기"}
                <span aria-hidden="true">→</span>
              </button>
            </form>
            <details className="preview-tools">
              <summary>시연 화면 상태 선택</summary>
              <label htmlFor="scenario">다음 요청의 응답 상태</label>
              <select
                id="scenario"
                value={scenario}
                disabled={loading}
                onChange={(event) => {
                  reset();
                  setScenario(event.target.value as PreviewScenario);
                }}
              >
                {scenarios.map((item) => (
                  <option value={item.value} key={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <p>이전 회차 변경안은 두 번째 이후 회차를 선택해 확인하세요.</p>
            </details>
          </section>
          <section
            className="results-panel"
            aria-labelledby="results-heading"
            aria-busy={loading}
          >
            <div className="panel-heading">
              <span className="section-number">02</span>
              <h2 id="results-heading">도착 후 만날 문화행사</h2>
              <span className="result-limit">최대 3개</span>
            </div>
            <div
              role="status"
              aria-live="polite"
              className="result-announcement"
            >
              {loading
                ? "선택한 조건으로 시연 결과를 불러오는 중입니다."
                : view.phase === "done"
                  ? "시연 결과를 확인해 주세요."
                  : ""}
            </div>
            {view.phase === "idle" && (
              <div className="empty-state initial-state">
                <div className="ticket-illustration" aria-hidden="true">
                  <span>SEOUL WAVE</span>
                  <div>
                    출발 <b>→</b> 문화
                  </div>
                  <small>YOUR NEXT STOP</small>
                </div>
                <h3>오늘의 배편을 골라보세요</h3>
                <p>
                  선택한 배편에 맞는 문화행사를 안내합니다.
                  <br />
                  조건에 맞는 문화행사가 있을 때만 추천합니다.
                </p>
                <div className="guide-chips">
                  <span>오늘의 문화행사</span>
                  <span>하선 후 이동 30분 이내</span>
                </div>
              </div>
            )}
            {loading && (
              <div className="empty-state">
                <div className="loading-wave" aria-hidden="true">
                  ≈
                </div>
                <h3>여정에 맞는 문화행사를 확인하고 있습니다</h3>
                <p>가상 응답을 불러오고 있습니다.</p>
              </div>
            )}
            {view.phase === "done" && (
              <Results
                result={view.result}
                sailing={view.sailing}
                onChangeSailing={(sailing) => {
                  reset();
                  const matchingSailing = sailings.find(
                    (item) =>
                      Date.parse(item.departure) ===
                      Date.parse(sailing.departure),
                  );
                  if (
                    !matchingSailing ||
                    Date.parse(matchingSailing.departure) <= Date.now()
                  ) {
                    setError(
                      "변경안의 출발 시간이 지났습니다. 다른 회차를 선택해 주세요.",
                    );
                    return;
                  }
                  setSailingId(matchingSailing.id);
                  setView({
                    phase: "done",
                    sailing,
                    result:
                      view.result.status === "alternative"
                        ? { status: "success", events: view.result.events }
                        : view.result,
                  });
                }}
              />
            )}
            <div className="results-note">
              <span aria-hidden="true">ⓘ</span>
              <p>
                행사 정보는 하루 한 번 갱신될 예정입니다. 현장 변경·결항·매진은
                보장하지 않습니다. 서울 열린데이터광장 문화행사 API 연결
                예정입니다. 실제 서비스에서는 수집·검수 시각과 출처를 함께
                안내합니다.
              </p>
            </div>
          </section>
        </div>
        <footer className="site-footer">
          <span>SEOUL WAVE · 서비스명 검토 중</span>
          <span>오늘의 한강, 그다음의 발견.</span>
        </footer>
      </main>
    </>
  );
}

function Results({
  result,
  sailing,
  onChangeSailing,
}: {
  result: RecommendationResult;
  sailing: Sailing;
  onChangeSailing: (sailing: Sailing) => void;
}) {
  if (result.status === "empty")
    return (
      <div className="empty-state">
        <span className="state-symbol" aria-hidden="true">
          ∅
        </span>
        <h3>오늘 조건에 맞는 검수 문화행사가 없습니다</h3>
        <p>
          선택한 배편과 시간 조건에 맞는 후보가 없습니다.
          <br />
          배편이나 총시간을 바꿔 다시 확인해 주세요.
        </p>
      </div>
    );
  if (result.status === "unavailable") {
    const message = {
      expired: {
        eyebrow: "문화행사 정보 만료",
        title: "최신 문화행사 정보를 확인할 수 없습니다",
        description:
          "마지막으로 수집한 행사 정보가 24시간을 넘어 만료되었거나, 아직 수집된 정보가 없습니다. 만료된 정보로는 추천하지 않습니다.",
      },
      api: {
        eyebrow: "추천 서비스 연결 오류",
        title: "문화행사 추천 서비스에 연결할 수 없습니다",
        description:
          "추천 서비스와 통신하는 중 문제가 발생해 문화행사를 가져오지 못했습니다.",
      },
      db: {
        eyebrow: "행사 정보 연결 오류",
        title: "행사 정보를 확인할 수 없습니다",
        description:
          "행사 정보를 보관하는 저장소에 연결되지 않아 추천할 수 없습니다.",
      },
    }[result.reason];
    return (
      <div className="empty-state unavailable">
        <span className="state-symbol" aria-hidden="true">
          !
        </span>
        <p className="eyebrow">{message.eyebrow}</p>
        <h3>{message.title}</h3>
        <p>
          {message.description}
          <br />
          잠시 후 다시 시도해 주세요.
        </p>
      </div>
    );
  }
  if (result.status === "alternative")
    return (
      <div className="alternative-box">
        <span className="pill">배편 변경 제안 · 시연</span>
        <h3>조금 이른 배편은 어떠세요?</h3>
        <p>
          선택한 {formatTime(sailing.departure)} 배편에서 적격 후보가 없는
          경우의 예시입니다.
        </p>
        <strong>
          {formatTime(result.sailing.departure)} 출발 →{" "}
          {formatTime(result.sailing.arrival)} 도착예정
        </strong>
        <p>가상 문화행사 {result.events.length}개 · 실제 방문 조건 미검수</p>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onChangeSailing(result.sailing)}
        >
          이전 회차 변경안 선택
        </button>
      </div>
    );
  return (
    <div className="event-list">
      <div className="result-summary">
        <span>
          시연 문화행사 <strong>{result.events.length}개</strong>
        </span>
        <small>{formatTime(sailing.departure)} 출발 기준</small>
      </div>
      {result.status === "limited" && (
        <p className="limited-notice">
          추천 설명·검토가 축소된 상태의 예시입니다. 기본 정보만 표시합니다.
        </p>
      )}
      {result.events.map((event) => (
        <EventCard
          key={event.id}
          event={event}
          sailing={sailing}
          limited={result.status === "limited"}
        />
      ))}
    </div>
  );
}
