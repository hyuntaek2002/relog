package dev.relog.snapshot;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/** 웹 compareTasks 와 같은 결과가 나오는지: 이전 2주 vs 최근 1주, 표본 부족은 비율을 비운다. */
class TrendServiceTest {
    private static final long W = 7L * 86400000L;

    @Test
    @SuppressWarnings("unchecked")
    void comparesBeforeAndRecentWeeks() {
        var weeks = List.of(
                new TrendService.Week(3 * W, 4 * W, Map.of("coding", 10, "writing", 2), Map.of("coding", 1), 1), // 최근
                new TrendService.Week(W, 2 * W, Map.of("coding", 10, "writing", 3), Map.of("coding", 4), 4),
                new TrendService.Week(2 * W, 3 * W, Map.of("coding", 10), Map.of("coding", 2, "writing", 1), 3));
        Map<String, Object> out = TrendService.compare(weeks, 1, 5);
        assertEquals(List.of(W, 3 * W), out.get("beforeRange"));
        assertEquals(List.of(3 * W, 4 * W), out.get("afterRange"));
        var rows = (List<Map<String, Object>>) out.get("rows");
        assertEquals("coding", rows.get(0).get("task"), "메시지가 많은 종류가 먼저");
        var coding = rows.get(0);
        assertEquals(30.0, (Double) ((Map<String, Object>) coding.get("before")).get("ratio"), 1e-9); // 6/20
        assertEquals(10.0, (Double) ((Map<String, Object>) coding.get("after")).get("ratio"), 1e-9);  // 1/10
        assertEquals(-20.0, (Double) coding.get("delta"), 1e-9);
        var writing = rows.get(1);
        assertNull(((Map<String, Object>) writing.get("after")).get("ratio"), "최근 2개뿐 → 표본 부족");
        assertNull(writing.get("delta"));
        var total = (Map<String, Object>) out.get("total");
        assertEquals(100.0 * 7 / 23, (Double) ((Map<String, Object>) total.get("before")).get("ratio"), 1e-9); // 메시지 23개 중 7건
    }

    @Test
    void emptyHasNoRanges() {
        Map<String, Object> out = TrendService.compare(List.of(), 2, 5);
        assertNull(out.get("beforeRange"));
        assertNull(out.get("afterRange"));
    }
}
