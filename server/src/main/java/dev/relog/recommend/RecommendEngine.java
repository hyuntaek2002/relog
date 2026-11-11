package dev.relog.recommend;

import dev.relog.catalog.CatalogItem;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 처방 규칙(웹 recommend.ts와 같은 규칙, rec-0.1.0).
 *  1) 필터: verified, 플랫폼, 요금제, 사용 중 기능
 *  2) 점수 = Σ 문제 신호 weight×2 + Σ 과업 신호 weight + priority/100 + 피드백(도움됨 +1, 아님 −2)
 *  3) 점수 > 0 & 신호 1개 이상, 상위 3개, category당 최대 2개. 문제 신호 없으면 '참고'.
 */
public final class RecommendEngine {
    public static final String RULE_VERSION = "rec-0.1.1"; // 0.1.1: restatement.perTask.<task> 신호(대화 종류 집중) 지원
    public static final String NO_RECOMMENDATION = "지금 데이터로는 추천할 항목이 없습니다. 분석 대화가 더 쌓이면 다시 시도하세요.";

    /** 엔진 입력(웹 UsageSnapshot). 숫자만. */
    public record Snapshot(String platform, Map<String, Double> taskShare, int userTurnCount, int conversationCount,
                           double longConversationShare, double avgTurnsPerConversation, double codeShare, Restatement restatement, Answer answer) {}
    /** AI 답변 평균 분량(토큰 추정)과 내 메시지 분량 대비 배수 */
    public record Answer(double avgTokens, double ratio) {}
    public record Restatement(int high, int mid, int low, int misunderstanding, int repeatedQuestion, Map<String, Integer> perTask, int tokenEstimate, double ratio) {}
    public record Context(String plan, Set<String> featuresInUse) {}
    public record Scored(CatalogItem item, double score, List<String> problemHits, List<String> taskHits, String excluded) {}
    public record Prescription(String catalogId, String name, String category, String grade, String summary, String why, String what, String how, String caveat, List<String> signalsUsed, double score, String pluginName) {}

    private static final Map<String, String> TASK_LABEL = Map.of("coding", "코딩", "writing", "글쓰기·교정", "learning", "학습·설명", "workdoc", "업무 문서",
            "search", "정보 탐색", "ideation", "아이디어·기획", "translation", "번역", "counseling", "상담·대화");
    private static final Map<String, String> SIGNAL_LABEL = Map.of("restatement.high", "다시 말한 지시(확실함)", "restatement.mid", "다시 말한 지시(가능성 있음)",
            "restatement.low", "다시 말한 지시(약함)", "restatement.misunderstanding", "말이 안 통한 듯한 표현", "restatement.repeatedQuestion", "비슷한 질문 다시 함",
            "longConversationShare", "긴 대화 비율", "avgTurnsPerConversation", "대화당 평균 발화", "codeShare", "코드 포함 비율",
            "answer.avgTokens", "평균 답변 분량", "answer.ratio", "답변이 내 메시지보다 긴 배수");

    private RecommendEngine() {}

    static double read(Snapshot s, String path) {
        if (path.startsWith("restatement.perTask.")) return s.restatement().perTask().getOrDefault(path.substring(20), 0);
        return switch (path) {
            case "restatement.high" -> s.restatement().high();
            case "restatement.mid" -> s.restatement().mid();
            case "restatement.low" -> s.restatement().low();
            case "restatement.misunderstanding" -> s.restatement().misunderstanding();
            case "restatement.repeatedQuestion" -> s.restatement().repeatedQuestion();
            case "restatement.tokenEstimate" -> s.restatement().tokenEstimate();
            case "restatement.ratio" -> s.restatement().ratio();
            case "longConversationShare" -> s.longConversationShare();
            case "avgTurnsPerConversation" -> s.avgTurnsPerConversation();
            case "codeShare" -> s.codeShare();
            case "answer.avgTokens" -> s.answer() == null ? 0 : s.answer().avgTokens();
            case "answer.ratio" -> s.answer() == null ? 0 : s.answer().ratio();
            case "userTurnCount" -> s.userTurnCount();
            case "conversationCount" -> s.conversationCount();
            default -> 0;
        };
    }

    private static boolean cmp(double a, String op, double b) {
        return switch (op) { case ">=" -> a >= b; case ">" -> a > b; case "<=" -> a <= b; case "<" -> a < b; default -> false; };
    }

    private static String fmtSignal(String path, double v) {
        if (path.startsWith("restatement.perTask.")) return TASK_LABEL.getOrDefault(path.substring(20), path.substring(20)) + " 대화에서 다시 말한 지시 " + Math.round(v) + "건";
        String label = SIGNAL_LABEL.getOrDefault(path, path);
        if (path.equals("longConversationShare") || path.equals("codeShare")) return label + " " + Math.round(v * 100) + "%";
        if (path.equals("avgTurnsPerConversation")) return label + " " + String.format(Locale.ROOT, "%.1f", v) + "개";
        if (path.equals("answer.avgTokens")) return label + " " + Math.round(v) + "토큰";
        if (path.equals("answer.ratio")) return label + " " + String.format(Locale.ROOT, "%.1f", v) + "배";
        return label + " " + Math.round(v) + "건";
    }

    public static List<Scored> scoreAll(Snapshot s, Context ctx, Map<String, String> feedback, List<CatalogItem> items) {
        Set<String> inUse = new HashSet<>(ctx.featuresInUse());
        feedback.forEach((id, f) -> { if ("already_using".equals(f)) inUse.add(id); });
        List<Scored> out = new ArrayList<>();
        for (CatalogItem it : items) {
            String excluded = null;
            if (!it.verified()) excluded = "미검증";
            else if (!it.platform().equals("both") && !it.platform().equals(s.platform())) excluded = "플랫폼 불일치";
            else if (!it.requiresPlan().isEmpty() && !it.requiresPlan().contains(ctx.plan())) excluded = "요금제 미지원(" + String.join("/", it.requiresPlan()) + ")";
            else if (inUse.contains(it.id()) || it.hardExclude().featuresInUse().stream().anyMatch(inUse::contains)) excluded = "이미 사용 중";

            List<String> problemHits = new ArrayList<>(), taskHits = new ArrayList<>();
            double score = 0;
            for (var ps : it.problemSignals()) {
                double v = read(s, ps.signal());
                if (cmp(v, ps.op(), ps.value())) { score += ps.weight() * 2; problemHits.add(fmtSignal(ps.signal(), v)); }
            }
            for (var ts : it.taskSignals()) {
                double share = s.taskShare().getOrDefault(ts.task(), 0.0);
                if (share >= ts.minShare()) { score += ts.weight(); taskHits.add(TASK_LABEL.getOrDefault(ts.task(), ts.task()) + " " + Math.round(share * 100) + "%"); }
            }
            score += it.priority() / 100.0;
            String fb = feedback.get(it.id());
            if ("helpful".equals(fb)) score += 1; else if ("not_helpful".equals(fb)) score -= 2;
            out.add(new Scored(it, score, problemHits, taskHits, excluded));
        }
        return out;
    }

    /** 카드 머리말: 가장 강한 신호 하나를 쉬운 문장으로(웹 summaryOf와 동일). */
    private static String summaryOf(Snapshot s, Scored sc) {
        var r = s.restatement();
        var perTaskTop = r.perTask().entrySet().stream().max(Map.Entry.comparingByValue()).orElse(null);
        java.util.function.Predicate<String> hit = prefix -> sc.problemHits().stream().anyMatch(h -> h.startsWith(prefix));
        if (hit.test("다시 말한 지시") && perTaskTop != null && perTaskTop.getValue() >= 3)
            return TASK_LABEL.getOrDefault(perTaskTop.getKey(), perTaskTop.getKey()) + " 대화에서 같은 지시를 " + perTaskTop.getValue() + "번 다시 말했습니다.";
        if (hit.test("다시 말한 지시")) return "같은 지시를 다시 말한 메시지가 " + (r.high() + r.mid()) + "건입니다.";
        if (hit.test("말이 안 통한")) return "AI가 요지를 놓친 듯한 메시지가 " + r.misunderstanding() + "건입니다.";
        if (hit.test("긴 대화 비율")) return "대화 " + Math.round(s.longConversationShare() * 100) + "%가 메시지 10개를 넘는 긴 대화입니다.";
        if (hit.test("비슷한 질문")) return "비슷한 질문을 " + r.repeatedQuestion() + "번 다시 했습니다.";
        if (hit.test("평균 답변 분량") || hit.test("답변이 내 메시지보다")) return "AI 답변이 평균 " + Math.round(s.answer().avgTokens()) + "토큰으로 내 메시지의 " + Math.round(s.answer().ratio()) + "배입니다.";
        var top = s.taskShare().entrySet().stream().max(Map.Entry.comparingByValue()).orElse(null);
        return top != null && top.getValue() > 0 ? TASK_LABEL.getOrDefault(top.getKey(), top.getKey()) + " 대화가 " + Math.round(top.getValue() * 100) + "%로 가장 많습니다." : "최근 대화 패턴 기준 추천입니다.";
    }

    /** howTo의 {plugin} 자리에 다시 말한 지시가 가장 몰린 대화 종류의 항목 이름을 넣는다(웹 fillHow와 동일). */
    private static String fillHow(CatalogItem item, Snapshot s) {
        if (!item.howTo30s().contains("{plugin}")) return item.howTo30s();
        String name = pluginFor(item, s);
        return item.howTo30s().replace("{plugin}", name != null ? name : "내 작업에 맞는 플러그인");
    }

    /** 플러그인 카드가 가리키는 구체 플러그인 이름. 해당 없으면 null(웹의 pluginName과 동일) */
    private static String pluginFor(CatalogItem item, Snapshot s) {
        if (!item.howTo30s().contains("{plugin}")) return null;
        var top = s.restatement().perTask().entrySet().stream().max(Map.Entry.comparingByValue()).orElse(null);
        return top != null && item.byTask() != null ? item.byTask().get(top.getKey()) : null;
    }

    private static String why(Snapshot s, Scored sc) {
        List<String> parts = new ArrayList<>();
        var top = s.taskShare().entrySet().stream().max(Map.Entry.comparingByValue()).orElse(null);
        if (!sc.taskHits().isEmpty()) parts.add(String.join(", ", sc.taskHits()) + "으로 과업 비중이 큼");
        else if (top != null && top.getValue() > 0) parts.add(TASK_LABEL.getOrDefault(top.getKey(), top.getKey()) + " " + Math.round(top.getValue() * 100) + "%가 가장 많음");
        if (!sc.problemHits().isEmpty()) parts.add(String.join(", ", sc.problemHits()));
        var perTaskTop = s.restatement().perTask().entrySet().stream().max(Map.Entry.comparingByValue()).orElse(null);
        if (sc.problemHits().stream().anyMatch(h -> h.contains("다시 말한 지시")) && perTaskTop != null && perTaskTop.getValue() > 0)
            parts.add("다시 말한 지시는 " + TASK_LABEL.getOrDefault(perTaskTop.getKey(), perTaskTop.getKey()) + " 대화에 " + perTaskTop.getValue() + "건으로 몰림");
        return String.join(". ", parts) + ".";
    }

    public static List<Prescription> recommend(Snapshot s, Context ctx, Map<String, String> feedback, List<CatalogItem> items) {
        List<Scored> scored = scoreAll(s, ctx, feedback, items).stream()
                .filter(x -> x.excluded() == null && x.score() > 0 && (!x.problemHits().isEmpty() || !x.taskHits().isEmpty()))
                .sorted(Comparator.comparingDouble(Scored::score).reversed())
                .collect(Collectors.toList());
        List<Prescription> out = new ArrayList<>();
        Map<String, Integer> perCategory = new HashMap<>();
        for (Scored sc : scored) {
            if (out.size() >= 3) break;
            int n = perCategory.getOrDefault(sc.item().category(), 0);
            if (n >= 2) continue;
            perCategory.put(sc.item().category(), n + 1);
            List<String> signals = new ArrayList<>(sc.problemHits()); signals.addAll(sc.taskHits());
            out.add(new Prescription(sc.item().id(), sc.item().name(), sc.item().category(), sc.problemHits().isEmpty() ? "참고" : "핵심",
                    summaryOf(s, sc), why(s, sc), sc.item().oneLiner(), fillHow(sc.item(), s), sc.item().caveat(), signals, Math.round(sc.score() * 100) / 100.0, pluginFor(sc.item(), s)));
        }
        return out;
    }

    public static List<CatalogItem> genericDefaults(String platform, List<CatalogItem> items) {
        return items.stream().filter(i -> i.verified() && i.isPopularDefault() && (i.platform().equals(platform) || i.platform().equals("both"))).limit(3).toList();
    }
}
