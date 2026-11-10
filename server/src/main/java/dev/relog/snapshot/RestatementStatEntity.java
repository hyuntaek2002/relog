package dev.relog.snapshot;

import jakarta.persistence.*;

/** restatement_stat: 스냅샷 1개당 반복 지시 의심 집계 1행. */
@Entity
@Table(name = "restatement_stat")
public class RestatementStatEntity {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @OneToOne(optional = false, fetch = FetchType.LAZY) @JoinColumn(name = "snapshot_id", unique = true)
    public UsageSnapshotEntity snapshot;
    public int high;
    public int medium;
    public int low;
    public int tokenEstimate; // 재입력 토큰 추정치
    public double ratio; // R(%)
    public int repeatedQuestion;
    public int misunderstanding;
    @Column(length = 400)
    public String perTask; // {"coding":3,...}
}
