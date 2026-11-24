package dev.relog.history;

import dev.relog.auth.UserAccount;
import jakarta.persistence.*;

import java.time.Instant;

/** analysis_record: 분석 회차 기록(전후 비교용). 요약 숫자와 추천 항목 이름뿐, 대화 내용 컬럼은 없다. */
@Entity
@Table(name = "analysis_record", uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "platform", "lastAt"}))
public class AnalysisRecordEntity {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @ManyToOne(optional = false, fetch = FetchType.LAZY) @JoinColumn(name = "user_id")
    public UserAccount user;
    @Column(nullable = false, length = 16)
    public String platform; // chatgpt | claude
    public long savedAt; // 분석한 시각(ms)
    public long firstAt; // 그 내보내기의 가장 이른·늦은 내 메시지 시각(ms)
    public long lastAt;
    @Column(nullable = false, length = 200)
    public String versionKey;
    public Integer conversations; // 2026-11-24부터. 예전 기록은 비어 있다(열 추가 때 기존 행이 있어도 되게 null 허용)
    public Integer userTurns;
    public Integer longConversations;
    public int judgeable; // 예전(다시 말한 지시) 숫자. 새 기록은 0
    public int high;
    public int tokenEstimate;
    @Column(length = 2000)
    public String rx; // JSON 배열: 추천한 catalogId
    @Column(length = 2000)
    public String plugins; // JSON 배열: 추천한 플러그인 이름
    @Column(length = 4000)
    public String applied; // JSON 배열: 적용함으로 표시한 항목 키
    @Column(length = 6000)
    public String tasks; // JSON 객체: 항목 키 → 겨냥한 대화 종류
    @Column(nullable = false)
    public Instant updatedAt = Instant.now();
}
