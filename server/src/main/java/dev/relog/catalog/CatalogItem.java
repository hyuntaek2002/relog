package dev.relog.catalog;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/** /catalog/catalog.json 한 항목. 웹의 CatalogItem과 같은 모양. */
@JsonIgnoreProperties(ignoreUnknown = true)
public record CatalogItem(
        String id, String platform, String name, String category, String oneLiner, String howTo30s,
        List<String> requiresPlan, HardExclude hardExclude, List<ProblemSignal> problemSignals, List<TaskSignal> taskSignals,
        int priority, String evidenceUrl, String verifiedAt, boolean verified, boolean isPopularDefault, String caveat) {
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record HardExclude(List<String> featuresInUse) {}
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ProblemSignal(String signal, String op, double value, double weight) {}
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record TaskSignal(String task, double minShare, double weight) {}
}
