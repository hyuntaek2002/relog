package dev.relog.snapshot;

import java.util.*;

/**
 * 변화 추이: 서버에 보관된 주별 집계를 "이전 기간"과 "최근 기간"으로 나눠 대화 종류별 다시 말한 지시 비율을 비교한다.
 * 웹 store/ledger.ts 의 compareTasks·compareSides 와 같은 계산. 집계 숫자만 쓰고 변화의 원인은 판정하지 않는다.
 */
public final class TrendService {
    private TrendService() {}

    /** 한 주의 집계. flaggedAll = 확실함+가능성 있음+약함 */
    public record Week(long periodStart, long periodEnd, Map<String, Integer> taskCounts, Map<String, Integer> perTask, int flaggedAll) {}

    private record Sum(Map<String, Integer> ok, Map<String, Integer> flagged, int okAll, int flaggedAll) {}

    private static Sum sum(List<Week> ws) {
        Map<String, Integer> ok = new HashMap<>(), flagged = new HashMap<>();
        int okAll = 0, flaggedAll = 0;
        for (Week w : ws) {
            for (var e : w.taskCounts().entrySet()) { ok.merge(e.getKey(), e.getValue(), Integer::sum); okAll += e.getValue(); }
            for (var e : w.perTask().entrySet()) flagged.merge(e.getKey(), e.getValue(), Integer::sum);
            flaggedAll += w.flaggedAll();
        }
        return new Sum(ok, flagged, okAll, flaggedAll);
    }

    private static Map<String, Object> side(int ok, int flagged, int minSamples) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", ok); m.put("flagged", flagged);
        m.put("ratio", ok >= minSamples ? 100.0 * flagged / ok : null); // 표본이 모자라면 비율을 비운다
        return m;
    }

    private static Map<String, Object> row(String task, Map<String, Object> before, Map<String, Object> after) {
        Map<String, Object> m = new LinkedHashMap<>();
        Double b = (Double) before.get("ratio"), a = (Double) after.get("ratio");
        m.put("task", task); m.put("before", before); m.put("after", after);
        m.put("delta", b != null && a != null ? a - b : null);
        return m;
    }

    private static List<Long> range(List<Week> ws) {
        return ws.isEmpty() ? null : List.of(ws.get(0).periodStart(), ws.get(ws.size() - 1).periodEnd());
    }

    /** 마지막 recentWeeks 주를 "최근", 그 앞을 "이전"으로 놓는다. */
    public static Map<String, Object> compare(List<Week> weeks, int recentWeeks, int minSamples) {
        List<Week> sorted = new ArrayList<>(weeks);
        sorted.sort(Comparator.comparingLong(Week::periodStart));
        int cut = Math.max(0, sorted.size() - recentWeeks);
        List<Week> before = sorted.subList(0, cut), after = sorted.subList(cut, sorted.size());
        Sum b = sum(before), a = sum(after);
        Set<String> tasks = new TreeSet<>(b.ok().keySet());
        tasks.addAll(a.ok().keySet());
        List<String> ordered = new ArrayList<>(tasks);
        ordered.sort(Comparator.comparingInt((String t) -> -(a.ok().getOrDefault(t, 0) + b.ok().getOrDefault(t, 0))));
        List<Map<String, Object>> rows = new ArrayList<>();
        for (String t : ordered)
            rows.add(row(t, side(b.ok().getOrDefault(t, 0), b.flagged().getOrDefault(t, 0), minSamples), side(a.ok().getOrDefault(t, 0), a.flagged().getOrDefault(t, 0), minSamples)));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("beforeRange", range(before));
        out.put("afterRange", range(after));
        out.put("rows", rows);
        out.put("total", row("all", side(b.okAll(), b.flaggedAll(), minSamples), side(a.okAll(), a.flaggedAll(), minSamples)));
        return out;
    }
}
