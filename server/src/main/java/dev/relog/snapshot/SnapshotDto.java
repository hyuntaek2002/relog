package dev.relog.snapshot;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;

import java.util.Map;
import java.util.Set;

/**
 * 동기화 요청 본문. 필드가 전부 숫자·열거형·버전 문자열이라 원문이 들어올 자리가 없다.
 * 웹의 PeriodSnapshot(store/ledger.ts)과 1:1.
 */
public record SnapshotDto(
        @NotBlank @Pattern(regexp = "chatgpt|claude") String platform,
        @Positive long periodStart,
        @Positive long periodEnd,
        @NotNull @Valid AnalysisVersion analysisVersion,
        @Min(0) int userTurnCount,
        @Min(0) int okCount,
        @Min(0) int judgeable,
        @Min(0) int conversationCount,
        @Min(0) int longConversationCount,
        @Min(0) int codeCount,
        @NotNull Map<@Pattern(regexp = "coding|writing|learning|work_doc|search|ideation|translation|chat|other") String, @Min(0) Integer> taskCounts,
        @NotNull @Size(min = 24, max = 24) int[] hourHistogram,
        @NotNull @Valid Restatement restatement) {

    public record AnalysisVersion(
            @NotBlank @Size(max = 40) String parserVersion, @NotBlank @Size(max = 40) String normalizerVersion,
            @NotBlank @Size(max = 80) String modelVersion, @NotBlank @Size(max = 40) String classifierVersion,
            @NotBlank @Size(max = 40) String detectorVersion, @NotBlank @Size(max = 40) String catalogVersion,
            @NotBlank @Size(max = 40) String recommendationRuleVersion) {
        public String key() { return String.join("|", parserVersion, normalizerVersion, modelVersion, classifierVersion, detectorVersion); }
    }

    public record Restatement(
            @Min(0) int high, @Min(0) int medium, @Min(0) int low, @Min(0) int tokenEstimate,
            @DecimalMin("0") @DecimalMax("100") double ratio, @Min(0) int repeatedQuestion, @Min(0) int misunderstanding,
            @NotNull Map<@Pattern(regexp = "coding|writing|learning|work_doc|search|ideation|translation|chat|other") String, @Min(0) Integer> perTask) {}

    public static final Set<String> TASKS = Set.of("coding", "writing", "learning", "work_doc", "search", "ideation", "translation", "chat", "other");
}
