package dev.relog.recommend;

import dev.relog.auth.UserAccount;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RecommendationRepository extends JpaRepository<RecommendationEntity, Long> {
    void deleteByUser(UserAccount user);
}
