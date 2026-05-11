package org.arguslog.sdk;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicLong;

public final class ArguslogClient implements AutoCloseable {

  private static final AtomicLong THREAD_INDEX = new AtomicLong();
  private static final ThreadFactory FACTORY =
      r -> {
        Thread t = new Thread(r, "arguslog-sender-" + THREAD_INDEX.incrementAndGet());
        t.setDaemon(true);
        return t;
      };

  private final ArguslogOptions options;
  private final Dsn dsn;
  private final Transport transport;
  private final Scrubber scrubber;
  private final BlockingQueue<String> queue;
  private final Thread worker;
  private volatile boolean running = true;

  ArguslogClient(ArguslogOptions options) {
    this.options = options;
    this.dsn = Dsn.parse(options.dsn());
    this.transport = new Transport(dsn, options.debug());
    this.scrubber = new Scrubber(options.scrubbingEnabled(), options.extraScrubPatterns());
    this.queue = new ArrayBlockingQueue<>(options.maxQueueSize());
    this.worker = FACTORY.newThread(this::pump);
    this.worker.start();
  }

  public String captureException(Throwable error, ArguslogContext context) {
    if (!shouldSample()) return null;
    Map<String, Object> event = baseEvent(context == null ? Level.ERROR : context.level());
    event.put("exception", exceptionPayload(error));
    if (context != null) {
      if (!context.tags().isEmpty()) event.put("tags", context.tags());
      if (!context.extra().isEmpty()) event.put("extra", context.extra());
      if (context.userId() != null) event.put("user", Map.of("id", context.userId()));
    }
    enqueue(event);
    return (String) event.get("eventId");
  }

  public String captureMessage(String message, Level level) {
    if (!shouldSample()) return null;
    Map<String, Object> event = baseEvent(level == null ? Level.INFO : level);
    event.put("message", scrubber.scrub(message));
    enqueue(event);
    return (String) event.get("eventId");
  }

  public void flush() {
    long deadlineMillis = System.currentTimeMillis() + options.flushTimeout().toMillis();
    while (!queue.isEmpty() && System.currentTimeMillis() < deadlineMillis) {
      try {
        Thread.sleep(20);
      } catch (InterruptedException ie) {
        Thread.currentThread().interrupt();
        return;
      }
    }
  }

  @Override
  public void close() {
    flush();
    running = false;
    worker.interrupt();
  }

  private boolean shouldSample() {
    double rate = options.sampleRate();
    if (rate >= 1.0) return true;
    if (rate <= 0.0) return false;
    return Math.random() < rate;
  }

  private Map<String, Object> baseEvent(Level level) {
    Map<String, Object> event = new LinkedHashMap<>();
    event.put("eventId", UUID.randomUUID().toString().replace("-", ""));
    event.put("timestamp", Instant.now().toEpochMilli());
    event.put("platform", "java");
    event.put("level", level.toWire());
    event.put("sdk", Map.of("name", SdkInfo.NAME, "version", SdkInfo.version()));
    if (options.environment() != null) event.put("environment", options.environment());
    if (options.release() != null) event.put("release", options.release());
    return event;
  }

  private Map<String, Object> exceptionPayload(Throwable error) {
    StringWriter sw = new StringWriter();
    error.printStackTrace(new PrintWriter(sw));
    return Map.of(
        "values",
        java.util.List.of(
            Map.of(
                "type", error.getClass().getName(),
                "value", scrubber.scrub(error.getMessage() == null ? "" : error.getMessage()),
                "stacktrace", Map.of("raw", sw.toString()))));
  }

  private void enqueue(Map<String, Object> event) {
    String body = JsonEncoder.encode(event);
    if (!queue.offer(body)) {
      // Drop on overflow — never block the host application
      if (options.debug()) {
        System.err.println("[arguslog] queue full, dropping event");
      }
    }
  }

  private void pump() {
    while (running) {
      try {
        String body = queue.take();
        transport.send(body);
      } catch (InterruptedException ie) {
        Thread.currentThread().interrupt();
        return;
      } catch (Throwable t) {
        if (options.debug()) {
          System.err.println("[arguslog] pump error: " + t.getMessage());
        }
      }
    }
    // Drain on shutdown
    String remaining;
    while ((remaining = queue.poll()) != null) {
      transport.send(remaining);
    }
  }
}
