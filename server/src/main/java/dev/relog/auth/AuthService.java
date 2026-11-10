package dev.relog.auth;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;

/** 이메일+비밀번호 → 불투명 API 토큰. 토큰은 해시로만 저장. */
@Service
public class AuthService {
    private final UserAccountRepository users;
    private final PasswordEncoder encoder;
    private final SecureRandom random = new SecureRandom();

    public AuthService(UserAccountRepository users, PasswordEncoder encoder) { this.users = users; this.encoder = encoder; }

    @Transactional
    public String register(String email, String password) {
        if (users.findByEmail(email).isPresent()) throw new IllegalArgumentException("이미 등록된 이메일");
        UserAccount u = new UserAccount();
        u.email = email;
        u.passwordHash = encoder.encode(password);
        return issueToken(users.save(u));
    }

    @Transactional
    public String login(String email, String password) {
        UserAccount u = users.findByEmail(email).filter(x -> encoder.matches(password, x.passwordHash))
                .orElseThrow(() -> new IllegalArgumentException("이메일 또는 비밀번호가 맞지 않음"));
        return issueToken(u);
    }

    public Optional<UserAccount> byToken(String token) {
        return users.findByTokenHash(sha256(token));
    }

    private String issueToken(UserAccount u) {
        byte[] b = new byte[32];
        random.nextBytes(b);
        String token = "rlg_" + Base64.getUrlEncoder().withoutPadding().encodeToString(b);
        u.tokenHash = sha256(token);
        users.save(u);
        return token;
    }

    static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
}
