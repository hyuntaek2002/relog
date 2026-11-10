package dev.relog.catalog;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
public class CatalogController {
    private final CatalogService catalog;

    public CatalogController(CatalogService catalog) { this.catalog = catalog; }

    /** 공개. verified=true 항목만 내보낸다(웹과 같은 규칙). */
    @GetMapping("/api/catalog")
    public Map<String, Object> catalog() {
        return Map.of("catalogVersion", catalog.version(), "items", catalog.verified());
    }

    @GetMapping("/api/health")
    public Map<String, Object> health() { return Map.of("ok", true, "catalogVersion", catalog.version(), "items", List.of(catalog.items().size())); }
}
