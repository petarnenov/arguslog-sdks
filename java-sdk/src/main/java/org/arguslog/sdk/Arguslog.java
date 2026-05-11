package org.arguslog.sdk;

import java.util.Objects;

/** Static-facing facade around the configured {@link ArguslogClient}. */
public final class Arguslog {

  private static volatile ArguslogClient client;

  private Arguslog() {}

  public static synchronized void init(ArguslogOptions options) {
    Objects.requireNonNull(options, "options");
    if (client != null) {
      client.close();
    }
    client = new ArguslogClient(options);
  }

  public static ArguslogClient getClient() {
    return client;
  }

  public static String captureException(Throwable error) {
    return client == null ? null : client.captureException(error, null);
  }

  public static String captureException(Throwable error, ArguslogContext context) {
    return client == null ? null : client.captureException(error, context);
  }

  public static String captureMessage(String message, Level level) {
    return client == null ? null : client.captureMessage(message, level);
  }

  public static void close() {
    if (client != null) {
      client.close();
      client = null;
    }
  }
}
