package org.arguslog.sdk;

import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public record Dsn(
    String publicKey, String host, String scheme, String projectId, String ingestUrl) {

  // User-facing DSN format (matches what the api emits in the project-create response and shows
  // in the web UI's "Copy DSN" modal): arguslog://<publicKey>@<host>/api/<projectId>
  // Kept in lockstep with packages/sdk-browser/src/dsn.ts.
  private static final Pattern DSN_RE =
      Pattern.compile("^arguslog://([^@]+)@([^/]+)/api/([^/?#]+)$");

  public static Dsn parse(String raw) {
    Objects.requireNonNull(raw, "dsn");
    Matcher m = DSN_RE.matcher(raw);
    if (!m.matches()) {
      throw new IllegalArgumentException("Invalid DSN: " + raw);
    }
    String publicKey = m.group(1);
    String host = m.group(2);
    String projectId = m.group(3);
    if (publicKey.isEmpty() || host.isEmpty() || projectId.isEmpty()) {
      throw new IllegalArgumentException("Invalid DSN: " + raw);
    }
    String scheme = isDevHost(host) ? "http" : "https";
    String ingestUrl = scheme + "://" + host + "/api/" + projectId + "/events";
    return new Dsn(publicKey, host, scheme, projectId, ingestUrl);
  }

  private static boolean isDevHost(String host) {
    String bare =
        host.startsWith("[") ? host.substring(0, host.indexOf(']') + 1) : host.split(":", 2)[0];
    if (bare.equals("localhost")
        || bare.startsWith("127.")
        || bare.equals("0.0.0.0")
        || bare.equals("[::1]")
        || bare.equals("::1")) {
      return true;
    }
    // RFC1918 private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16. A device on the same
    // LAN pointing at the dev box's LAN IP is still a dev-mode transport; ingest only listens
    // on plain HTTP locally, so an HTTPS upgrade would fail the TLS handshake silently.
    String[] parts = bare.split("\\.");
    if (parts.length != 4) return false;
    int a, b;
    try {
      a = Integer.parseInt(parts[0]);
      b = Integer.parseInt(parts[1]);
      Integer.parseInt(parts[2]);
      Integer.parseInt(parts[3]);
    } catch (NumberFormatException ex) {
      return false;
    }
    if (a == 10) return true;
    if (a == 192 && b == 168) return true;
    if (a == 172 && b >= 16 && b <= 31) return true;
    return false;
  }
}
