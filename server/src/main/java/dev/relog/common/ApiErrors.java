package dev.relog.common;

import jakarta.validation.ConstraintViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;

import java.util.Map;

/** 오류 응답에 요청 본문을 되비추지 않는다(집계 숫자뿐이지만 원칙). 검증 실패는 전부 400. */
@RestControllerAdvice
public class ApiErrors {
    @ExceptionHandler(IllegalArgumentException.class)
    ResponseEntity<Map<String, String>> bad(IllegalArgumentException e) { return bad(e.getMessage()); }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, String>> invalid(MethodArgumentNotValidException e) {
        var f = e.getBindingResult().getFieldError();
        return bad(f == null ? "유효하지 않은 요청" : f.getField() + " " + f.getDefaultMessage());
    }

    @ExceptionHandler({ HandlerMethodValidationException.class, ConstraintViolationException.class })
    ResponseEntity<Map<String, String>> invalidBody(Exception e) { return bad("유효하지 않은 요청: 허용되지 않은 키 또는 값"); }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, String>> unreadable(HttpMessageNotReadableException e) { return bad("요청 본문을 읽을 수 없음"); }

    @ExceptionHandler(IllegalStateException.class)
    ResponseEntity<Map<String, String>> state(IllegalStateException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", e.getMessage()));
    }

    private static ResponseEntity<Map<String, String>> bad(String msg) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", msg));
    }
}
