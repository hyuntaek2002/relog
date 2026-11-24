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
                            // 대화·내 메시지·긴 대화 수(2026-11-24부터). judgeable·high·tokenEstimate는 예전 클라이언트(다시 말한 지시)용
                            @Min(0) Integer conversations, @Min(0) Integer userTurns, @Min(0) Integer longConversations,
                            @Min(0) Integer judgeable, @Min(0) Integer high, @Min(0) Integer tokenEstimate,
                            @NotNull @Size(max = 20) List<@NotBlank @Pattern(regexp = "[a-z0-9_.-]{1,64}") String> rx,
                            @NotNull @Size(max = 20) List<@NotBlank @Pattern(regexp = "[^<>\\p{Cntrl}]{1,80}") String> plugins,
                            // 적용함 표시한 항목 키와 항목 → 겨냥한 대화 종류. 예전 클라이언트는 보내지 않으므로 비어도 된다.
                            @Size(max = 40) List<@NotBlank @Pattern(regexp = "[^<>\\p{Cntrl}]{1,80}") String> applied,
                            @Size(max = 60) Map<@Pattern(regexp = "[^<>\\p{Cntrl}]{1,80}") String, @Pattern(regexp = "[a-z]{1,20}") String> tasks) {}

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
        e.versionKey = d.versionKey(); e.conversations = d.conversations(); e.userTurns = d.userTurns(); e.longConversations = d.longConversations();
        e.judgeable = d.judgeable() == null ? 0 : d.judgeable(); e.high = d.high() == null ? 0 : d.high(); e.tokenEstimate = d.tokenEstimate() == null ? 0 : d.tokenEstimate();
        e.rx = Json.write(d.rx()); e.plugins = Json.write(d.plugins());
        e.applied = Json.write(d.applied() == null ? List.of() : d.applied()); e.tasks = Json.write(d.tasks() == null ? Map.of() : d.tasks());
        e.updatedAt = Instant.now();
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
                e.conversations, e.userTurns, e.longConversations, e.judgeable, e.high, e.tokenEstimate, strings(e.rx), strings(e.plugins), strings(e.applied), stringMap(e.tasks))).toList();
    }

    @DeleteMapping
    @Transactional
    public Map<String, Long> deleteAll() {
        return Map.of("deleted", repo.deleteByUser(BearerTokenFilter.current()));
    }

    private static Map<String, String> stringMap(String json) {
        try { return json == null ? Map.of() : Json.MAPPER.readValue(json, new tools.jackson.core.type.TypeReference<Map<String, String>>() {}); } catch (Exception ex) { return Map.of(); }
    }

    private static List<String> strings(String json) {
        try { return json == null ? List.of() : List.of(Json.MAPPER.readValue(json, String[].class)); } catch (RuntimeException ex) { return List.of(); }
    }
}
