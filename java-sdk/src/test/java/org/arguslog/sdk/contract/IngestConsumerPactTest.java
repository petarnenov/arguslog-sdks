package org.arguslog.sdk.contract;

import au.com.dius.pact.consumer.MockServer;
import au.com.dius.pact.consumer.dsl.PactDslJsonArray;
import au.com.dius.pact.consumer.dsl.PactDslJsonBody;
import au.com.dius.pact.consumer.dsl.PactDslWithProvider;
import au.com.dius.pact.consumer.junit5.PactConsumerTestExt;
import au.com.dius.pact.consumer.junit5.PactTestFor;
import au.com.dius.pact.core.model.PactSpecVersion;
import au.com.dius.pact.core.model.RequestResponsePact;
import au.com.dius.pact.core.model.annotations.Pact;
import java.net.URI;
import java.util.Map;
import org.arguslog.sdk.Arguslog;
import org.arguslog.sdk.ArguslogOptions;
import org.arguslog.sdk.Level;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

/**
 * Consumer-side Pact contract for the Java SDK ↔ arguslog-ingest wire format. Producing
 * pacts/arguslog-java-sdk-arguslog-ingest.json on every CI run; the ingest service's
 * IngestProviderPactTest replays it (via {@code @PactFolder("../../pacts")}) to fail loudly the
 * moment the request shape drifts.
 *
 * <p>Two interactions cover the only two SDK code paths that hit ingest: a captured exception (with
 * the {@code stacktrace.raw} string the JVM SDK uses, intentionally different from the browser
 * SDK's structured {@code stacktrace.frames}) and a message-only event. The seeded provider data
 * (project_id=101, public-key-active) is matched verbatim so the pact replays without per-test
 * fixtures.
 */
@ExtendWith(PactConsumerTestExt.class)
@PactTestFor(providerName = "arguslog-ingest", pactVersion = PactSpecVersion.V3)
class IngestConsumerPactTest {

  private static final String PROJECT_ID = "101";
  private static final String PUBLIC_KEY = "public-key-active";

  @AfterEach
  void resetSdk() {
    Arguslog.close();
  }

  @Pact(consumer = "arguslog-java-sdk")
  RequestResponsePact exceptionInteraction(PactDslWithProvider builder) {
    PactDslJsonBody requestBody = new PactDslJsonBody();
    requestBody.stringMatcher("eventId", "^[0-9a-f]{32}$", "aabbccddeeff00112233445566778899");
    requestBody.integerType("timestamp", 1_730_000_000_000L);
    requestBody.stringValue("platform", "java");
    requestBody.stringValue("level", "error");

    PactDslJsonBody sdk = requestBody.object("sdk");
    sdk.stringValue("name", "arguslog.java");
    sdk.stringType("version", "1.0.0");
    sdk.closeObject();

    PactDslJsonBody exception = requestBody.object("exception");
    PactDslJsonArray valuesArray = exception.array("values");
    PactDslJsonBody firstException = valuesArray.object();
    firstException.stringValue("type", "java.lang.RuntimeException");
    firstException.stringValue("value", "boom");
    PactDslJsonBody stacktrace = firstException.object("stacktrace");
    stacktrace.stringType("raw", "java.lang.RuntimeException: boom\n\tat ...");
    stacktrace.closeObject();
    firstException.closeObject();
    valuesArray.closeArray();
    exception.closeObject();

    PactDslJsonBody responseBody =
        new PactDslJsonBody()
            .stringMatcher(
                "eventId",
                "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
                "12a827e7-f71e-4fcd-9ebf-c6ee9847b10f");

    return builder
        .uponReceiving("a RuntimeException captured by the java SDK")
        .path("/api/" + PROJECT_ID + "/events")
        .method("POST")
        .headers(
            Map.of(
                "Content-Type",
                "application/json",
                "X-Arguslog-Auth",
                "Arguslog DSN " + PUBLIC_KEY))
        .body(requestBody)
        .willRespondWith()
        .status(202)
        .headers(Map.of("Content-Type", "application/json"))
        .body(responseBody)
        .toPact();
  }

  @Pact(consumer = "arguslog-java-sdk")
  RequestResponsePact messageInteraction(PactDslWithProvider builder) {
    PactDslJsonBody requestBody = new PactDslJsonBody();
    requestBody.stringMatcher("eventId", "^[0-9a-f]{32}$", "aabbccddeeff00112233445566778899");
    requestBody.integerType("timestamp", 1_730_000_000_000L);
    requestBody.stringValue("platform", "java");
    requestBody.stringValue("level", "warning");
    requestBody.stringValue("message", "config drift detected");

    PactDslJsonBody sdk = requestBody.object("sdk");
    sdk.stringValue("name", "arguslog.java");
    sdk.stringType("version", "1.0.0");
    sdk.closeObject();

    PactDslJsonBody responseBody =
        new PactDslJsonBody()
            .stringMatcher(
                "eventId",
                "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
                "12a827e7-f71e-4fcd-9ebf-c6ee9847b10f");

    return builder
        .uponReceiving("a warning message captured by the java SDK")
        .path("/api/" + PROJECT_ID + "/events")
        .method("POST")
        .headers(
            Map.of(
                "Content-Type",
                "application/json",
                "X-Arguslog-Auth",
                "Arguslog DSN " + PUBLIC_KEY))
        .body(requestBody)
        .willRespondWith()
        .status(202)
        .headers(Map.of("Content-Type", "application/json"))
        .body(responseBody)
        .toPact();
  }

  @Test
  @PactTestFor(pactMethod = "exceptionInteraction")
  void capturesExceptionWithExpectedEnvelope(MockServer mockServer) {
    initSdkAgainst(mockServer);
    Arguslog.captureException(new RuntimeException("boom"));
    waitForDelivery();
  }

  @Test
  @PactTestFor(pactMethod = "messageInteraction")
  void capturesMessageWithExpectedEnvelope(MockServer mockServer) {
    initSdkAgainst(mockServer);
    Arguslog.captureMessage("config drift detected", Level.WARNING);
    waitForDelivery();
  }

  private static void initSdkAgainst(MockServer mockServer) {
    String authority = URI.create(mockServer.getUrl()).getAuthority();
    String dsn = "arguslog://" + PUBLIC_KEY + "@" + authority + "/api/" + PROJECT_ID;
    Arguslog.init(
        ArguslogOptions.builder()
            .dsn(dsn)
            // Scrubbing tweaks the message text and would force the pact to type-match
            // every literal — keep it off for the contract test only.
            .scrubbingEnabled(false)
            .build());
  }

  /**
   * The SDK enqueues onto a bounded queue and a daemon worker drains it. {@code flush()} waits for
   * the queue to empty but not for the in-flight POST; the local mock returns in a couple of
   * millis, so a short additional wait is sufficient for the request to land before the Pact mock
   * server runs its end-of-test verification.
   */
  private static void waitForDelivery() {
    Arguslog.getClient().flush();
    try {
      Thread.sleep(200);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
    }
  }
}
