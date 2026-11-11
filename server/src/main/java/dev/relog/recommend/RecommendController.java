package dev.relog.recommend;

import dev.relog.auth.BearerTokenFilter;
import dev.relog.auth.UserAccount;
import dev.relog.catalog.CatalogService;
import dev.relog.common.Json;
import dev.relog.feedback.FeedbackEntity;
import dev.relog.feedback.FeedbackRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/recommendations")
public class RecommendController {

    /** 요청: 집계 스냅샷 + 체크리스트. 원문 없음. */
    public record Request(
            @NotBlank @Pattern(regexp = "chatgpt|claude") String platform,
            @NotNull Map<@Pattern(regexp = "coding|writing|learning|workdoc|search|ideation|translation|counseling") String, @DecimalMin("0") @DecimalMax("1") Double> taskShare,
            @Min(0) int userTurnCount, @Min(0) int conversationCount,
            @DecimalMin("0") @DecimalMax("1") double longConversationShare, @DecimalMin("0") double avgTurnsPerConversation, @DecimalMin("0") @DecimalMax("1") double codeShare,
            @NotNull @Valid Restatement restatement,
            @Valid Answer answer,
            @NotBlank @Size(max = 16) String plan,
            @NotNull List<@Size(max = 64) String> featuresInUse,
            @Pattern(regexp = "generic|personalized|both") String mode) {
        public record Restatement(@Min(0) int high, @Min(0) int mid, @Min(0) int low, @Min(0) int misunderstanding, @Min(0) int repeatedQuestion,
                                  @NotNull Map<@Pattern(regexp = "coding|writing|learning|workdoc|search|ideation|translation|counseling") String, @Min(0) Integer> perTask,
                                  @Min(0) int tokenEstimate, @DecimalMin("0") @DecimalMax("100") double ratio) {}
        public record Answer(@DecimalMin("0") double avgTokens, @DecimalMin("0") double ratio) {}
    }

    private final CatalogService catalog;
    private final RecommendationRepository repo;
    private final FeedbackRepository feedback;

    public RecommendController(CatalogService catalog, RecommendationRepository repo, FeedbackRepository feedback) { this.catalog = catalog; this.repo = repo; this.feedback = feedback; }

    @PostMapping
    @Transactional
    public Map<String, Object> recommend(@Valid @RequestBody Request r) {
        UserAccount me = BearerTokenFilter.current();
        var snap = new RecommendEngine.Snapshot(r.platform(), r.taskShare(), r.userTurnCount(), r.conversationCount(), r.longConversationShare(),
                r.avgTurnsPerConversation(), r.codeShare(), new RecommendEngine.Restatement(r.restatement().high(), r.restatement().mid(), r.restatement().low(),
                r.restatement().misunderstanding(), r.restatement().repeatedQuestion(), r.restatement().perTask(), r.restatement().tokenEstimate(), r.restatement().ratio()),
                r.answer() == null ? new RecommendEngine.Answer(0, 0) : new RecommendEngine.Answer(r.answer().avgTokens(), r.answer().ratio()));
        // 사용자의 최근 피드백(항목당 마지막 값)
        Map<String, String> fb = new HashMap<>();
        for (FeedbackEntity f : feedback.findByUserOrderByCreatedAtAsc(me)) fb.put(f.catalogId, f.value);
        var ctx = new RecommendEngine.Context(r.plan(), new HashSet<>(r.featuresInUse()));
        List<RecommendEngine.Prescription> personalized = RecommendEngine.recommend(snap, ctx, fb, catalog.items());
        for (var p : personalized) {
            RecommendationEntity e = new RecommendationEntity();
            e.user = me; e.catalogId = p.catalogId(); e.grade = p.grade(); e.score = p.score(); e.signalsUsed = Json.write(p.signalsUsed());
            e.ruleVersion = RecommendEngine.RULE_VERSION; e.catalogVersion = catalog.version();
            repo.save(e);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ruleVersion", RecommendEngine.RULE_VERSION);
        out.put("catalogVersion", catalog.version());
        out.put("prescriptions", personalized);
        if (personalized.isEmpty()) out.put("message", RecommendEngine.NO_RECOMMENDATION);
        if ("generic".equals(r.mode()) || "both".equals(r.mode())) out.put("generic", RecommendEngine.genericDefaults(r.platform(), catalog.items()));
        return out;
    }
}
