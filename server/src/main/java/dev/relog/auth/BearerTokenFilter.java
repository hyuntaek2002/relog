package dev.relog.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/** Authorization: Bearer rlg_… 를 사용자로 바꾼다. 세션 없음. */
@Component
public class BearerTokenFilter extends OncePerRequestFilter {
    private final AuthService auth;

    public BearerTokenFilter(AuthService auth) { this.auth = auth; }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain) throws ServletException, IOException {
        String h = req.getHeader("Authorization");
        if (h != null && h.startsWith("Bearer ")) {
            auth.byToken(h.substring(7).trim()).ifPresent(u ->
                    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(u, null, List.of())));
        }
        chain.doFilter(req, res);
    }

    /** 컨트롤러에서 현재 사용자 꺼내기 */
    public static UserAccount current() {
        var a = SecurityContextHolder.getContext().getAuthentication();
        if (a == null || !(a.getPrincipal() instanceof UserAccount u)) throw new IllegalStateException("인증 필요");
        return u;
    }
}
