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
