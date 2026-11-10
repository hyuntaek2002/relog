package dev.relog.snapshot;

import dev.relog.auth.BearerTokenFilter;
import dev.relog.auth.UserAccount;
import dev.relog.common.Json;
import jakarta.validation.Valid;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** 동기화: 같은 (user, periodStart, versionKey)는 덮어쓴다. 다른 버전끼리는 서로 다른 행으로 남겨 비교하지 않는다. */
@RestController
@RequestMapping("/api/snapshots")
public class SnapshotController {
    private final SnapshotRepository snapshots;
    private final RestatementStatRepository stats;

    public SnapshotController(SnapshotRepository snapshots, RestatementStatRepository stats) { this.snapshots = snapshots; this.stats = stats; }

    @PutMapping
    @Transactional
    public Map<String, Object> upsert(@RequestBody List<@Valid SnapshotDto> body) {
        UserAccount me = BearerTokenFilter.current();
        if (body.size() > 520) throw new IllegalArgumentException("한 번에 520주까지");
        int created = 0, updated = 0;
        for (SnapshotDto d : body) {
            if (d.periodEnd() <= d.periodStart()) throw new IllegalArgumentException("periodEnd는 periodStart보다 커야 함");
            String vk = d.analysisVersion().key();
            var existing = snapshots.findByUserAndPeriodStartAndVersionKey(me, d.periodStart(), vk);
            UsageSnapshotEntity e = existing.orElseGet(UsageSnapshotEntity::new);
            if (existing.isPresent()) updated++; else created++;
            e.user = me; e.platform = d.platform(); e.periodStart = d.periodStart(); e.periodEnd = d.periodEnd();
            e.versionKey = vk; e.analysisVersion = Json.write(d.analysisVersion());
            e.userTurnCount = d.userTurnCount(); e.okCount = d.okCount(); e.judgeable = d.judgeable();
            e.conversationCount = d.conversationCount(); e.longConversationCount = d.longConversationCount(); e.codeCount = d.codeCount();
            e.taskCounts = Json.write(d.taskCounts()); e.hourHistogram = Json.write(d.hourHistogram()); e.updatedAt = Instant.now();
            e = snapshots.save(e);
            RestatementStatEntity s = stats.findBySnapshot(e).orElseGet(RestatementStatEntity::new);
            s.snapshot = e; s.high = d.restatement().high(); s.medium = d.restatement().medium(); s.low = d.restatement().low();
            s.tokenEstimate = d.restatement().tokenEstimate(); s.ratio = d.restatement().ratio();
            s.repeatedQuestion = d.restatement().repeatedQuestion(); s.misunderstanding = d.restatement().misunderstanding();
            s.perTask = Json.write(d.restatement().perTask());
            stats.save(s);
        }
        return Map.of("created", created, "updated", updated);
    }

    @GetMapping
    @Transactional(readOnly = true)
    public List<Map<String, Object>> list() {
        UserAccount me = BearerTokenFilter.current();
        return snapshots.findByUserOrderByPeriodStartAsc(me).stream().map(e -> {
            var s = stats.findBySnapshot(e).orElse(null);
            return Map.<String, Object>ofEntries(
                    Map.entry("platform", e.platform), Map.entry("periodStart", e.periodStart), Map.entry("periodEnd", e.periodEnd),
                    Map.entry("versionKey", e.versionKey), Map.entry("userTurnCount", e.userTurnCount), Map.entry("okCount", e.okCount),
                    Map.entry("judgeable", e.judgeable), Map.entry("conversationCount", e.conversationCount),
                    Map.entry("longConversationCount", e.longConversationCount), Map.entry("codeCount", e.codeCount),
                    Map.entry("taskCounts", Json.readIntMap(e.taskCounts)), Map.entry("hourHistogram", Json.readIntArray(e.hourHistogram)),
                    Map.entry("restatement", s == null ? Map.of() : Map.of("high", s.high, "medium", s.medium, "low", s.low, "tokenEstimate", s.tokenEstimate,
                            "ratio", s.ratio, "repeatedQuestion", s.repeatedQuestion, "misunderstanding", s.misunderstanding, "perTask", Json.readIntMap(s.perTask))),
                    Map.entry("updatedAt", e.updatedAt.toString()));
        }).toList();
    }
}
