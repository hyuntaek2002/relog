package dev.relog.feedback;

import dev.relog.auth.UserAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface FeedbackRepository extends JpaRepository<FeedbackEntity, Long> {
    List<FeedbackEntity> findByUserOrderByCreatedAtAsc(UserAccount user);
    void deleteByUser(UserAccount user);
}
