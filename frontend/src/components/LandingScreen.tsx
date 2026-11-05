interface LandingScreenProps {
  onStart: () => void;
}

export function LandingScreen({ onStart }: LandingScreenProps) {
  return (
    <section className="landing-screen" aria-labelledby="landing-title">
      <div className="landing-hero">
        <img
          className="landing-hero-image"
          src="/images/hangang-planner-hero.png"
          alt="서울 도심과 한강을 배경으로 운항하는 한강버스 일러스트"
        />
        <div className="landing-hero-shade" aria-hidden="true" />
        <div className="landing-copy">
          <p className="eyebrow">SEOUL · RIVER · CULTURE</p>
          <h1 id="landing-title">
            한강버스와 함께하는
            <br />
            AI 맞춤 나들이 코스
          </h1>
          <p>
            출발 선착장과 오늘의 배편을 고르고
            <br />
            관심 있는 문화행사와 함께 한강 나들이를 준비해 보세요.
          </p>
          <button className="primary-button landing-start" type="button" onClick={onStart}>
            나들이 시작하기 <span aria-hidden="true">→</span>
          </button>
        </div>
        <span className="landing-image-caption">서울 한강 나들이</span>
      </div>

      <section className="landing-guide" id="guide" aria-labelledby="guide-title">
        <div>
          <p className="eyebrow">YOUR DAY OUT</p>
          <h2 id="guide-title">한강의 여정에 문화행사를 더해보세요</h2>
        </div>
        <p>
          서울시 공개 선착장과 시간표를 바탕으로 여정을 선택하고,
          문화행사 추천 결과를 확인할 수 있습니다.
        </p>
      </section>
    </section>
  );
}