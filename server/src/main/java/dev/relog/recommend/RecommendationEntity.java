package dev.relog.recommend;

import dev.relog.auth.UserAccount;
import jakarta.persistence.*;

import java.time.Instant;

/** recommendation: 어떤 처방을 언제 냈는지(평가·추이용). */
@Entity
@Table(name = "recommendation")
public class RecommendationEntity {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @ManyToOne(optional = false, fetch = FetchType.LAZY) @JoinColumn(name = "user_id")
    public UserAccount user;
    @Column(nullable = false, length = 64)
    public String catalogId;
    @Column(nullable = false, length = 8)
    public String grade;
    public double score;
    @Column(length = 600)
    public String signalsUsed; // JSON 배열
    @Column(nullable = false, length = 32)
    public String ruleVersion;
    @Column(nullable = false, length = 32)
    public String catalogVersion;
    @Column(nullable = false)
    public Instant createdAt = Instant.now();
    /** 한 번의 추천 요청에서 나온 처방 묶음 식별자(최근 처방 조회용) */
    @Column(length = 36)
    public String requestId;
    /** 근거 요약(숫자 1~2개가 든 한 줄). 원문 없음 */
    @Column(length = 400)
    public String summary;
    /** 사용법 문장(카탈로그 문구에 플러그인 이름만 채운 것) */
    @Column(length = 1000)
    public String how;
    /** 제시 방식: personalized | generic */
    @Column(length = 16)
    public String presentation;
}
