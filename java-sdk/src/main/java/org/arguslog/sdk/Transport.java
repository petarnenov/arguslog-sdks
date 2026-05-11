package org.arguslog.sdk;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

final class Transport {

  private final HttpClient http;
  private final Dsn dsn;
  private final boolean debug;

  Transport(Dsn dsn, boolean debug) {
    this.dsn = dsn;
    this.debug = debug;
    this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
  }

  void send(String body) {
    try {
      HttpRequest request =
          HttpRequest.newBuilder(URI.create(dsn.ingestUrl()))
              .timeout(Duration.ofSeconds(5))
              .header("Content-Type", "application/json")
              .header("X-Arguslog-Auth", "Arguslog DSN " + dsn.publicKey())
              .POST(HttpRequest.BodyPublishers.ofString(body))
              .build();
      HttpResponse<Void> response = http.send(request, HttpResponse.BodyHandlers.discarding());
      if (debug && response.statusCode() >= 300) {
        System.err.println("[arguslog] non-2xx response: " + response.statusCode());
      }
    } catch (Exception e) {
      // SDKs must never crash host apps
      if (debug) {
        System.err.println("[arguslog] transport error: " + e.getMessage());
      }
    }
  }
}
