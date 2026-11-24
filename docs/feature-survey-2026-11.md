# Claude·ChatGPT 기능 조사 (2026-11-24)

relog 추천 카탈로그(catalog-0.4.1, 32개 항목)에 넣을 후보를 찾으려고 Claude 앱, ChatGPT 앱, Claude Code, Codex의 기능을 조사했다.
기능마다 공식 도움말·문서 URL을 근거로 달았고, 공식 근거를 못 찾은 것은 "미확인"으로 따로 두었다. 인기 정도는 GitHub 스타 수·설치 수(조사 시점 값, 계속 바뀜)로 적었다.
도움 정도는 "같은 지시를 다시 말하는 일을 줄이는 데 얼마나 직접 도움이 되는가"(상/중/하)다. 1절 정정과 2절의 도움 '상' 항목은 catalog-0.5.0에 반영했다(2026-11-24). 다만 ChatGPT Dots(일부 Plus 사용자에게 점진 배포)와 참조 이미지 저장(공식 문서에서 확인 못 함)은 넣지 않았고, ChatGPT 스킬은 공식 문서대로 업무용 요금제(Business 등) 전용으로 넣었다.

- 조사 방법: 제품별로 나눠 웹 검색과 공식 문서(support.claude.com, code.claude.com/docs, help.openai.com, learn.chatgpt.com/docs)를 확인했다. 놀라운 주장 3개(캔버스 종료, GPTs 종료 안내, Claude 개인 설정 이름 변경)는 공식 페이지 원문을 다시 열어 확인했다.
- 한계: 요금제·사용처가 문서에 없으면 "미명시"로 두었다. 롤아웃·지역에 따라 다를 수 있다.

## 1. 지금 카탈로그에서 바로 고칠 것

| 항목 | 고칠 내용 | 근거 |
|---|---|---|
| cg_canvas 캔버스 | GPT-5.5부터 캔버스를 쓸 수 없다. 글·코드는 대화 안의 writing blocks / code blocks로 바뀌었다(유료는 레거시 모델에서 한시 사용). 항목을 내리거나 Writing blocks로 바꾼다 | https://help.openai.com/en/articles/9624314-model-release-notes |
| cg_voice 음성 모드 | 이름이 ChatGPT Voice(Live)로 정리되고, Advanced·Standard 음성은 12/11 종료 | https://help.openai.com/en/articles/20001274-chatgpt-voice |
| cl_preferences 개인 응답 설정 | 공식 이름이 "Instructions for Claude"(설정의 Instructions)로 바뀌었다. 안내 경로·이름 수정 | https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features |
| cl_styles 스타일(미검증) | 스타일이 스킬로 옮겨지는 중이고 기존 도움말은 404. 미검증 상태로 두거나 삭제 | 검색 결과 제목 "Styles are moving to skills" |
| cg_plugins 플러그인 | ChatGPT에서도 Skills가 별도 기능으로 생겼다(아래 2-2). Custom GPTs는 12/11 종료 예정이라, GPTs 관련 안내가 생기면 플러그인·스킬로 이전을 권한다 | https://help.openai.com/articles/20001519 |

## 2. 새로 넣을 우선 후보 (도움 "상" 위주)

### 2-1. Claude 앱

| 기능 | 하는 일 | 요금제 | 도움 | 근거 |
|---|---|---|---|---|
| Import and export memory | 다른 AI(예: ChatGPT)의 기억을 가져오거나 Claude 기억을 내보냄(실험) | 전체 | 상: 쌓아 둔 선호를 한 번에 이전 | https://support.claude.com/en/articles/12123587-import-and-export-your-memory-from-claude |
| Organization instructions | 관리자가 조직 전체 대화에 공통 지시(3,000자) | Team/Ent | 상: 팀 공통 규칙 고정 | https://support.claude.com/en/articles/14546867-set-organization-instructions |
| Project sharing | 프로젝트 지시·지식을 팀원과 공유 | Team/Ent | 중: 같은 지시를 팀이 같이 씀 | https://support.claude.com/en/articles/9519189-manage-project-visibility-and-sharing.md |
| Claude Design 디자인 시스템 | 브랜드 색·글꼴 규칙을 저장해 디자인 작업에 계속 적용 | 전체 | 중: 브랜드 규칙 반복 제거 | https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design.md |
| Claude for Excel/PowerPoint/Word/Outlook | 오피스 앱 간 맥락 전달, 스킬 공유 | Pro/Max/Team/Ent | 중: 앱 사이 재설명 감소 | https://claude.com/docs/office-agents/work-across-apps |
| Claude Tag (Slack) | Slack에서 @Claude, 채널 정보를 기억(베타) | Team/Ent | 중: 채널 맥락 기억 | https://support.claude.com/en/articles/15594475-what-is-claude-tag |
| Context window compaction | 긴 대화를 자동 요약해 이어 감 | 미명시 | 중: 새 대화에서 재설명 감소 | https://support.claude.com/en/articles/12138966-release-notes |

### 2-2. ChatGPT 앱

| 기능 | 하는 일 | 요금제 | 도움 | 근거 |
|---|---|---|---|---|
| Skills | 지시·예시·코드를 묶은 재사용 작업 흐름, 필요할 때 자동 호출 | Free~Pro, Business/Ent(베타) | 상: 반복 절차를 저장 | https://help.openai.com/articles/20001066 |
| Plugin Creator | @plugin-creator로 내 플러그인을 만들고 공유 | Go~Enterprise | 상: 내 지시를 묶어 저장 | https://help.openai.com/en/articles/20001256-plugins-in-chatgpt-and-codex |
| Personality | 기본 말투 프리셋(Efficient, Professional 등) | 전체 | 상: 말투 요청 반복 제거 | https://help.openai.com/en/articles/11899719-customizing-your-chatgpt-personality |
| Characteristics | 따뜻함·제목/목록·이모지 사용량을 하나씩 조절 | 전체 | 상: "목록 빼줘" 반복 제거 | https://help.openai.com/en/articles/20001038-characteristics-in-chatgpt |
| Project-only memory | 프로젝트가 그 안의 대화만 기억 | 전체 | 상: 프로젝트 맥락 분리 | https://help.openai.com/en/articles/10169521-projects-in-chatgpt |
| Saved reference images | 사진을 이름으로 저장하고 @이름으로 다시 씀 | 미명시 | 상: 참조 사진 재업로드 불필요 | https://help.openai.com/en/articles/11084440-images-in-chatgpt |
| Dots | 목표를 맡기면 대화 사이에도 일하는 상시 에이전트, Custom rules와 자체 기억 | Pro, Business, Ent, Plus 일부 | 상: 규칙·기억 지속 | https://help.openai.com/en/articles/20001530-getting-started-with-your-dot |
| Workspace agents | 팀이 만들어 공유하는 에이전트(GPTs 후속) | Business/Ent/Edu | 상: 팀 지시 고정 | https://help.openai.com/en/articles/20001143 |
| Memory sources | 답변에 쓰인 기억·지시를 보여 줌 | Free~Pro | 중: 지시가 적용됐는지 확인 | https://help.openai.com/en/articles/8590148-memory-in-chatgpt |
| Study mode | 질문으로 이끄는 학습 모드, 퀴즈·플래시카드 | 전체 | 중: "단계별로" 반복 감소 | https://help.openai.com/en/articles/11780217-using-study-mode-in-chatgpt |
| Writing blocks / code blocks | 편집 가능한 초안·코드 블록(캔버스 후속) | 미명시 | 중: 부분 수정 지시 감소 | https://help.openai.com/en/articles/20001246-working-with-writing-blocks-and-code-blocks-in-chatgpt |
| Library / Space | 올린 파일 저장·재사용, 페이지·슬라이드 공동 편집 | Library 전체, Space Plus~ | 중: 파일 재업로드 감소 | https://help.openai.com/en/articles/20001052-using-library-to-manage-files-in-chatgpt |
| Search across chats, projects, files | 대화·프로젝트·파일 통합 검색 | 전체 | 중: 예전 지시 찾아 재사용 | https://help.openai.com/en/articles/10056348-finding-your-chats-projects-and-files-in-chatgpt |
| Pinned chats | 자주 쓰는 대화·프로젝트를 고정 | 미명시 | 중: 지시 담긴 대화 재사용 | https://help.openai.com/en/articles/6825453-chatgpt-release-notes |
| Team tasks | 팀 공용 예약·트리거 작업 | Business/Ent | 중: 반복 요청 자동 실행 | https://help.openai.com/en/articles/20001540-creating-and-managing-team-tasks-in-chatgpt |

### 2-3. Claude Code (지금 카탈로그에 항목 없음)

relog는 Claude Code 기록도 분석하지만 카탈로그에는 Claude Code 전용 항목이 없다. 아래는 Claude Code 기록이 있을 때만 내보내는 조건이 필요하다.

| 기능 | 하는 일 | 조건 | 도움 | 근거 |
|---|---|---|---|---|
| CLAUDE.md (+ CLAUDE.local.md) | 세션마다 자동으로 읽는 지속 지시 파일 | 전체 | 상: "항상 X" 규칙 영구화 | https://code.claude.com/docs/en/memory |
| `.claude/rules/` | 파일 경로에 맞을 때만 불러오는 규칙 | 전체 | 상: 폴더·언어별 규칙 자동화 | https://code.claude.com/docs/en/memory |
| 자동 메모리 | 교정·선호를 MEMORY.md에 스스로 기록(기본 켜짐) | 전체 | 상: 교정 내용 자동 학습 | https://code.claude.com/docs/en/memory |
| `/init` | 프로젝트를 분석해 CLAUDE.md 생성 | 전체 | 상: 초기 규칙 일괄 작성 | https://code.claude.com/docs/en/commands |
| 스킬 / 사용자 정의 명령 | 반복 프롬프트를 `/이름`으로 저장 | 전체 | 상: 반복 프롬프트 명령화 | https://code.claude.com/docs/en/skills |
| 훅 | 이벤트마다 명령을 실행해 규칙을 강제 | 전체 | 상: 규칙 강제 집행 | https://code.claude.com/docs/en/hooks |
| 출력 스타일 | 말투·길이를 세션 전체에 적용(Concise 등) | 전체 | 상: "짧게" 반복 제거 | https://code.claude.com/docs/en/output-styles |
| `/insights` | 최근 세션을 분석해 문제 지점과 써볼 기능을 보고서로 | 로컬 | 상: 반복 패턴 진단(relog와 비슷) | https://code.claude.com/docs/en/commands |
| claude-md-management 플러그인(공식) | 세션에서 배운 점을 CLAUDE.md에 반영, 품질 감사 | 전체 | 상: 교정 내용 규칙화 | https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-md-management |
| hookify 플러그인(공식) | 대화 패턴을 보고 원치 않는 동작을 막는 훅 생성 | 전체 | 상: 반복 교정을 훅으로 | https://github.com/anthropics/claude-plugins-official/tree/main/plugins/hookify |
| `/fewer-permission-prompts` | 기록을 보고 읽기 전용 명령을 허용 목록에 추가 | 전체 | 중: 같은 승인 반복 제거 | https://code.claude.com/docs/en/commands |
| `/goal`, `/loop` | 조건을 채울 때까지 계속 작업, 주기 반복 | 전체 | 중: "계속해" 반복 제거 | https://code.claude.com/docs/en/goal |
| `/doctor` (지시 파일 감사) | 설치·설정·CLAUDE.md 문제 진단 | 전체 | 중: 지시 품질 개선 | https://code.claude.com/docs/en/commands |

### 2-4. Codex (ChatGPT 기록 사용자에게 Codex 설치 안내와 함께)

| 기능 | 하는 일 | 조건 | 도움 | 근거 |
|---|---|---|---|---|
| AGENTS.md (+ `/init`) | 작업 전 읽는 고정 지시, 전역~하위 폴더 합침 | ChatGPT 전 요금제 | 상: 고정 규칙 | https://learn.chatgpt.com/docs/agent-configuration/agents-md |
| Skills / `$skill-creator` | 반복 절차를 스킬로, 대화로 새 스킬 생성 | 위와 같음 | 상: 반복 지시 스킬화 | https://learn.chatgpt.com/docs/build-skills |
| Hooks | 14개 이벤트에서 스크립트 실행 | 위와 같음 | 상: 규칙 자동 강제 | https://learn.chatgpt.com/docs/hooks |
| Memories | 지난 대화를 로컬 메모리로 만들어 반영(기본 꺼짐) | 일부 지역 제한 | 상: 맥락 자동 이월 | https://learn.chatgpt.com/docs/customization/memories |
| Import from another agent | Claude Code·Cursor 지시·스킬·MCP·훅을 가져옴 | 앱·CLI | 상: 기존 규칙 일괄 이전 | https://learn.chatgpt.com/docs/import |
| Scheduled tasks | 정기 실행, Gmail·Slack·GitHub 이벤트 트리거 | 요금제 제한 | 상: 반복 요청 자동 실행 | https://learn.chatgpt.com/docs/automations |
| Rules (실험) | 명령별 허용·금지 규칙 | 실험 | 중: "이 명령 금지" 고정 | https://learn.chatgpt.com/docs/agent-configuration/rules |

## 3. 많이 쓰이는 스킬·플러그인 (커뮤니티)

| 이름 | 하는 일 | 출처 | 인기 신호(조사 시점) | 카탈로그 |
|---|---|---|---|---|
| superpowers | TDD·계획·디버깅 등 개발 절차 스킬 묶음(Claude Code·Codex) | https://github.com/obra/superpowers | ★ 약 325K | 후보 목록에만 있음 |
| mattpocock/skills (grill-me, handoff, tdd) | 계획 전 질문으로 의도 맞추기, 세션 요약 넘기기 | https://github.com/mattpocock/skills | grill-me 설치 1.6M(skills.sh) | 없음 |
| anthropics/skills | Anthropic 공식 스킬(문서 생성, skill-creator 등) | https://github.com/anthropics/skills | ★ 약 200K | 없음 |
| caveman | 짧은 말투로 토큰 줄이기 | https://github.com/JuliusBrussee/caveman | ★ 약 122K | 있음(cl_plugin_concise) |
| claude-mem | 세션 간 맥락 유지 | https://github.com/thedotmack/claude-mem | ★ 약 119K | 없음 |
| humanizer | AI 티 나는 글 다듬기 | https://github.com/blader/humanizer | ★ 약 73K | 있음(글·문서 카드) |
| Context7 | 최신 라이브러리 문서 조회(MCP) | https://github.com/upstash/context7 | ★ 약 65K, 공식 마켓 Verified | 없음 |
| andrej-karpathy-skills | "먼저 생각, 단순하게, 국소 수정" 지시 파일 | https://github.com/multica-ai/andrej-karpathy-skills | ★ 약 235K | 없음 |
| planning-with-files | 파일로 장기 작업 계획 유지 | https://github.com/OthmanAdi/planning-with-files | ★ 약 28K | 없음 |
| openai/skills: gh-fix-ci, gh-address-comments, yeet | CI 고치기, PR 코멘트 처리, 커밋·PR 한 번에(Codex) | https://github.com/openai/skills | Firecrawl 추천 목록 | 없음 |

스타 수는 조사 에이전트가 GitHub에서 본 값이다. 일부는 매우 커서, 카탈로그에 넣을 때는 다시 확인한다.

## 4. 미확인 (공식 근거 없음)

- Claude: 메시지 편집 시 갈래 화살표, 대화 즐겨찾기, Windows 빠른 실행 단축키, Claude Meetings의 Zoom/Teams 지원
- ChatGPT: 대화 폴더, 저장 프롬프트 라이브러리, 새 데스크톱 앱의 Record, Enterprise 외 요금제의 새 GPT 생성 가능 여부
- Codex: `~/.codex/skills` 경로(공식 문서는 `.agents/skills`)

## 5. 전체 기능 목록 (요약)

### Claude 앱 (조사 69개)
프로젝트·프로젝트 지침·프로젝트 지식(RAG)·Instructions for Claude·메모리·과거 대화 검색·메모리 가져오기/내보내기·조직 지침·스타일(스킬로 이전 중)·스킬·플러그인·플러그인 페이지·조직 스킬 배포·리서치·웹 검색·예약 작업·Cowork(채팅과 통합)·Cowork 프로젝트·Dispatch·커넥터 디렉터리·Google Workspace·Microsoft 365·GitHub 연동·사용자 지정 커넥터(원격 MCP)·대화형 커넥터·도구 접근 방식·데스크톱 확장(로컬 MCP)·Claude in Chrome·내장 브라우저·클라우드 브라우저·컴퓨터 사용·파일 생성(코드 실행)·아티팩트·사용자 지정 시각화·Claude Docs·Slides·Design·Sheets·Whiteboards·Data·Motion·모델/노력/생각 설정·대화 자동 압축·시크릿 대화·음성 모드·받아쓰기·Mac 빠른 실행·iOS 단축어/위젯·Android 위젯·iOS/Android 앱 연동·대화 공유·아티팩트 공유·프로젝트 공유·이름 변경/삭제·데이터 내보내기·사용량 한도/크레딧·Ultra 요금제·월간 회고·휴식 알림·Office 추가 기능·Google 문서 사이드바·Claude Tag·Claude Meetings·개인 재무·Claude Duet·Claude Science·엔터프라이즈 검색·조직 기본 모델·사용량 분석·SSO/SCIM·보안(감사 로그 등)·릴리스 채널·화면/언어 설정

### ChatGPT 앱 (조사 54개, 종료 3개 포함)
프로젝트·프로젝트 지침·프로젝트 전용 메모리·공유 프로젝트·커스텀 지시·Personality·Characteristics·메모리·메모리 출처·임시 대화·Skills·플러그인·Plugin Creator·연결된 앱·사용자 지정 MCP(개발자 모드)·Custom GPTs(12/11 종료 예정)·Workspace agents·Team tasks·예약 작업(이벤트 트리거·공유)·ChatGPT Work(agent 후속)·Dots·딥 리서치·검색·쇼핑 리서치·Study mode·이미지 생성/편집·참조 이미지 저장·파일·오디오 업로드·데이터 분석·Intelligent UI·Writing/code blocks·Space·Library·Sites·Voice(Live)·Live Dictation·Record/Meetings·대화 분기·메시지 편집·공유 링크·대화 고정·잠긴 대화·통합 검색·모델 선택·내장 브라우저·브라우저 확장·클라우드 브라우저·Computer History·Excel/Sheets/Word/PowerPoint·Health·Finances·공개 프로필·Business/Enterprise 관리·Lockdown Mode·Business Hub / 종료: agent mode, 캔버스(GPT-5.5부터), Pulse·그룹 채팅·Atlas

### Claude Code (조사 약 85개)
CLAUDE.md·CLAUDE.local.md·@가져오기·rules·AGENTS.md 읽기·자동 메모리·/memory·/init·/import·스킬·사용자 정의 명령·내장 스킬(/batch, /debug, /loop, /simplify 등)·서브에이전트(+지속 메모리)·포크·훅·출력 스타일·플러그인·마켓플레이스·LSP 플러그인·모드(Mods)·"You should know"·차트 모드·MCP·권한 모드(플랜·오토 등)·/auto-mode-setup·권한 규칙·/fewer-permission-prompts·설정 파일·서버 관리 설정·샌드박스·체크포인트/되감기·/branch·/compact·/context·/btw·백그라운드 작업·/goal·/loop·클라우드 예약(/schedule)·데스크톱 예약·워크트리·에이전트 팀·동적 워크플로·세션 간 메시지·채널·헤드리스(claude -p)·Agent SDK·GitHub Actions·GitLab CI·/code-review·/simplify·/security-review·Ultrareview·Code Review 앱·PR Steward·/ship·Approvals·/autofix-pr·보안 가이드·상태 줄·키 바인딩·아티팩트·웹 세션·Remote Control·세션 공유·데스크톱 Code 탭·VS Code·JetBrains·모바일·Slack·Claude in Chrome·컴퓨터 사용·음성 받아쓰기·빠른 모드·Advisor·Code Mode·모델/노력 설정·CLI 플래그·/insights·/team-onboarding·/doctor·/powerup·/recap·프롬프트 제안·딥 링크·사용량 분석

### Codex (조사 39개)
AGENTS.md·/init·개인화·Skills·$skill-creator·Record & Replay·Custom prompts(지원 중단)·플러그인·codex plugin CLI·MCP·config.toml·설정 프로필·권한 프로필·권한 모드·Auto-review·샌드박스·Rules(실험)·Hooks·Memories·Subagents·다른 에이전트에서 가져오기·슬래시 명령·/goal·resume/fork·codex exec·SDK·App Server·GitHub Action·코드 리뷰·GitHub 연동·Codex Cloud·클라우드 환경·Slack·예약 작업·워크트리·IDE 확장·데스크톱 앱·CLI·웹 검색/컴퓨터 사용/브라우저
