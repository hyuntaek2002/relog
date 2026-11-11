# 내보내기 파일 구조 실측

## Claude (2026-11-03, 사용자 본인 파일)
- manifest JSON + zip 4개(light_metadata, projects, frames, conversations). 쓰는 건 `conversations-000.zip` 안 `conversations.json`(10.0MB) 하나.
- 최상위 배열. 대화 키: uuid, name, summary, created_at, updated_at, account, chat_messages.
- 메시지 키: uuid, text, content[], sender(human|assistant), created_at, updated_at, attachments, files, parent_message_uuid. 누락 필드 없음.
- content[].type 분포(1416개 메시지): text 1081, thinking 405, tool_use 397, tool_result 397, injected_prompt_block 40, flag 18, document 13, image 6, token_budget 1.
- **분기 있음**: 3개 대화에서 같은 parent를 가진 형제 메시지 존재. 배열은 시간순이고 마지막 메시지에서 parent_message_uuid를 따라 올라간 경로가 활성. 루트 parent는 `00000000-0000-4000-8000-000000000000`.
- **본문 없는 대화 29/44**: 메시지는 있으나 text·content가 모두 비어 있음(2025-05~2026-11 고르게 분포). 원인 미확인(Claude Code/Cowork 세션 추정). 분석 가능한 대화는 15개.
- 첨부만 있고 텍스트 없는 human 메시지 58개 → 발화에서 제외됨.

### 파서 결과
| 항목 | 값 |
|---|---|
| 대화 | 44 (본문 있는 것 15) |
| 사용자 발화 | 509 |
| 모델 응답 | 507 |
| 긴 대화(사용자 발화 ≥10) | 8 |
| 대화별 사용자 발화 상위 | 214, 96, 63, 38, 22, 16, 16, 12 |
| 사용자 발화 길이 | p10 13자, p50 38자, p90 133자, 최대 2755자 |
| 기간 | 2025-05-15 ~ 2026-11-02 |

## ChatGPT
- 미수령. 수령 시 `node eval/inspect_export.mjs exports/<zip>`로 같은 항목 기록.

## Claude Code 세션 기록 (2026-11-10, 사용자 본인 컴퓨터)
- 앱 내보내기에는 Claude Code 대화가 없다. 기록은 `%USERPROFILE%\.claude\projects\<프로젝트>\<세션>.jsonl`(줄마다 JSON). 실측 16개 프로젝트, 33개 세션 파일, 455MB(대부분 도구 결과). 세션 폴더 안에는 tool-results, custom-title.json이 따로 있다.
- 줄 type 분포(가장 큰 파일 2,679줄): assistant 845, user 588, attachment 415, custom-title 138, bridge-session 138, last-prompt 137, relocated 122, mode 101, queue-operation 42, system 13.
- user 줄 content: 문자열 238, tool_result 배열 1,183, text 배열 16, image+text 13. 사람 입력 판별: isMeta 아님, isSidechain 아님, promptSource≠system, origin.kind가 있으면 human. 래퍼 태그(`<local-command-*>`, `<command-name>`, `<task-notification>`, `<system-reminder>`)는 떼고, `<pasted_content>` 안은 사람 글로 본다.
- assistant 줄은 블록 단위(text 244, thinking 611, tool_use 1,183)라 연속 text 블록을 한 턴으로 합친다. tool_use.name이 도구 이름(Bash·Edit·mcp__…)이라 기능 감지에 쓴다. usage에 input/output_tokens가 있어 답변 분량 측정에 쓸 수 있다(아직 미사용).
- 공통 필드: uuid, parentUuid, timestamp(ISO), sessionId, cwd, gitBranch, version, entrypoint(claude-desktop). 대화 id = sessionId, 제목 = custom-title 줄의 customTitle, 없으면 cwd 마지막 폴더 + "(Claude Code)".
- 설치 플러그인 흔적(2026-11-10 실측, 35파일 중 24파일): type=attachment(63줄)·api-request-blob(25줄)에 "The following skills are available…" 뒤로 "- <플러그인>:<스킬>: 설명" 목록이 들어 있다(unity 486회, engineering 47, cowork-plugin-management 10, product-management 9, design 8, humanizer 1, ponytail 1; anthropic-skills는 내장). 그 밖에 assistant의 tool_use name=Skill, input.skill="<플러그인>:<스킬>"(또는 접두어 없이 "ponytail")이 드물게(9회) 나온다. 파서는 둘을 합쳐 Conversation.pluginNames에 넣고, 추천 화면은 이 이름과 플러그인 표시 이름을 느슨하게(소문자·영숫자, 접두어 일치) 맞춰 "이미 설치됨"으로 표시한다. 앱 내보내기에는 이 흔적이 없다.
- 가져오기: projects 폴더를 zip으로 묶어 앱 내보내기 zip과 함께 넣는다. 워커는 zip을 8MB 조각으로 읽어 항목별 스트리밍 해제하므로 455MB도 통째로 메모리에 올리지 않는다.
- Codex: `%USERPROFILE%\.codex\sessions\<연도>\…` 에 같은 식의 jsonl. ChatGPT 내보내기 도착 시 파서 추가 예정.
