# relog

ChatGPT·Claude 대화 내보내기 파일을 브라우저 안에서만 분석해, 같은 지시를 다시 말한 것으로 보이는 메시지를 찾고, 내 사용 패턴에 맞는 기능·플러그인·습관을 근거와 함께 추천하고, 시간이 지나며 어떻게 달라졌는지 비교합니다.

- 대화 내용과 임베딩은 브라우저 밖으로 내보내지 않습니다. 서버 동기화(선택)를 켜면 주 단위 집계 숫자와 요금제·쓰는 기능·피드백만 보냅니다.
- "다시 말한 지시"는 의심 표시입니다. AI가 지시를 따랐는지는 판정하지 않습니다.
- 선문대학교 SW중심대학 기업연계 프로젝트(2026년 2학기) 과제입니다.

배포판(서버 없는 로컬 전용 모드): https://hyuntaek2002.github.io/relog/

## 구성

| 폴더 | 내용 |
|---|---|
| web/ | React + TypeScript 웹. 파서, 정규화, 임베딩(transformers.js), 과업 분류, 반복 탐지, 집계, 추천, 리포트, 뷰어 |
| server/ | Spring Boot 4 + MySQL 8(개발은 H2). 집계 수신, 추천, 피드백, 변화 추이 |
| catalog/ | 기능 카탈로그(catalog.json)와 수집 원본, 플러그인 찾기 데이터 생성 스크립트 |
| eval/ | 테스트와 평가 스크립트(파서·탐지·분류), 합성 개발셋·테스트셋, 라벨 기준 |
| docs/ | 요구사항 정의서, 설계 문서, 실측 기록, 내보내기 파일 구조, 평가 동의서 |

## 실행

웹(필수):

```bash
cd web
npm install
npm run dev
```

http://localhost:5173 에서 내보내기 zip을 넣습니다. Claude Code 기록은 `.claude/projects` 폴더를 zip으로 묶어 함께 넣을 수 있습니다. 주소에 `?dev=1`을 붙이면 개발자 패널(라벨링, 네트워크 감사, 내부 숫자), `?ab=1`은 추천 블라인드 평가, `?view=1`은 서버 보관 통계·처방 뷰어입니다.

서버(선택, 서버 동기화·뷰어를 쓸 때):

```bash
cd server
./mvnw spring-boot:run -Dspring-boot.run.profiles=dev
```

`dev` 프로필은 H2 파일 DB를 씁니다. MySQL로 돌리려면 `docker compose up -d` 뒤 프로필 없이 실행합니다.

## 테스트와 평가

```bash
node eval/test_parser.mjs
```

```bash
cd server && ./mvnw test
```

```bash
node eval/detect/run_devset.mjs Xenova/multilingual-e5-small testset.json --final
```

- 과업 분류 A/B/C 비교: `node eval/classify/sample_wildchat.mjs 400`으로 공개 데이터 표본을 만들고, 앱(?dev=1)에서 라벨링한 뒤 `node eval/classify/run_abc.mjs <표본 zip> <라벨 csv>`.
- 실측 결과와 한계는 [docs/measurements.md](docs/measurements.md)에 날짜순으로 적습니다.

## 문서

- [요구사항 정의서](docs/requirements.md)
- [설계 문서](docs/design.md)
- [실측 기록](docs/measurements.md)
- [내보내기 파일 구조](docs/export-format.md)
- [과업 유형 라벨 기준](eval/labels/README.md)
- [사용자 평가 동의서](docs/consent-form.md)

## 데이터 출처

- 플러그인 목록: Claude 앱 플러그인 탐색 화면과 플러그인 디렉터리를 2026-11-10에 읽은 것입니다. 설치 수와 카테고리는 그 시점 값입니다.
- 과업 분류 평가 표본: WildChat-1M(Allen Institute for AI, ODC-BY). 표본 원문은 저장소에 넣지 않습니다.
- 임베딩 모델: intfloat/multilingual-e5-small(Xenova ONNX 변환).

개인 대화 내보내기 파일은 `exports/`에 두며 저장소에 올리지 않습니다.

## 라이선스

코드와 문서는 [MIT 라이선스](LICENSE)입니다. `catalog/sources/`와 `web/public/plugins-*.json`의 플러그인 이름·설명은 각 제작자의 것이며, 외부 데이터셋과 모델은 각자의 라이선스를 따릅니다.
