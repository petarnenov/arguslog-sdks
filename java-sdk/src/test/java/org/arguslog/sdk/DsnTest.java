package org.arguslog.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;

import org.junit.jupiter.api.Test;

class DsnTest {

  @Test
  void parsesProductionDsnAsHttps() {
    Dsn dsn = Dsn.parse("arguslog://abc123@ingest.arguslog.io/api/42");
    assertThat(dsn.publicKey()).isEqualTo("abc123");
    assertThat(dsn.host()).isEqualTo("ingest.arguslog.io");
    assertThat(dsn.projectId()).isEqualTo("42");
    assertThat(dsn.scheme()).isEqualTo("https");
    assertThat(dsn.ingestUrl()).isEqualTo("https://ingest.arguslog.io/api/42/events");
  }

  @Test
  void parsesLoopbackDsnAsHttp() {
    Dsn dsn = Dsn.parse("arguslog://k@localhost:8080/api/1");
    assertThat(dsn.scheme()).isEqualTo("http");
    assertThat(dsn.ingestUrl()).isEqualTo("http://localhost:8080/api/1/events");
  }

  @Test
  void parses127LoopbackAsHttp() {
    Dsn dsn = Dsn.parse("arguslog://k@127.0.0.1:9000/api/7");
    assertThat(dsn.scheme()).isEqualTo("http");
    assertThat(dsn.ingestUrl()).isEqualTo("http://127.0.0.1:9000/api/7/events");
  }

  // RFC1918 + just-outside-the-range cases live in scripts/dsn-test-fixtures.json so all
  // three SDKs run identical assertions; see DsnFixturesTest.

  @Test
  void rejectsLegacyHttpsScheme() {
    assertThatIllegalArgumentException().isThrownBy(() -> Dsn.parse("https://k@host/1"));
  }

  @Test
  void rejectsMissingApiSegment() {
    assertThatIllegalArgumentException().isThrownBy(() -> Dsn.parse("arguslog://k@host/1"));
  }

  @Test
  void rejectsMissingProjectId() {
    assertThatIllegalArgumentException().isThrownBy(() -> Dsn.parse("arguslog://k@host/api/"));
  }

  @Test
  void rejectsMissingPublicKey() {
    assertThatIllegalArgumentException().isThrownBy(() -> Dsn.parse("arguslog://@host/api/1"));
  }
}
