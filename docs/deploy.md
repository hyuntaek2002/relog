# 서버 배포 안내

웹은 GitHub Pages에 정적 파일로 올라가 있고(master에 푸시하면 자동 배포), 서버는 서버 동기화와 뷰어를 쓸 때만 필요합니다. 이 문서는 서버를 Docker가 깔린 기계 한 대에 올리는 절차입니다. 어느 호스팅을 쓸지는 정해지지 않았고, 아래 구성은 Docker Compose가 도는 곳이면 그대로 쓸 수 있습니다.

## 서버에 저장되는 것

서비스 계정(이메일, 비밀번호 해시), 주별 집계 숫자, 기능 카탈로그, 추천 이력, 피드백, 알림 수신 여부. 대화 내용과 임베딩은 스키마에 자리가 없습니다.

## 준비물

- Docker와 Docker Compose가 깔린 리눅스 기계 1대(메모리 1GB 이상 권장: MySQL + JVM)
- 도메인 1개와 그 도메인의 A 레코드(HTTPS용). 웹이 https라서 서버도 https여야 브라우저가 요청을 막지 않습니다.
- 80, 443 포트 개방

## 절차

1. 저장소를 받습니다.

```bash
git clone https://github.com/hyuntaek2002/relog.git && cd relog/server
```

2. 환경 값을 정합니다. `.env`는 저장소에 올라가지 않습니다.

```bash
cp .env.example .env
```

| 변수 | 뜻 |
|---|---|
| RELOG_DB_PASSWORD | 서버가 MySQL에 접속할 비밀번호 |
| MYSQL_ROOT_PASSWORD | MySQL 관리자 비밀번호 |
| RELOG_CORS_ORIGINS | 웹이 열리는 주소. GitHub Pages면 `https://hyuntaek2002.github.io` (경로 없이) |
| RELOG_DOMAIN | 서버 도메인(예: `api.example.com`). HTTPS 앞단이 이 이름으로 인증서를 받습니다 |
| RELOG_BIND, RELOG_PORT | 서버 포트를 어디에 열지. 기본은 같은 기계에서만(127.0.0.1:8080) |

3. 올립니다. HTTPS 앞단(Caddy)까지 함께 띄웁니다.

```bash
docker compose -f docker-compose.prod.yml --profile tls up -d --build
```

4. 확인합니다.

```bash
curl https://<RELOG_DOMAIN>/api/health
```

`{"ok":true,...}`가 나오면 됩니다.

5. 웹이 이 서버를 쓰게 합니다. GitHub 저장소 Settings → Secrets and variables → Actions → Variables에 `RELOG_API_BASE`를 `https://<RELOG_DOMAIN>`으로 넣고, Actions의 pages 워크플로를 다시 실행합니다. 값이 없으면 웹은 로컬 서버 주소(`http://localhost:8080`)를 봅니다.

## 운영

- 갱신: `git pull` 뒤 3번 명령을 다시 실행합니다. 스키마는 서버가 시작할 때 맞춥니다(`ddl-auto: update`, 프로토타입 단계).
- 백업: `docker compose -f docker-compose.prod.yml exec mysql mysqldump -urelog -p relog > backup.sql`
- 중지: `docker compose -f docker-compose.prod.yml --profile tls down` (데이터는 볼륨에 남습니다. 볼륨까지 지우려면 `-v`)
- 로그: `docker compose -f docker-compose.prod.yml logs -f server`

## 확인된 것과 아닌 것

- 확인: 이미지 빌드, MySQL과 함께 기동, 상태 확인, 계정 생성·집계 저장·삭제(로컬 Docker, 2026-11-11).
- 미확인: 실제 도메인에서의 HTTPS 발급(Caddy), 외부 호스팅 환경, 부하. 스키마 이관 도구(Flyway)는 아직 없습니다.
