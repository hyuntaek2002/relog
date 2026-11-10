package dev.relog.common;

import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

import java.util.Map;

/** 엔티티의 JSON 컬럼(taskCounts, hourHistogram 등) 직렬화 도우미. Spring Boot 4 = Jackson 3(tools.jackson). */
public final class Json {
    public static final ObjectMapper MAPPER = JsonMapper.builder().build();
    private static final TypeReference<Map<String, Integer>> INT_MAP = new TypeReference<>() {};

    private Json() {}

    public static String write(Object o) { return MAPPER.writeValueAsString(o); }

    public static Map<String, Integer> readIntMap(String s) {
        try { return s == null ? Map.of() : MAPPER.readValue(s, INT_MAP); } catch (RuntimeException e) { return Map.of(); }
    }

    public static int[] readIntArray(String s) {
        try { return s == null ? new int[0] : MAPPER.readValue(s, int[].class); } catch (RuntimeException e) { return new int[0]; }
    }
}
