package org.arguslog.sdk;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

/**
 * Single source of truth for the SDK identity stamped on every event payload. The value is read
 * from a Gradle-generated {@code sdk-version.properties} that mirrors {@code project.version}, so
 * the runtime tag and the published Maven coordinate can never drift.
 */
final class SdkInfo {

  static final String NAME = "arguslog.java";

  private static final String VERSION = loadVersion();

  private SdkInfo() {}

  static String version() {
    return VERSION;
  }

  private static String loadVersion() {
    try (InputStream in =
        SdkInfo.class.getResourceAsStream("/org/arguslog/sdk/sdk-version.properties")) {
      if (in == null) {
        return "0.0.0-dev";
      }
      Properties props = new Properties();
      props.load(in);
      String value = props.getProperty("version");
      return value == null || value.isBlank() ? "0.0.0-dev" : value;
    } catch (IOException e) {
      return "0.0.0-dev";
    }
  }
}
