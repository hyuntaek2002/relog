package dev.relog.snapshot;

import dev.relog.auth.BearerTokenFilter;
import dev.relog.auth.UserAccount;
import dev.relog.common.Json;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Comparator;
import java.util.List;
import java.util.Map;

/** 변화 추이 조회. 가장 최근에 올린 분석 버전의 주들만 쓴다(버전이 다른 기간끼리는 비교하지 않음). */
@RestController
public class TrendController {
    private final SnapshotRepository snapshots;
    private final RestatementStatRepository stats;

    public TrendController(SnapshotRepository snapshots, RestatementStatRepository stats) { this.snapshots = snapshots; this.stats = stats; }

    @GetMapping("/api/trend")
    @Transactional(readOnly = true)
    public Map<String, Object> trend(@RequestParam(defaultValue = "2") int recentWeeks, @RequestParam(defaultValue = "5") int minSamples) {
        UserAccount me = BearerTokenFilter.current();
        List<UsageSnapshotEntity> all = snapshots.findByUserOrderByPeriodStartAsc(me);
        String vk = all.stream().max(Comparator.comparing((UsageSnapshotEntity e) -> e.updatedAt)).map(e -> e.versionKey).orElse(null);
        List<TrendService.Week> weeks = all.stream().filter(e -> e.versionKey.equals(vk)).map(e -> {
            var s = stats.findBySnapshot(e).orElse(null);
            return new TrendService.Week(e.periodStart, e.periodEnd, Json.readIntMap(e.taskCounts),
                    s == null ? Map.<String, Integer>of() : Json.readIntMap(s.perTask), s == null ? 0 : s.high + s.medium + s.low);
        }).toList();
        Map<String, Object> out = TrendService.compare(weeks, Math.max(1, Math.min(52, recentWeeks)), Math.max(1, Math.min(1000, minSamples)));
        out.put("versionKey", vk);
        out.put("weeks", weeks.size());
        return out;
    }
}
