# relog server

Spring Boot 4.0 (Java 21), Spring Security, JPA, MySQL 8. 통계·카탈로그·추천·피드백만 다룬다.
대화 원문·임베딩·플랫폼 계정 정보는 어떤 테이블에도 컬럼이 없다. 요청 DTO도 숫자·열거형·버전 문자열뿐이다.

> 브리핑은 Spring Boot 3이었으나 2026-11 기준 start.spring.io가 4.x만 제공하고 3.5는 OSS 지원이 끝나 4.0 GA 라인을 쓴다. Java 21은 그대로.

## 실행
```bash
# MySQL (Docker Desktop 실행 중이어야 함)
cd server && docker compose up -d
./mvnw spring-boot:run

# MySQL 없이 개발 (H2 파일 DB, server/data/)
./mvnw spring-boot:run -Dspring-boot.run.profiles=dev
```
테스트: `./mvnw test` (H2 메모리 DB, `test` 프로필)

## 테이블
user_account · usage_snapshot · restatement_stat · feature_catalog · recommendation · feedback

## API
| 메서드 | 경로 | 인증 | 설명 |
|---|---|---|---|
| POST | /api/auth/register | - | {email, password(8+)} → {token}. 토큰은 해시로만 저장, 한 번만 응답 |
| POST | /api/auth/login | - | → {token} (새 토큰 발급, 이전 토큰 무효) |
| GET | /api/catalog | - | verified 카탈로그 + catalogVersion (`/catalog/catalog.json` 단일 원본) |
| GET | /api/health | - | 상태 |
| PUT | /api/snapshots | Bearer | 주별 스냅샷 배열 upsert. 키 (user, periodStart, versionKey). 같은 기간 재전송 = 덮어쓰기 |
| GET | /api/snapshots | Bearer | 내 스냅샷 전체 |
| POST | /api/recommendations | Bearer | 집계 스냅샷 + {plan, featuresInUse, mode?} → 처방 0~3개(규칙 rec-0.1.0, 웹과 동일). mode=generic/both면 인기 3개도 |
| POST | /api/feedback | Bearer | [{catalogId, value: helpful/not_helpful/already_using/ab_score, source?, abScore?, abOrder?}] |
| GET | /api/feedback | Bearer | 내 피드백 |
| GET | /api/me | Bearer | 계정 요약 |
| DELETE | /api/me | Bearer | 서버 데이터 전부 삭제(스냅샷·통계·추천·피드백·계정) |

인증: `Authorization: Bearer rlg_…`. 세션 없음. CORS는 `relog.cors-origins`(localhost:5173, github.io Pages).

## 원문 미전송 보장 방식
- 스키마: 텍스트 컬럼은 email, 버전 문자열, 카탈로그 JSON, 열거형뿐.
- 입력 검증: 스냅샷 DTO의 모든 맵 키는 과업 유형 열거형으로 제한(`@Pattern`), 값은 정수. 문자열 필드는 길이 제한.
- 웹의 네트워크 감사 패널(?dev=1)로 동기화 요청 본문에 원문 조각이 없는지 재검증한다.
