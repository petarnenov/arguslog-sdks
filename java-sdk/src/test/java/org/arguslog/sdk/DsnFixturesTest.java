package org.arguslog.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

/**
 * Cross-SDK parity test. The canonical fixture lives at scripts/dsn-test-fixtures.json (repo root);
 * the TS and Python SDKs run identical assertions against the same file. Adding an edge case there
 * means all three SDKs run it on next CI; whichever fails the parity check gets fixed. Prevents the
 * "fixed it in TS, forgot Java" drift that bit us 2026-05-09.
 *
 * <p>Path math: Gradle sets cwd = projectDir = java-sdk/, so the repo-relative {@code
 * ../scripts/dsn-test-fixtures.json} resolves regardless of where the test runner sits.
 */
class DsnFixturesTest {

  private static final ObjectMapper MAPPER = new ObjectMapper();

  @TestFactory
  List<DynamicTest> sharedFixtures() throws IOException {
    File fixturesFile = new File("../scripts/dsn-test-fixtures.json");
    JsonNode root = MAPPER.readTree(fixturesFile);
    List<DynamicTest> tests = new ArrayList<>();
    for (JsonNode fx : root) {
      String name = fx.get("name").asText();
      tests.add(DynamicTest.dynamicTest(name, () -> assertFixture(fx)));
    }
    return tests;
  }

  private void assertFixture(JsonNode fx) {
    String dsn = fx.get("dsn").asText();
    boolean valid = fx.get("valid").asBoolean();

    if (!valid) {
      assertThatIllegalArgumentException().isThrownBy(() -> Dsn.parse(dsn));
      return;
    }

    Dsn parsed = Dsn.parse(dsn);
    if (fx.has("scheme")) assertThat(parsed.scheme()).isEqualTo(fx.get("scheme").asText());
    if (fx.has("publicKey")) assertThat(parsed.publicKey()).isEqualTo(fx.get("publicKey").asText());
    if (fx.has("host")) assertThat(parsed.host()).isEqualTo(fx.get("host").asText());
    if (fx.has("projectId")) assertThat(parsed.projectId()).isEqualTo(fx.get("projectId").asText());
    if (fx.has("ingestUrl")) assertThat(parsed.ingestUrl()).isEqualTo(fx.get("ingestUrl").asText());
  }
}
