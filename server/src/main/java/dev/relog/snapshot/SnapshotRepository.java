package dev.relog.snapshot;

import dev.relog.auth.UserAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SnapshotRepository extends JpaRepository<UsageSnapshotEntity, Long> {
    Optional<UsageSnapshotEntity> findByUserAndPeriodStartAndVersionKey(UserAccount user, long periodStart, String versionKey);
    List<UsageSnapshotEntity> findByUserOrderByPeriodStartAsc(UserAccount user);
    void deleteByUser(UserAccount user);
}
