package org.arguslog.sdk.logback;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.IThrowableProxy;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.UnsynchronizedAppenderBase;
import org.arguslog.sdk.Arguslog;
import org.arguslog.sdk.ArguslogContext;
import org.arguslog.sdk.Level;

/**
 * Logback {@code AppenderBase} that forwards ERROR (and optionally WARN) level events to the static
 * {@link Arguslog} client. Drop-in: declare the appender in {@code logback-spring.xml} and route
 * the root logger or any chosen logger to it.
 *
 * <p>If the {@link Arguslog} client is not initialized (no {@code arguslog.dsn} property), captures
 * become no-ops — the appender stays in the chain without producing errors at boot.
 *
 * <p>The appender uses {@link UnsynchronizedAppenderBase} so it doesn't take Logback's per-event
 * lock; the SDK's own queue is the serialization point and dropping under contention is preferred
 * to blocking the application thread that emitted the log.
 */
public class ArguslogLogbackAppender extends UnsynchronizedAppenderBase<ILoggingEvent> {

  /** Minimum logback level to forward. Anything below is silently dropped. */
  private String minLevel = "ERROR";

  public void setMinLevel(String minLevel) {
    this.minLevel = minLevel == null ? "ERROR" : minLevel.trim().toUpperCase();
  }

  public String getMinLevel() {
    return minLevel;
  }

  @Override
  protected void append(ILoggingEvent event) {
    if (Arguslog.getClient() == null) return;
    if (!shouldForward(event)) return;

    IThrowableProxy throwable = event.getThrowableProxy();
    if (throwable != null) {
      // Reconstruct the original Throwable's message + stack — Logback strips the live
      // reference by the time the appender fires, so we hand the SDK a synthetic with the
      // same shape. The SDK turns this into the same JSON payload as a real captureException.
      Throwable rebuilt = new ReconstructedThrowable(throwable);
      Arguslog.captureException(rebuilt, ArguslogContext.empty().withLevel(mapLevel(event)));
    } else {
      Arguslog.captureMessage(event.getFormattedMessage(), mapLevel(event));
    }
  }

  private boolean shouldForward(ILoggingEvent event) {
    return event.getLevel().toInt() >= toIntLevel(minLevel);
  }

  private static int toIntLevel(String name) {
    return switch (name) {
      case "TRACE" -> 5000;
      case "DEBUG" -> 10000;
      case "INFO" -> 20000;
      case "WARN" -> 30000;
      default -> 40000; // ERROR is the safe default
    };
  }

  private static Level mapLevel(ILoggingEvent event) {
    return switch (event.getLevel().levelStr) {
      case "ERROR" -> Level.ERROR;
      case "WARN" -> Level.WARNING;
      case "INFO" -> Level.INFO;
      case "DEBUG", "TRACE" -> Level.DEBUG;
      default -> Level.ERROR;
    };
  }

  /**
   * Carries the message + Logback-rendered stack of a {@link IThrowableProxy} into the SDK's
   * existing {@code captureException} path. We override {@code printStackTrace} so the SDK's
   * stack-string serializer reads the same text Logback would have rendered to the console.
   */
  private static final class ReconstructedThrowable extends RuntimeException {
    private final transient String renderedStack;

    ReconstructedThrowable(IThrowableProxy proxy) {
      super(proxy.getMessage(), null, false, false);
      this.renderedStack = proxy.getClassName() + ": " + ThrowableProxyUtil.asString(proxy);
    }

    @Override
    public void printStackTrace(java.io.PrintWriter writer) {
      writer.write(renderedStack);
    }
  }
}
