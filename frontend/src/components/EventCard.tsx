import type { Exhibition, Sailing } from "../api/types";
import { formatTime } from "../recommendation";

export function EventCard({
  event,
  sailing,
  limited,
}: {
  event: Exhibition;
  sailing: Sailing;
  limited: boolean;
}) {
  const endsAt = new Date(
    Date.parse(sailing.departure) + event.totalMinutes * 60_000,
  ).toISOString();
  return (
    <article className="event-card">
      <div className={`exhibition-art ${event.id}`} aria-hidden="true">
        <span>DEMO EXHIBITION</span>
        <div className="art-shape" />
        <b>{event.id === "river" ? "빛의 기록" : "도시의 조각"}</b>
      </div>
      <div className="event-body">
        <p className="eyebrow">{event.category}</p>
        <h3>{event.title}</h3>
        <p className="event-place">
          {event.place} <span>· 하선 후 이동 {event.travelMinutes}분</span>
        </p>
        <p className="event-reason">
          {limited
            ? "추천 설명을 제공할 수 없어 기본 정보만 안내합니다."
            : event.reason}
        </p>
        <dl className="event-details">
          <div>
            <dt>일정 예시</dt>
            <dd>
              {formatTime(sailing.departure)} 출발 →{" "}
              {formatTime(sailing.arrival)} 하선 → {formatTime(endsAt)} 관람
              종료
            </dd>
          </div>
          <div>
            <dt>이동·관람</dt>
            <dd>
              도보 {event.travelMinutes}분 · 관람 {event.visitMinutes}분 · 전체{" "}
              {event.totalMinutes}분
            </dd>
          </div>
          <div>
            <dt>운영·요금</dt>
            <dd>
              {event.admission} · {event.fee}
            </dd>
          </div>
        </dl>
        <footer className="event-source">
          가상 자료 · 공식 출처 미연결
          <br />
          수집·검수 시각 예시: {formatTime(event.collectedAt)} /{" "}
          {formatTime(event.reviewedAt)} KST
        </footer>
      </div>
    </article>
  );
}
