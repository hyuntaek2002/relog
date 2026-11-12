# 과업 유형 라벨 기준 (v0.1, 2026-11-03)

사용자 발화 1개에 유형 1개(단일 라벨). 발화만 보고 판단하되, 짧아서 판단이 안 되면 같은 대화의 **직전 사용자 발화**까지만 참고한다. 모델 응답은 보지 않는다.

## 8유형

| 코드 | 이름 | 포함 | 경계 |
|---|---|---|---|
| coding | 코딩 | 코드 작성·수정·디버깅·설명, 빌드·환경·명령어, 에러 해결 | 개발 개념을 *배우려는* 질문("TCP가 뭐야")은 learning |
| writing | 글쓰기·교정 | 문장·글 작성, 다듬기, 맞춤법, 톤 변경, 요약, 제목, 창작 | 보고서·메일·제안서 등 업무 목적은 work_doc |
| learning | 학습·설명 | 개념 설명, 문제 풀이, 시험 공부, 정리 요청 | 단일 사실 조회("최저임금 얼마")는 search |
| work_doc | 업무 문서 | 보고서·회의록·제안서·이력서·메일·발표 구성 등 업무/행정 문서 | 문서가 아니라 *기획 자체*면 ideation |
| search | 정보 탐색 | 사실·수치·추천·비교 조회, 최신 정보 | 설명·이해가 목적이면 learning |
| ideation | 아이디어·기획 | 브레인스토밍, 이름·주제 후보, 일정·계획 수립, 전략 | 결과물이 문서 형식이면 work_doc |
| translation | 번역 | 언어 간 번역, 외국어 표현 질문 | 외국어 문법 *학습*은 learning |
| chat | 상담·대화 | 고민·감정·관계·진로 상담, 잡담, 의견 묻기 | 정보 요청이 주면 search |

## 추가 상태
- `other` 기타: 8유형 어디에도 안 맞음(예: 모델 설정 요청, 역할극 지시만).
- `context_required` 문맥 필요: 직전 발화를 봐도 유형을 정할 수 없는 짧은 발화("이거 다시", "그걸로 해").

## 우선 규칙
1. 발화에 요구가 둘이면 **주된 산출물** 기준(예: "번역하고 문법도 설명해줘" → 번역이 산출물이면 translation).
2. 코드 블록이 있어도 요구가 글쓰기면 writing(예: 커밋 메시지 다듬기 → writing 아님, coding. 코드 설명 블로그 글 → writing).
3. 후속 발화("추가로 예외 처리도")는 이전 발화와 같은 유형으로 두되, 그 발화만으로 알 수 있으면 그대로 라벨.

## 파일
- `seed_examples`: `web/src/classify/seed.json` 유형별 15~16개. 분류기 B·C의 기준점. 라벨셋과 겹치지 않게 한다.
- 라벨셋(목표 400건, 대화 단위 240/80/80 분할): `eval/labels/labels.csv` — 열 `conversationId,messageId,type`. 원문은 넣지 않는다(로컬 내보내기 파일에서 messageId로 조회).

## 평가 실행
1. `?dev=1` 과업 라벨링에서 "CSV 내보내기" → `eval/labels/labels.csv` (열: conversationId,messageId,type).
2. 실행:
   ```
   node eval/classify/run_abc.mjs exports/conversations-000.zip eval/labels/labels.csv
   ```
   대화 단위로 240/80/80 비율 분할(결정적 시드) → A(TF-IDF 문자 1~3gram + softmax), B(중심점), C(k-NN), D(임베딩 + 선형, 넷째 방식) 비교. k·기타 임계값은 조정 분할에서 고르고 평가 분할의 Macro F1·유형별 P/R·혼동행렬을 찍는다.
3. 라벨 전 파이프라인 확인: `node eval/classify/run_abc.mjs --smoke` (예시 발화를 모의 라벨로 씀. '예시+학습' 변형은 평가 항목이 예시에 포함돼 수치가 의미 없음).
- `context_required` 라벨은 분류 평가에서 제외. `other`는 예시가 없어 B·C에선 임계값으로만 나온다.

## 공개 데이터 400건 라벨링 순서 (WildChat-1M 한국어 표본)

1. 표본 만들기(이미 있으면 생략): `node eval/classify/sample_wildchat.mjs 400` → `exports/public/wildchat-ko-400.zip`. 같은 seed면 `wildchat-ko-400.ids.json`의 대화 해시와 같은 표본이 나온다(데이터 서버가 일부 쪽을 실패시키면 달라질 수 있어 해시 목록으로 확인).
2. 웹을 띄우고 `http://localhost:5173/?dev=1`에 그 zip을 넣는다.
3. 개발자 패널 → "대화 종류 정답 찍기"에서 영역을 한 번 누른다. 화면에 "AI 제안"이 뜨면 맞을 때 Enter, 아니면 숫자키로 고친다(1~8 유형, 0 기타, c 문맥 필요, ←→ 이동). 진행 상황은 이 브라우저에 저장된다.
4. "CSV 내보내기"로 받은 파일을 `eval/labels/wildchat-ko-400.labels.csv`로 둔다(대화 id·메시지 id·유형만 들어 있어 저장소에 올려도 된다).
5. 비교 실행: `node eval/classify/run_abc.mjs exports/public/wildchat-ko-400.zip eval/labels/wildchat-ko-400.labels.csv`

표본 원문은 타인의 실제 대화라 저장소에 넣지 않는다(ODC-BY, 출처 표기: Allen Institute for AI, WildChat-1M).

## AI 제안(wildchat-ko-400.suggested.csv)

- 표본 406건을 AI(Claude)가 읽고 이 기준서대로 먼저 찍은 것이다. 라벨링 화면이 이 파일을 읽어 제안으로 보여 준다.
- 최종 라벨(`wildchat-ko-400.labels.csv`)은 사람이 제안을 보고 확정한 것이다. 제안을 본 상태의 확인이라 제안 쪽으로 쏠릴 수 있으므로, 보고할 때 "AI 제안 후 사람 확인" 방식임과 제안·최종 라벨의 일치율을 함께 밝힌다.
- ChatGPT 내보내기의 "확실함" 등급 27쌍도 AI가 먼저 찍었다(`pair-chatgpt.suggested.csv`, 반복 지시 17 · 정상 후속 10, 저장소 제외). 그 zip을 넣으면 반복 쌍 화면이 이 27쌍만 보여 준다. 확정한 파일은 `pair-chatgpt.labels.csv`로 두고 `node eval/detect/eval_pairs.mjs exports/<ChatGPT zip> eval/labels/pair-chatgpt.labels.csv`로 평가한다.
- 반복 쌍도 같은 방식이다. `pair-suggested.csv`는 Claude 앱 내보내기의 유사도 상위 100쌍을 AI(Claude)가 읽고 먼저 찍은 것(반복 지시 13 · 재전송/수정 3 · 정상 후속 84)이고, "반복 쌍 정답 찍기" 화면이 제안으로 보여 준다. 파일에는 id와 답만 있지만 본인 대화·메시지의 ID라서 두 파일 모두 저장소에 올리지 않는다(.gitignore). 저장소를 새로 받으면 이 파일이 없고, 그때는 제안 없이 라벨링 화면이 뜬다. 사람이 확정해 내보낸 파일은 `pair-labels.csv`로 두고 `node eval/detect/eval_pairs.mjs`로 평가한다.
- 제안 분포: 학습 106 · 정보 탐색 67 · 번역 64 · 글쓰기 59 · 코딩 31 · 상담 30 · 기타 28 · 문맥 필요 9 · 업무 문서 7 · 기획 5. 업무 문서와 기획은 표본이 적어 유형별 점수가 불안정할 수 있다.

## 표본이 적은 유형 보강(wildchat-ko-rare)

업무 문서(7건)와 기획(5건)은 무작위 표본에 너무 적어 따로 보강한다. 보강분은 학습에만 쓰고 평가에는 넣지 않는다.

1. 큰 표본 받기: `node eval/classify/sample_wildchat.mjs 4000 20261112 --name=pool --exclude=eval/labels/wildchat-ko-400.ids.json` → `exports/public/wildchat-ko-pool.zip`. 이미 뽑은 400 표본의 대화는 뺀다. 2026-11-11 실행에서는 서버가 실패시킨 쪽을 빼고 발화 2,857개를 받았다.
2. 후보 추리기: `node eval/classify/pick_rare.mjs exports/public/wildchat-ko-pool.zip` → 현재 분류기(D)가 업무 문서·기획에 확률 0.2 이상을 준 발화와 그 유형의 낱말이 든 발화(273건).
3. AI(Claude)가 후보를 읽고 업무 문서·기획이 분명한 것만 고른 뒤(36건), 그 발화가 든 대화 33개의 나머지 발화도 함께 찍었다. 합계 71건: 업무 문서 26 · 기획 24 · 문맥 필요 6 · 학습 5 · 상담 4 · 정보 탐색 4 · 글쓰기 1 · 기타 1.
4. 묶기: `node eval/classify/pick_rare.mjs exports/public/wildchat-ko-pool.zip <고른 목록 CSV>` → `exports/public/wildchat-ko-rare.zip`, `wildchat-ko-rare.suggested.csv`(id와 유형만).
5. 사람 확인: `?dev=1`에 `wildchat-ko-rare.zip`을 넣고 "대화 종류 정답 찍기"에서 Enter 또는 숫자키로 확정 → "CSV 내보내기" → `eval/labels/wildchat-ko-rare.labels.csv`.
6. 효과 재기: `node eval/classify/run_abc.mjs exports/public/wildchat-ko-400.zip eval/labels/wildchat-ko-400.labels.csv --cv --extra-zip=exports/public/wildchat-ko-rare.zip --extra-csv=eval/labels/wildchat-ko-rare.labels.csv`
7. 제품 반영: `node eval/classify/build_centroids.mjs exports/public/wildchat-ko-400.zip eval/labels/wildchat-ko-400.labels.csv exports/public/wildchat-ko-rare.zip eval/labels/wildchat-ko-rare.labels.csv`

보고할 때 밝힐 점: 보강분은 무작위 표본이 아니다. 분류기 점수와 낱말로 후보를 추리고 AI가 고른 것을 사람이 확인했다. 그래서 평가(5겹 교차 검증)는 원래의 무작위 표본 395건으로만 하고, 보강분은 각 겹의 학습 쪽에만 더한다.
