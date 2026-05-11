package org.arguslog.sdk;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SdkInfoTest {

  @Test
  void versionIsResolvedFromGeneratedResource() {
    // The Gradle generateSdkVersion task writes /org/arguslog/sdk/sdk-version.properties
    // to the main resources at build time, mirroring project.version. We don't pin the
    // exact value (the release workflow rewrites it via -Pversion=<x.y.z>), but the
    // dev fallback ("0.0.0-dev") must never reach a packaged build.
    assertThat(SdkInfo.version()).isNotEqualTo("0.0.0-dev").isNotBlank();
  }

  @Test
  void nameIsStable() {
    assertThat(SdkInfo.NAME).isEqualTo("arguslog.java");
  }
}
