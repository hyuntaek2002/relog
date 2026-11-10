package dev.relog.feedback;

import dev.relog.auth.UserAccount;
import jakarta.persistence.*;

import java.time.Instant;

/** feedback: 도움됨 / 아님 / 이미 씀, 그리고 A/B 관련성 점수. */
@Entity
@Table(name = "feedback")
public class FeedbackEntity {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @ManyToOne(optional = false, fetch = FetchType.LAZY) @JoinColumn(name = "user_id")
    public UserAccount user;
    @Column(nullable = false, length = 64)
    public String catalogId;
    @Column(name = "fb_value", nullable = false, length = 16) // value는 SQL 예약어
    public String value; // helpful | not_helpful | already_using | ab_score
    @Column(length = 16)
    public String source; // generic | personalized | both (A/B일 때)
    public Integer abScore; // 1~5
    public Integer abOrder;
    @Column(nullable = false)
    public Instant createdAt = Instant.now();
}
