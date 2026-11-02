import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { checkHealth } from './health';
import './style.css';

function App() {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    checkHealth().then((result) => { if (active) setConnected(result); });
    return () => { active = false; };
  }, []);

  return (
    <main>
      <span className="eyebrow">HANGANG LOCAL PASS</span>
      <h1>한강로컬패스</h1>
      <p>한강 주변의 새로운 장소를 만나는 프로젝트입니다.</p>
      <div className="status" role="status" aria-live="polite">
        <span className={`dot ${connected === true ? 'ok' : connected === false ? 'error' : ''}`} />
        {connected === null ? '서버 연결 확인 중' : connected ? '서버 연결됨' : '서버에 연결할 수 없어요'}
      </div>
      {connected === false && <p className="hint">백엔드가 실행 중인지 확인한 뒤 새로고침해 주세요.</p>}
    </main>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('화면을 표시할 root 요소가 없습니다.');
createRoot(root).render(<App />);
