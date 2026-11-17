package dev.relog.history;

import dev.relog.auth.UserAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AnalysisRecordRepository extends JpaRepository<AnalysisRecordEntity, Long> {
    List<AnalysisRecordEntity> findByUserOrderByLastAtAsc(UserAccount user);
    Optional<AnalysisRecordEntity> findByUserAndPlatformAndLastAt(UserAccount user, String platform, long lastAt);
    long deleteByUser(UserAccount user);
}
