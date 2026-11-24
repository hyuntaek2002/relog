package dev.relog.recommend;

import dev.relog.catalog.CatalogItem;

import java.util.*;
import java.util.stream.Collectors;

/**
 * 처방 규칙(웹 recommend.ts와 같은 규칙, rec-0.2.0).
 *  1) 필터: verified, 플랫폼, 요금제, 사용 중 기능
 *  2) 점수 = Σ 문제 신호 weight×2 + Σ 과업 신호 weight + priority/100 + 피드백(도움됨 +1, 아님 −2)
 *  3) 점수 > 0 & (신호 1개 이상 또는 신호가 아예 없는 '기본 추천' 항목), 상위 3개, category당 최대 2개. 문제 신호 없으면 '참고'.
 */
public final class RecommendEngine {
    public static final String RULE_VERSION = "rec-0.2.0"; // 0.2.0: 다시 말한 지시 신호 제거(2026-11-24), 숫자 근거가 없는 항목은 기본 추천(참고)으로
    public static final String NO_RECOMMENDATION = "지금 데이터로는 추천할 항목이 없습니다. 분석 대화가 더 쌓이면 다시 시도하세요.";

    /** 엔진 입력(웹 UsageSnapshot). 숫자만. */
    public record Snapshot(String platform, Map<String, Double> taskShare, int userTurnCount, int conversationCount,
                           double longConversationShare, double avgTurnsPerConversation, double codeShare, Answer answer) {}
    /** AI 답변 평균 분량(토큰 추정)과 내 메시지 분량 대비 배수 */
    public record Answer(double avgTokens, double ratio) {}
    public record Context(String plan, Set<String> featuresInUse) {}
    public record Scored(CatalogItem item, double score, List<String> problemHits, List<String> taskHits, String excluded) {}
    public record Prescription(String catalogId, String name, String category, String grade, String summary, String why, String what, String how, String caveat, List<String> signalsUsed, double score, String pluginName) {}

    private static final Map<String, String> TASK_LABEL = Map.of("coding", "코딩", "writing", "글·문서", "learning", "정보·학습",
            "ideation", "아이디어·기획", "translation", "번역", "counseling", "상담·대화"); // catalog-0.4.0부터 6가지
    private static final Map<String, String> SIGNAL_LABEL = Map.of("conversationCount", "대화 수",
            "longConversationShare", "긴 대화 비율", "avgTurnsPerConversation", "대화당 평균 발화", "codeShare", "코드 포함 비율",
            "answer.avgTokens", "평균 답변 분량", "answer.ratio", "답변이 내 메시지보다 긴 배수");

    private RecommendEngine() {}

    static double read(Snapshot s, String path) {
        return switch (path) {
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
        String label = SIGNAL_LABEL.getOrDefault(path, path);
        if (path.equals("longConversationShare") || path.equals("codeShare")) return label + " " + Math.round(v * 100) + "%";
        if (path.equals("avgTurnsPerConversation")) return label + " " + String.format(Locale.ROOT, "%.1f", v) + "개";
        if (path.equals("answer.avgTokens")) return label + " " + Math.round(v) + "토큰";
        if (path.equals("answer.ratio")) return label + " " + String.format(Locale.ROOT, "%.1f", v) + "배";
        return label + " " + Math.round(v) + "개";
    }

    public static List<Scored> scoreAll(Snapshot s, Context ctx, Map<String, String> feedback, List<CatalogItem> items) {
        Set<String> inUse = new HashSet<>(ctx.featuresInUse());
        feedback.forEach((id, f) -> { if ("already_using".equals(f)) inUse.add(id); });
        List<Scored> out = new ArrayList<>();
        for (CatalogItem it : items) {
            String excluded = null;
            if (!it.verified()) excluded = "미검증";
            else if (!it.platform().equals("both") && !it.platform().equals(s.platform())) excluded = "플랫폼 불일치";
            else if (it.requiresTool() != null && !ctx.featuresInUse().contains("tool:" + it.requiresTool())) excluded = "도구 미사용";
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
        java.util.function.Predicate<String> hit = prefix -> sc.problemHits().stream().anyMatch(h -> h.startsWith(prefix));
        if (hit.test("긴 대화 비율")) return "대화 " + Math.round(s.longConversationShare() * 100) + "%가 메시지 10개를 넘는 긴 대화입니다.";
        if (hit.test("대화당 평균 발화")) return "대화 하나에 내 메시지가 평균 " + String.format(Locale.ROOT, "%.1f", s.avgTurnsPerConversation()) + "개 오갑니다.";
        if (hit.test("대화 수")) return "대화를 " + s.conversationCount() + "개 열었습니다. 새 대화마다 다시 적는 설정은 한 번만 정해 두면 됩니다.";
        if (hit.test("평균 답변 분량") || hit.test("답변이 내 메시지보다")) return "AI 답변이 평균 " + Math.round(s.answer().avgTokens()) + "토큰으로 내 메시지의 " + Math.round(s.answer().ratio()) + "배입니다.";
        if (hit.test("코드 포함 비율")) return "내 메시지의 " + Math.round(s.codeShare() * 100) + "%에 코드가 들어 있습니다.";
        var top = s.taskShare().entrySet().stream().max(Map.Entry.comparingByValue()).orElse(null);
        if (!sc.taskHits().isEmpty() && top != null && top.getValue() > 0) return TASK_LABEL.getOrDefault(top.getKey(), top.getKey()) + " 대화가 " + Math.round(top.getValue() * 100) + "%로 가장 많습니다.";
        return "기록과 상관없이 누구에게나 권하는 기본 항목입니다.";
    }

    /** howTo의 {plugin} 자리에 가장 많이 한 대화 종류의 항목 이름을 넣는다(웹 fillHow와 동일). */
    private static String fillHow(CatalogItem item, Snapshot s) {
        if (!item.howTo30s().contains("{plugin}")) return item.howTo30s();
        String name = pluginFor(item, s);
        return item.howTo30s().replace("{plugin}", name != null ? name : "내 작업에 맞는 플러그인");
    }

    /** 플러그인 카드가 가리키는 구체 플러그인 이름. 해당 없으면 null(웹의 pluginName과 동일) */
    private static String pluginFor(CatalogItem item, Snapshot s) {
        if (!item.howTo30s().contains("{plugin}")) return null;
        String top = s.taskShare().entrySet().stream().filter(e -> e.getValue() > 0).max(Map.Entry.comparingByValue()).map(Map.Entry::getKey).orElse(null);
        return top != null && item.byTask() != null ? item.byTask().get(top) : null;
    }

    private static String why(Snapshot s, Scored sc) {
        List<String> parts = new ArrayList<>();
        var top = s.taskShare().entrySet().stream().max(Map.Entry.comparingByValue()).orElse(null);
        if (!sc.taskHits().isEmpty()) parts.add(String.join(", ", sc.taskHits()) + "으로 과업 비중이 큼");
        else if (top != null && top.getValue() > 0) parts.add(TASK_LABEL.getOrDefault(top.getKey(), top.getKey()) + " " + Math.round(top.getValue() * 100) + "%가 가장 많음");
        if (!sc.problemHits().isEmpty()) parts.add(String.join(", ", sc.problemHits()));
        if (sc.taskHits().isEmpty() && sc.problemHits().isEmpty()) parts.add("기록의 숫자로 걸린 근거는 없고 기본으로 권하는 항목");
        return String.join(". ", parts) + ".";
    }

    /** 숫자 신호가 아예 없는 항목(누구에게나 맞는 습관·설정)은 기본 추천으로 우선순위 점수만 받는다 */
    static boolean isBaseline(CatalogItem it) { return it.problemSignals().isEmpty() && it.taskSignals().isEmpty(); }

    public static List<Prescription> recommend(Snapshot s, Context ctx, Map<String, String> feedback, List<CatalogItem> items) {
        List<Scored> scored = scoreAll(s, ctx, feedback, items).stream()
                .filter(x -> x.excluded() == null && x.score() > 0 && (!x.problemHits().isEmpty() || !x.taskHits().isEmpty() || isBaseline(x.item())))
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
