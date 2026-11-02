# 한강로컬패스

React 화면과 FastAPI 서버를 함께 실행하는 팀 프로젝트의 시작 틀입니다. 현재 화면에서 서버의 연결 상태를 확인할 수 있습니다. 데이터베이스와 실제 서비스 기능은 아직 정하지 않았습니다.

## 폴더 구조

- `frontend/`: React 화면 (JavaScript, Vite)
- `backend/`: FastAPI 서버
- `compose.yaml`: 두 프로그램을 함께 실행하기 위한 설정

## Docker로 실행하기

Git과 Docker Desktop을 설치하고 Docker Desktop을 실행합니다. 저장소를 내려받은 뒤 프로젝트 폴더에서 다음 명령을 실행하세요.

```bash
docker compose up --build
```

- 화면: http://localhost:5173
- 서버 상태: http://localhost:8000/health
- API 문서: http://localhost:8000/docs

화면에 서버 연결 상태가 표시되면 두 프로그램이 통신한 것입니다. 종료하려면 터미널에서 `Ctrl+C`를 누르고, 실행 환경을 정리하려면 `docker compose down`을 실행하세요. 코드 변경을 반영하려면 명령을 다시 실행하세요.

## 함께 작업할 때

각자 브랜치에서 작업하고 Pull Request(변경 사항 합치기 요청)를 통해 공유하세요. 비밀번호, API 키, `.env` 파일, EC2 접속용 `.pem` 파일은 저장소에 올리지 마세요. 이 프로젝트의 Docker 설정은 로컬 개발을 위한 것이며 EC2 배포 설정은 포함하지 않습니다.
