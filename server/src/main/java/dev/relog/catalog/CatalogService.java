package dev.relog.catalog;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import dev.relog.common.Json;
import jakarta.annotation.PostConstruct;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.util.List;

/** 카탈로그 단일 원본(/catalog/catalog.json)을 읽어 테이블에 넣고 메모리에 보관한다. */
@Service
public class CatalogService {
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record CatalogFile(String catalogVersion, List<CatalogItem> items) {}

    private final FeatureCatalogRepository repo;
    private CatalogFile catalog;

    public CatalogService(FeatureCatalogRepository repo) { this.repo = repo; }

    @PostConstruct
    @Transactional
    public void load() throws IOException {
        try (var in = new ClassPathResource("catalog/catalog.json").getInputStream()) {
            catalog = Json.MAPPER.readValue(in, CatalogFile.class);
        }
        for (CatalogItem it : catalog.items()) {
            FeatureCatalogEntity e = repo.findById(it.id()).orElseGet(FeatureCatalogEntity::new);
            e.id = it.id(); e.platform = it.platform(); e.name = it.name(); e.category = it.category();
            e.verified = it.verified(); e.priority = it.priority(); e.catalogVersion = catalog.catalogVersion();
            e.json = Json.write(it); e.updatedAt = java.time.Instant.now();
            repo.save(e);
        }
    }

    public String version() { return catalog.catalogVersion(); }
    public List<CatalogItem> items() { return catalog.items(); }
    public List<CatalogItem> verified() { return catalog.items().stream().filter(CatalogItem::verified).toList(); }
}
