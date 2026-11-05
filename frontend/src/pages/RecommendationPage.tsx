import type { RecommendationResult, Sailing } from "../api/types";
import { EventCard } from "../components/EventCard";
import {
  CalendarIcon,
  ShareIcon,
  SparkIcon,
  ShipIcon,
  WarningIcon,
} from "../components/icons";
import { StepIndicator } from "../components/StepIndicator";
import { formatTime } from "../recommendation";
import type { PlannerStep } from "../plannerFlow";
import type { ViewState } from "./types";

interface RecommendationPageProps {
  view: ViewState;
  selected: Sailing | undefined;
  loading: boolean;
  originName: string;
  destinationName: string;
  onRetry: () => void;
  onChangeSailing: (sailing: Sailing) => void;
  onShare: () => void;
  onPrint: () => void;
  onSetStep: (step: PlannerStep) => void;
}

export function RecommendationPage({
  view,
  selected,
  loading,
  originName,
  destinationName,
  onRetry,
  onChangeSailing,
  onShare,
  onPrint,
  onSetStep,
}: RecommendationPageProps) {
  return (
    <section className="wizard-screen" aria-label="한강버스 나들이 플래너">
      <StepIndicator step="result" />

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
                      onRetry={onRetry}
                      onChangeSailing={onChangeSailing}
                      onShare={onShare}
                      onPrint={onPrint}
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
                  <button className="secondary-button" type="button" onClick={() => onSetStep("route")}>선착장 변경</button>
                  <button className="primary-button" type="button" onClick={() => onSetStep("preferences")}>조건 수정</button>
                </div>
              </section>
    </section>
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
