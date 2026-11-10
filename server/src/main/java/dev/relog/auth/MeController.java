package dev.relog.auth;

import dev.relog.feedback.FeedbackRepository;
import dev.relog.recommend.RecommendationRepository;
import dev.relog.snapshot.SnapshotRepository;
import dev.relog.snapshot.RestatementStatRepository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** 서버 데이터 삭제: 사용자의 스냅샷·통계·추천·피드백·계정을 모두 지운다. */
@RestController
public class MeController {
    private final UserAccountRepository users;
    private final SnapshotRepository snapshots;
    private final RestatementStatRepository stats;
    private final RecommendationRepository recommendations;
    private final FeedbackRepository feedback;

    public MeController(UserAccountRepository users, SnapshotRepository snapshots, RestatementStatRepository stats,
                        RecommendationRepository recommendations, FeedbackRepository feedback) {
        this.users = users; this.snapshots = snapshots; this.stats = stats; this.recommendations = recommendations; this.feedback = feedback;
    }

    @GetMapping("/api/me")
    public Map<String, Object> me() {
        UserAccount me = BearerTokenFilter.current();
        return Map.of("email", me.email, "createdAt", me.createdAt.toString(), "snapshots", snapshots.findByUserOrderByPeriodStartAsc(me).size());
    }

    @DeleteMapping("/api/me")
    @Transactional
    public Map<String, Boolean> delete() {
        UserAccount me = BearerTokenFilter.current();
        stats.deleteBySnapshotUser(me);
        snapshots.deleteByUser(me);
        recommendations.deleteByUser(me);
        feedback.deleteByUser(me);
        users.delete(me);
        return Map.of("deleted", true);
    }
}
