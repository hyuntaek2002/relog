package dev.relog.snapshot;

import dev.relog.auth.UserAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface RestatementStatRepository extends JpaRepository<RestatementStatEntity, Long> {
    Optional<RestatementStatEntity> findBySnapshot(UsageSnapshotEntity snapshot);
    void deleteBySnapshotUser(UserAccount user);
}
