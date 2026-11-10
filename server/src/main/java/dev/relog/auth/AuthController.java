package dev.relog.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    public record Credentials(@Email @NotBlank String email, @NotBlank @Size(min = 8, max = 128) String password) {}

    private final AuthService auth;

    public AuthController(AuthService auth) { this.auth = auth; }

    @PostMapping("/register")
    public Map<String, String> register(@Valid @RequestBody Credentials c) {
        return Map.of("token", auth.register(c.email(), c.password()));
    }

    @PostMapping("/login")
    public Map<String, String> login(@Valid @RequestBody Credentials c) {
        return Map.of("token", auth.login(c.email(), c.password()));
    }
}
