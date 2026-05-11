package org.arguslog.sdk;

import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

public final class ArguslogOptions {

  private final String dsn;
  private final String environment;
  private final String release;
  private final double sampleRate;
  private final int maxQueueSize;
  private final Duration flushTimeout;
  private final boolean scrubbingEnabled;
  private final List<Pattern> extraScrubPatterns;
  private final boolean debug;

  private ArguslogOptions(Builder b) {
    this.dsn = Objects.requireNonNull(b.dsn, "dsn");
    this.environment = b.environment;
    this.release = b.release;
    this.sampleRate = b.sampleRate;
    this.maxQueueSize = b.maxQueueSize;
    this.flushTimeout = b.flushTimeout;
    this.scrubbingEnabled = b.scrubbingEnabled;
    this.extraScrubPatterns = List.copyOf(b.extraScrubPatterns);
    this.debug = b.debug;
  }

  public String dsn() {
    return dsn;
  }

  public String environment() {
    return environment;
  }

  public String release() {
    return release;
  }

  public double sampleRate() {
    return sampleRate;
  }

  public int maxQueueSize() {
    return maxQueueSize;
  }

  public Duration flushTimeout() {
    return flushTimeout;
  }

  public boolean scrubbingEnabled() {
    return scrubbingEnabled;
  }

  public List<Pattern> extraScrubPatterns() {
    return extraScrubPatterns;
  }

  public boolean debug() {
    return debug;
  }

  public static Builder builder() {
    return new Builder();
  }

  public static final class Builder {
    private String dsn;
    private String environment;
    private String release;
    private double sampleRate = 1.0d;
    private int maxQueueSize = 256;
    private Duration flushTimeout = Duration.ofSeconds(2);
    private boolean scrubbingEnabled = true;
    private List<Pattern> extraScrubPatterns = List.of();
    private boolean debug = false;

    public Builder dsn(String dsn) {
      this.dsn = dsn;
      return this;
    }

    public Builder environment(String environment) {
      this.environment = environment;
      return this;
    }

    public Builder release(String release) {
      this.release = release;
      return this;
    }

    public Builder sampleRate(double rate) {
      if (rate < 0 || rate > 1) {
        throw new IllegalArgumentException("sampleRate must be in [0,1]");
      }
      this.sampleRate = rate;
      return this;
    }

    public Builder maxQueueSize(int size) {
      if (size <= 0) {
        throw new IllegalArgumentException("maxQueueSize must be > 0");
      }
      this.maxQueueSize = size;
      return this;
    }

    public Builder flushTimeout(Duration timeout) {
      this.flushTimeout = Objects.requireNonNull(timeout);
      return this;
    }

    public Builder scrubbingEnabled(boolean enabled) {
      this.scrubbingEnabled = enabled;
      return this;
    }

    public Builder extraScrubPatterns(List<Pattern> patterns) {
      this.extraScrubPatterns = List.copyOf(patterns);
      return this;
    }

    public Builder debug(boolean debug) {
      this.debug = debug;
      return this;
    }

    public ArguslogOptions build() {
      return new ArguslogOptions(this);
    }
  }
}
