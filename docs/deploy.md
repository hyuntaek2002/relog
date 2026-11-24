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
| RELOG_CORS_ORIGINS | 웹이 열리는 주소(경로 없이). 배포판은 `https://relog.ai.kr` |
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
- 백업: `docker compose -f docker-compose.prod.yml exec -T mysql sh -c 'mysqldump -urelog -p"$MYSQL_PASSWORD" --no-tablespaces relog' > backup.sql` (비밀번호는 컨테이너 환경 값을 쓴다. `-p`만 주고 입력받는 방식은 여러 줄을 붙여 넣으면 다음 줄이 비밀번호로 들어가 0바이트 파일이 된다)
- 중지: `docker compose -f docker-compose.prod.yml --profile tls down` (데이터는 볼륨에 남습니다. 볼륨까지 지우려면 `-v`)
- 로그: `docker compose -f docker-compose.prod.yml logs -f server`

## 확인된 것과 아닌 것

- 확인: 이미지 빌드, MySQL과 함께 기동, 상태 확인, 계정 생성·집계 저장·삭제(로컬 Docker, 2026-11-11).
- 미확인: 실제 도메인에서의 HTTPS 발급(Caddy), 외부 호스팅 환경, 부하. 스키마 이관 도구(Flyway)는 아직 없습니다.

## 도메인 relog.ai.kr (2026-11-18 가비아 등록, 2027-11-17 만료)

웹은 `relog.ai.kr`(GitHub Pages), 서버는 `api.relog.ai.kr`로 쓴다. 로그인해야 쓰는 화면(e984fd6)부터는 서버 없이 배포판을 쓸 수 없으므로 아래 순서를 한 번에 진행한다.

1. GitHub 계정 설정 → Pages → 도메인 확인(Add a domain)에 `relog.ai.kr`을 넣고, 안내하는 TXT 레코드를 가비아 DNS에 추가해 확인한다(다른 사람이 하위 도메인을 가로채는 것을 막는다).
2. 서버를 호스팅에 올리고 `api.relog.ai.kr`을 그 주소로 연결한다(A 또는 CNAME). `RELOG_CORS_ORIGINS=https://relog.ai.kr`.
3. 저장소 변수 `RELOG_API_BASE=https://api.relog.ai.kr`.
4. 저장소 Settings → Pages → Custom domain에 `relog.ai.kr`을 저장한다(Actions 배포라 CNAME 파일은 필요 없다).
5. 가비아 DNS: `relog.ai.kr` A 레코드 4개(185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153), `www` CNAME → `hyuntaek2002.github.io`. 와일드카드 레코드는 만들지 않는다. 가비아가 기본으로 넣은 레코드가 있으면 지운다.
6. master를 푸시해 루트 경로(`base: '/'`)로 다시 빌드한다. DNS 반영은 최대 24시간, 반영 뒤 Enforce HTTPS를 켠다.

값은 GitHub 문서(Managing a custom domain for your GitHub Pages site, 2026-11-18 확인) 기준.
