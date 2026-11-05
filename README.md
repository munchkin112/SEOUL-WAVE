# 한강버스 AI 나들이 플래너

한강버스 AI 나들이 플래너의 FastAPI 백엔드와 React 화면입니다. 백엔드는 시간표 조회, 서울시 문화행사 API 조회, PostgreSQL 장소 조회를 제공합니다. 문화행사는 실시간 API에서 받고, 박물관·미술관·공원 등 장소 정보는 PostgreSQL에 저장합니다.

## 기준 문서

- [PRD v1.0](docs/PRD.md): 제품 범위와 수용 기준

## 폴더 구조

- `frontend/`: React 화면 (TypeScript, Vite)
- `backend/`: FastAPI 서버
- `compose.yaml`: 두 프로그램을 함께 실행하기 위한 설정
- `backend/data/raw/`: 로컬 원본 시간표와 OCR 중간 파일 (Git에 올리지 않음)
- `backend/data/processed/`: 검수한 시간표 JSON과 검증 보고서
- `backend/migrations/002_create_places.sql`: 통합 장소 카탈로그 테이블
- `backend/scripts/import_place_catalog.py`: 제공된 SQLite 통합 장소 데이터를 PostgreSQL에 적재

## Docker로 실행하기

Git과 Docker Desktop을 설치하고 Docker Desktop을 실행합니다. 저장소를 내려받은 뒤 프로젝트 폴더에서 `.env.example`을 복사해 `.env`를 만들고, `POSTGRES_PASSWORD`와 `SITE_ACCESS_PASSWORDS`를 로컬 개발용 값으로 설정합니다. 문화행사 API를 쓰려면 `SEOUL_CULTURE_API_KEY`도 입력합니다. `.env`는 Git에 올리지 마세요.

```bash
cp .env.example .env
docker compose up --build
```

- 화면: http://localhost:5173
- 서버 상태: http://localhost:8000/health
- DB 준비 상태: http://localhost:8000/ready
- 선착장 목록: http://localhost:8000/api/v1/ferry/stops
- 출발·도착 시간표: `http://localhost:8000/api/v1/ferry/trips?from_stop_id=MAGOK&to_stop_id=MANGWON`
- 장소 목록: http://localhost:8000/api/v1/places
- 문화행사 목록: http://localhost:8000/api/v1/events
- API 문서: http://localhost:8000/docs

문화행사 API를 사용하려면 `.env`에 `SEOUL_CULTURE_API_KEY`도 설정해야 합니다. 종료하려면 터미널에서 `Ctrl+C`를 누르고, 실행 환경을 정리하려면 `docker compose down`을 실행하세요. 코드 변경을 반영하려면 명령을 다시 실행하세요.

`/health`와 `/ready`는 상태 확인용 공개 API입니다. 선착장·시간표·장소·문화행사 API는 로그인 세션이 필요하며, 프런트엔드 로그인은 `POST /api/auth/login`을 사용합니다. 비밀번호 목록은 `.env`의 `SITE_ACCESS_PASSWORDS`에 쉼표로 구분해 설정합니다.

## 통합 장소 데이터를 PostgreSQL에 적재하기

`C:\study\han_river_pj\database\seoul_places.sqlite3`에는 장소 마스터 3,072건, 출처 레코드 3,397건, 식물원 구역 5건이 들어 있습니다. 원본 SQLite 파일은 저장소에 복사하지 않고 읽기 전용으로 마운트해 사용합니다. 아래 명령은 PowerShell 기준입니다.

1. DB를 실행합니다.

   ```powershell
   docker compose up -d db
   ```

2. 장소 테이블을 한 번 생성합니다. 이미 적용한 경우 이 단계는 건너뜁니다.

   ```powershell
   Get-Content -Raw -Encoding UTF8 backend/migrations/002_create_places.sql | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
   ```

3. 먼저 읽기 전용 검증을 실행합니다.

   ```powershell
   docker compose run --rm -v "C:/study/han_river_pj/database:/source:ro" backend python scripts/import_place_catalog.py --source /source/seoul_places.sqlite3 --dry-run
   ```

4. 검증 결과를 확인한 뒤 실제로 적재합니다.

   ```powershell
   docker compose run --rm -v "C:/study/han_river_pj/database:/source:ro" backend python scripts/import_place_catalog.py --source /source/seoul_places.sqlite3
   ```

적재는 안정된 텍스트 ID를 보존하며, 장소·출처·구역 행을 upsert합니다. 이 스크립트는 행사 데이터를 가져오거나 기존 행을 삭제하지 않습니다. `CULTURAL_SPACE`는 공연장·도서관·문화원 등으로 구성된 원본 분류라 `EXHIBITION_HALL`과 합치지 않고 별도 분류로 유지합니다.

2026-11-05 로컬 확인 결과: PostgreSQL 18에 장소 3,072건, 출처 레코드 3,397건, 구역 5건을 적재했습니다. `/ready`에서 DB 연결이 정상이고, 장소 목록·상세 조회가 응답했습니다. API 분류별 건수는 박물관 241건, 미술관 291건, 식물원 3건, 공원 1,884건, 문화공간 653건입니다. 서울시 문화행사 API도 호출되어 전체 19,701건 중 요청한 5건을 반환했습니다. 이는 로컬 개발 환경에서 확인한 결과입니다.

## 함께 작업할 때

각자 브랜치에서 작업하고 Pull Request(변경 사항 합치기 요청)를 통해 공유하세요. 비밀번호, API 키, `.env` 파일, EC2 접속용 `.pem` 파일은 저장소에 올리지 마세요. 이 프로젝트의 Docker 설정은 로컬 개발을 위한 것이며 EC2 배포 설정은 포함하지 않습니다.
