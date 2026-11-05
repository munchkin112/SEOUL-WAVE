# 한강로컬패스

한강로컬패스의 React 화면과 FastAPI 백엔드입니다. 백엔드는 생존 확인 API와 검수된 시간표 조회 API를 제공합니다. Docker Compose에는 PostgreSQL 18이 준비되어 있지만, 백엔드와 데이터베이스를 연결하는 코드는 아직 구현 중입니다.

## 폴더 구조

- `frontend/`: React 화면 (TypeScript, Vite)
- `backend/`: FastAPI 서버
- `compose.yaml`: 두 프로그램을 함께 실행하기 위한 설정
- `backend/data/raw/`: 로컬 원본 시간표와 OCR 중간 파일 (Git에 올리지 않음)
- `backend/data/processed/`: 검수한 시간표 JSON과 검증 보고서

## Docker로 실행하기

Git과 Docker Desktop을 설치하고 Docker Desktop을 실행합니다. 저장소를 내려받은 뒤 프로젝트 폴더에서 `.env.example`을 복사해 `.env`를 만들고, `POSTGRES_PASSWORD`에 로컬 개발용 비밀번호를 입력합니다. 서울시 문화행사 API를 아직 호출하지 않아도 실행할 수 있으며, API 키는 발급받은 경우에만 `SEOUL_CULTURE_API_KEY`에 입력합니다. `.env`는 Git에 올리지 마세요.

```bash
cp .env.example .env
docker compose up --build
```

- 화면: http://localhost:5173
- 서버 상태: http://localhost:8000/health
- 선착장 목록: http://localhost:8000/api/stops
- 출발·도착 시간표: `http://localhost:8000/api/trips?from_stop_id=MAGOK&to_stop_id=MANGWON`
- API 문서: http://localhost:8000/docs

화면에 서버 연결 상태가 표시되면 프론트엔드와 백엔드가 통신한 것입니다. PostgreSQL 컨테이너도 실행되지만, 아직 백엔드가 DB를 사용하지는 않습니다. 종료하려면 터미널에서 `Ctrl+C`를 누르고, 실행 환경을 정리하려면 `docker compose down`을 실행하세요. 코드 변경을 반영하려면 명령을 다시 실행하세요.

## 함께 작업할 때

각자 브랜치에서 작업하고 Pull Request(변경 사항 합치기 요청)를 통해 공유하세요. 비밀번호, API 키, `.env` 파일, EC2 접속용 `.pem` 파일은 저장소에 올리지 마세요. 이 프로젝트의 Docker 설정은 로컬 개발을 위한 것이며 EC2 배포 설정은 포함하지 않습니다.
