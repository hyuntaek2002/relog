package dev.relog.snapshot;

import dev.relog.auth.UserAccount;
import jakarta.persistence.*;

import java.time.Instant;

/**
 * usage_snapshot: 기간(주)별 집계. upsert 키 = (user, periodStart, versionKey).
 * 숫자와 열거형만 있다. 대화 원문·발화·임베딩이 들어갈 컬럼 자체가 없다.
 */
@Entity
@Table(name = "usage_snapshot", uniqueConstraints = @UniqueConstraint(name = "uk_snapshot", columnNames = { "user_id", "periodStart", "versionKey" }))
public class UsageSnapshotEntity {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @ManyToOne(optional = false, fetch = FetchType.LAZY) @JoinColumn(name = "user_id")
    public UserAccount user;
    @Column(nullable = false, length = 16)
    public String platform;
    @Column(nullable = false)
    public long periodStart; // epoch ms, 주 시작
    @Column(nullable = false)
    public long periodEnd;
    @Column(nullable = false, length = 200)
    public String versionKey; // parser|normalizer|model|classifier|detector
    @Column(length = 400)
    public String analysisVersion; // 전체 AnalysisVersion JSON(카탈로그·규칙 버전 포함)
    public int userTurnCount;
    public int okCount;
    public int judgeable;
    public int conversationCount;
    public int longConversationCount;
    public int codeCount;
    @Column(length = 400)
    public String taskCounts; // {"coding":12,...}
    @Column(length = 200)
    public String hourHistogram; // [24]
    @Column(nullable = false)
    public Instant updatedAt = Instant.now();
}
