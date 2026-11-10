package dev.relog.catalog;

import jakarta.persistence.*;

import java.time.Instant;

/** feature_catalog: catalog.json을 기동 시 upsert. 조회 API는 이 테이블에서 낸다. */
@Entity
@Table(name = "feature_catalog")
public class FeatureCatalogEntity {
    @Id @Column(length = 64)
    public String id;
    @Column(nullable = false, length = 16)
    public String platform;
    @Column(nullable = false, length = 100)
    public String name;
    @Column(nullable = false, length = 16)
    public String category;
    public boolean verified;
    public int priority;
    @Column(nullable = false, length = 32)
    public String catalogVersion;
    @Column(nullable = false, columnDefinition = "text") // @Lob String은 MySQL에서 tinytext(255)로 잡히는 문제가 있어 명시
    public String json; // 항목 전체(JSON)
    @Column(nullable = false)
    public Instant updatedAt = Instant.now();
}
