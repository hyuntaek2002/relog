package dev.relog.feedback;

import dev.relog.auth.BearerTokenFilter;
import dev.relog.auth.UserAccount;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/feedback")
public class FeedbackController {
    public record Item(@NotBlank @Size(max = 64) String catalogId,
                       @NotBlank @Pattern(regexp = "helpful|not_helpful|already_using|ab_score") String value,
                       @Pattern(regexp = "generic|personalized|both") String source,
                       @Min(1) @Max(5) Integer abScore, @Min(1) @Max(20) Integer abOrder) {}

    private final FeedbackRepository repo;

    public FeedbackController(FeedbackRepository repo) { this.repo = repo; }

    @PostMapping
    public Map<String, Integer> post(@RequestBody List<@Valid Item> items) {
        UserAccount me = BearerTokenFilter.current();
        if (items.size() > 50) throw new IllegalArgumentException("한 번에 50건까지");
        for (Item i : items) {
            FeedbackEntity e = new FeedbackEntity();
            e.user = me; e.catalogId = i.catalogId(); e.value = i.value(); e.source = i.source(); e.abScore = i.abScore(); e.abOrder = i.abOrder();
            repo.save(e);
        }
        return Map.of("saved", items.size());
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        UserAccount me = BearerTokenFilter.current();
        return repo.findByUserOrderByCreatedAtAsc(me).stream().map(f -> Map.<String, Object>of(
                "catalogId", f.catalogId, "value", f.value, "source", f.source == null ? "" : f.source,
                "abScore", f.abScore == null ? 0 : f.abScore, "createdAt", f.createdAt.toString())).toList();
    }
}
