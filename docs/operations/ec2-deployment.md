# EC2 운영 배포 절차

2026-11-06 사용자 확인: dev-stud-server (t3.small), IP 13.125.215.42, 컨테이너·볼륨 없음, 호스트 Nginx가 80 사용. IAM ec2-ecr-read 및 ECR 조회는 이미 확인했다. 이 설정은 신규 PostgreSQL 18 배포를 위한 것이며, 실제 서버 상태가 다르면 먼저 데이터와 mount를 조사한다.

## 배포 구조와 이미지

- 호스트 Nginx :80 → 사용자 화면 127.0.0.1:8080, /admin/ → 관리자 화면 127.0.0.1:8081.
- 내부 API와 PostgreSQL은 호스트에 포트를 공개하지 않는다. 두 API는 같은 DB를 사용한다.
- postgres:18은 seoul-wave-prod-postgres-data 볼륨을 최초 승인된 실행 때 생성한다. mount는 /var/lib/postgresql이다.
- Backend CI는 임시 PostgreSQL 18에서 002~008을 적용하고 pytest 커버리지 70%를 통과해야 seoulwave:<commit SHA>를 게시한다.
- Frontend는 카카오 키가 포함되어 게시된 seoul-wave-frontend:605740fa11d75560f31c932b9ffc01e609535864를 사용할 수 있다. Kakao 허용 도메인에 실제 접속 주소를 등록한다.
- 관리자 저장소 PR 병합 후, 서비스 저장소 Actions의 Publish frozen Admin images를 dev에서 실행하고 관리자 저장소의 검토된 40자리 SHA를 입력한다. 같은 seoulwave 저장소에 admin-api-<SHA>, admin-frontend-<SHA> 태그로 게시한다. 기존 서비스 저장소의 OIDC Role과 ECR 권한을 재사용하므로 관리자 저장소용 AWS 키나 새 ECR 저장소는 필요하지 않다.
- 이미지가 두 개 모두 게시된 것을 확인한 후 .env.prod에 정확한 URI를 기록한다. latest는 사용하지 않는다.

## 서버에 준비할 파일

두 저장소를 같은 상위 폴더에 SEOUL-WAVE, SEOUL-WAVE_admin 이름으로 배치한다. 각각 검토된 배포 커밋을 checkout한다. 실제 비밀값을 Git에 올리지 않는다.

- SEOUL-WAVE/.env.prod: .env.prod.example을 복사하고 빈 값과 REPLACE_*를 실제 값으로 교체한다.
- 신규 DB 비밀번호와 32자 이상의 SESSION_SECRET을 무작위로 생성한다. 볼륨 생성 이후 비밀번호를 임의 변경하지 않는다.
- HTTP 학원 시연은 사용자 승인에 따라 SESSION_COOKIE_SECURE=false를 사용한다. HTTP의 접속 비밀번호와 Basic 인증은 암호화되지 않으므로 학원 시연 범위에서 사용하고 HTTPS를 적용하면 true로 변경한다.
- ADMIN_API_KEY는 URL-safe 문자 32~128자 무작위 값이다. API와 관리자 Nginx에만 전달하며 브라우저 빌드에 포함하지 않는다.
- ADMIN_HTPASSWD_FILE은 저장소 밖의 절대 경로다. EC2에서 apache2-utils의 htpasswd -cB <파일경로> <관리자아이디>로 비밀번호를 대화형 입력한다. 비밀번호를 명령 인자나 로그에 남기지 않는다. 상위 전용 디렉터리는 700, 비밀번호 해시 파일은 644로 설정해 호스트에서는 다른 사용자가 상위 디렉터리에 접근하지 못하고, Docker에 마운트된 파일은 Nginx worker가 읽을 수 있게 한다.
- 장소 SQLite 원본을 서버의 전용 폴더에 업로드한다. PostgreSQL 볼륨을 복사하는 작업이 아니다. 원본은 읽기 전용으로 마운트해 적재한다.

## 명령 준비 (EC2 실행은 승인 후)

서비스 저장소 폴더에서 Bash 함수를 정의한다.

```bash
dc() { sudo docker compose --env-file .env.prod -f compose.prod.yaml -f ../SEOUL-WAVE_admin/compose.prod.admin.yaml "$@"; }
dc config --quiet
dc pull
```

config의 전체 출력을 공유하지 않는다. 비밀값이 펼쳐질 수 있다.

1. 컨테이너·볼륨·80/8080/8081 포트·메모리를 다시 확인한다. 기존 DB가 발견되면 이 신규 설치 절차를 중단한다.
2. 승인 후 dc up -d db로 DB만 시작한다. pg_isready와 free -h를 확인한다.
3. dc run --rm --no-deps backend python scripts/apply_migrations.py로 읽기 전용 계획을 확인한다.
4. 마이그레이션 승인 후 같은 명령 끝에 --apply를 추가한다. 도구는 체크섬과 적용 이력을 저장하며, 이력 없는 기존 테이블이 있거나 적용된 SQL이 바뀌면 거부한다. 각 SQL과 이력은 같은 트랜잭션으로 적용된다. 앱 시작 시에는 실행하지 않는다.
5. 장소 데이터는 아래처럼 dry-run 후 승인된 적재를 한다. /home/ubuntu/seoul-wave-data는 실제 업로드 폴더로 바꾼다.

```bash
dc run --rm --no-deps -v /home/ubuntu/seoul-wave-data:/source:ro backend python scripts/import_place_catalog.py --source /source/seoul_places.sqlite3 --dry-run
dc run --rm --no-deps -v /home/ubuntu/seoul-wave-data:/source:ro backend python scripts/import_place_catalog.py --source /source/seoul_places.sqlite3
```

6. dc up -d backend frontend → dc up -d itinerary-worker database-health-monitor → dc up -d admin-api admin-frontend 순서로 실행한다. 각 단계에서 dc ps, docker stats --no-stream, free -h를 확인한다. available 300MiB 미만 또는 OOM이 있으면 다음 서비스를 올리지 않는다. t3.small 실측 부하는 아직 확인되지 않았다.
7. 호스트 Nginx의 활성 설정을 백업하고 nginx-ec2.conf.example의 location을 기존 server block에 반영한다. sudo nginx -t 통과 후 승인받은 reload를 한다. 기존 Nginx를 중지하거나 80을 다른 컨테이너에 넘기지 않는다.
8. 외부 URL에서 사용자 로그인, 선착장·시간표·날짜 선택, 실제 LLM 추천, 재생성 횟수 제한, /admin/ 로그인과 실행 로그를 확인한다. /ready와 worker health는 실제 LLM 추천 성공을 보장하지 않는다.

## 데이터 보호와 롤백

다음 배포 전에는 DB를 pg_dump로 백업하고 복원 가능성을 확인한다. 첫 설치에는 이전 운영 데이터가 없다는 사용자 확인을 전제로 한다. 장애 시 앱 이미지 태그를 검증된 이전 태그로 바꾸되, DB 스키마 호환성을 먼저 확인한다. down -v, volume rm, system prune, 테이블 초기화는 사용하지 않는다. DB 감시기의 장애 전환 기록도 별도 named volume으로 보존한다.

## 검증 증빙

격리 로컬 PostgreSQL 18에서 기존 57개 테스트는 통과했지만 커버리지 63.11%로 실패했다. 복구·작업 소유권·세션 테스트 10개 추가 후 67개 통과, 커버리지 70.87%를 확인했다. 마이그레이션 dry-run, 002~008 적용, 재실행을 검증했다. 관리자 API 인증 테스트 2개와 프론트/API Docker 빌드, 실제 Nginx의 비인증 401·인증 후 페이지/자산/API 200, 브라우저 번들 키 미포함을 확인했다. GitHub 새 CI·ECR 게시와 EC2 실구동·실제 LLM 추천은 PR 병합과 운영 승인 후 확인해야 한다.
