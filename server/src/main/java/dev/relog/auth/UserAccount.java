package dev.relog.auth;

import jakarta.persistence.*;

import java.time.Instant;

/** 서비스 계정. 플랫폼(ChatGPT·Claude) 계정 정보는 어떤 형태로도 저장하지 않는다. */
@Entity
@Table(name = "user_account", indexes = { @Index(name = "ix_user_token", columnList = "tokenHash") })
public class UserAccount {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long id;
    @Column(nullable = false, unique = true, length = 254)
    public String email;
    @Column(nullable = false, length = 100)
    public String passwordHash;
    /** API 토큰의 SHA-256. 원본 토큰은 발급 시 한 번만 응답한다. */
    @Column(length = 64)
    public String tokenHash;
    @Column(nullable = false)
    public Instant createdAt = Instant.now();
}
