package dev.relog.recommend;

import dev.relog.catalog.CatalogItem;
import dev.relog.catalog.CatalogService;
import dev.relog.common.Json;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/** 웹 eval/test_parser.mjs의 처방 테스트와 같은 스냅샷·기대값. 두 구현이 같은 결과를 내야 한다. */
class RecommendEngineTest {
    static List<CatalogItem> items;

    @BeforeAll
    static void load() throws Exception {
        try (var in = new ClassPathResource("catalog/catalog.json").getInputStream()) {
            items = Json.MAPPER.readValue(in, CatalogService.CatalogFile.class).items();
        }
    }

    static RecommendEngine.Snapshot snap() {
        Map<String, Double> share = new HashMap<>(Map.of("coding", 0.1, "writing", 0.3, "learning", 0.05, "workdoc", 0.2, "search", 0.05, "ideation", 0.1, "translation", 0.05, "counseling", 0.15));
        return new RecommendEngine.Snapshot("claude", share, 500, 15, 0.5, 33, 0,
                new RecommendEngine.Restatement(1, 20, 2, 10, 60, Map.of("workdoc", 8), 8000, 16));
    }

    @Test
    void catalogIsVerifiedEnough() {
        long verified = items.stream().filter(CatalogItem::verified).count();
        assertTrue(verified >= 15, "verified " + verified);
        assertTrue(items.stream().filter(i -> i.verified() && !i.category().equals("practice")).allMatch(i -> !i.evidenceUrl().isBlank() && !i.verifiedAt().isBlank()));
    }

    @Test
    void recommendsUpToThreeWithNumbersAndNoBannedWords() {
        var r = RecommendEngine.recommend(snap(), new RecommendEngine.Context("pro", Set.of()), Map.of(), items);
        assertTrue(r.size() >= 1 && r.size() <= 3);
        assertTrue(r.stream().allMatch(p -> p.why().matches(".*\\d.*")), "why에 수치");
        assertTrue(r.stream().noneMatch(p -> (p.why() + p.what() + p.how() + p.caveat()).matches(".*(낭비|잊었|확실히 개선).*")));
        assertEquals("핵심", r.get(0).grade());
        Map<String, Long> cats = new HashMap<>();
        r.forEach(p -> cats.merge(p.category(), 1L, Long::sum));
        assertTrue(cats.values().stream().allMatch(n -> n <= 2), "category당 최대 2");
        // 웹 테스트와 같은 1순위(pr_pin_requirements: 높음 1 + 중간 20 + priority 95)
        assertEquals("pr_pin_requirements", r.get(0).catalogId());
    }

    @Test
    void alreadyUsingFeedbackExcludesItem() {
        var first = RecommendEngine.recommend(snap(), new RecommendEngine.Context("pro", Set.of()), Map.of(), items).get(0).catalogId();
        var again = RecommendEngine.recommend(snap(), new RecommendEngine.Context("pro", Set.of()), Map.of(first, "already_using"), items);
        assertTrue(again.stream().noneMatch(p -> p.catalogId().equals(first)));
    }

    @Test
    void filtersByPlanAndPlatform() {
        var sc = RecommendEngine.scoreAll(snap(), new RecommendEngine.Context("free", Set.of()), Map.of(), items);
        assertTrue(sc.stream().filter(s -> s.item().id().equals("cl_chat_search")).findFirst().orElseThrow().excluded().startsWith("요금제"));
        assertEquals("플랫폼 불일치", sc.stream().filter(s -> s.item().id().equals("cg_projects")).findFirst().orElseThrow().excluded());
        assertTrue(sc.stream().anyMatch(s -> "미검증".equals(s.excluded())));
    }

    @Test
    void noProblemSignalsMeansReferenceGradeOnly() {
        var calm = new RecommendEngine.Snapshot("claude", snap().taskShare(), 500, 15, 0, 3, 0,
                new RecommendEngine.Restatement(0, 0, 0, 0, 0, Map.of(), 0, 0));
        var r = RecommendEngine.recommend(calm, new RecommendEngine.Context("pro", Set.of()), Map.of(), items);
        assertTrue(r.stream().allMatch(p -> p.grade().equals("참고")));
        assertEquals(3, RecommendEngine.genericDefaults("claude", items).size());
    }
}
