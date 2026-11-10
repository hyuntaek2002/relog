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
}
