package dev.relog.history;

import dev.relog.auth.BearerTokenFilter;
import dev.relog.auth.UserAccount;
import dev.relog.common.Json;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** 분석 기록: 같은 (user, platform, lastAt)은 같은 내보내기라 덮어쓴다. 사용자당 최근 100개만 남긴다. */
@RestController
@RequestMapping("/api/records")
public class AnalysisRecordController {
    public record RecordDto(@Positive long savedAt, @NotBlank @Pattern(regexp = "chatgpt|claude") String platform,
                            @Positive long firstAt, @Positive long lastAt,
                            @NotBlank @Size(max = 200) @Pattern(regexp = "[\\w.|@/+-]+") String versionKey,
                            @Min(0) int judgeable, @Min(0) int high, @Min(0) int tokenEstimate,
                            @NotNull @Size(max = 20) List<@NotBlank @Pattern(regexp = "[a-z0-9_.-]{1,64}") String> rx,
                            @NotNull @Size(max = 20) List<@NotBlank @Pattern(regexp = "[^<>\\p{Cntrl}]{1,80}") String> plugins) {}

    private static final int MAX_PER_USER = 100;
    private final AnalysisRecordRepository repo;

    public AnalysisRecordController(AnalysisRecordRepository repo) { this.repo = repo; }

    @PutMapping
    @Transactional
    public Map<String, Boolean> upsert(@RequestBody @Valid RecordDto d) {
        UserAccount me = BearerTokenFilter.current();
        if (d.lastAt() < d.firstAt()) throw new IllegalArgumentException("lastAt은 firstAt보다 작을 수 없음");
        var e = repo.findByUserAndPlatformAndLastAt(me, d.platform(), d.lastAt()).orElseGet(AnalysisRecordEntity::new);
        e.user = me; e.platform = d.platform(); e.savedAt = d.savedAt(); e.firstAt = d.firstAt(); e.lastAt = d.lastAt();
        e.versionKey = d.versionKey(); e.judgeable = d.judgeable(); e.high = d.high(); e.tokenEstimate = d.tokenEstimate();
        e.rx = Json.write(d.rx()); e.plugins = Json.write(d.plugins()); e.updatedAt = Instant.now();
        repo.save(e);
        var all = repo.findByUserOrderByLastAtAsc(me);
        if (all.size() > MAX_PER_USER) repo.deleteAll(all.subList(0, all.size() - MAX_PER_USER));
        return Map.of("saved", true);
    }

    @GetMapping
    @Transactional(readOnly = true)
    public List<RecordDto> list() {
        UserAccount me = BearerTokenFilter.current();
        return repo.findByUserOrderByLastAtAsc(me).stream().map(e -> new RecordDto(e.savedAt, e.platform, e.firstAt, e.lastAt, e.versionKey,
                e.judgeable, e.high, e.tokenEstimate, strings(e.rx), strings(e.plugins))).toList();
    }

    @DeleteMapping
    @Transactional
    public Map<String, Long> deleteAll() {
        return Map.of("deleted", repo.deleteByUser(BearerTokenFilter.current()));
    }

    private static List<String> strings(String json) {
        try { return json == null ? List.of() : List.of(Json.MAPPER.readValue(json, String[].class)); } catch (RuntimeException ex) { return List.of(); }
    }
}
