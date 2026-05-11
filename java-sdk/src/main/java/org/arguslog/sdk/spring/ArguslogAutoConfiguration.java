package org.arguslog.sdk.spring;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.arguslog.sdk.Arguslog;
import org.arguslog.sdk.ArguslogOptions;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@AutoConfiguration
@EnableConfigurationProperties(ArguslogProperties.class)
@ConditionalOnProperty(
    prefix = "arguslog",
    name = "enabled",
    havingValue = "true",
    matchIfMissing = true)
public class ArguslogAutoConfiguration {

  private final ArguslogProperties properties;

  public ArguslogAutoConfiguration(ArguslogProperties properties) {
    this.properties = properties;
  }

  @PostConstruct
  void init() {
    if (properties.getDsn() == null || properties.getDsn().isBlank()) {
      return;
    }
    Arguslog.init(
        ArguslogOptions.builder()
            .dsn(properties.getDsn())
            .environment(properties.getEnvironment())
            .release(properties.getRelease())
            .sampleRate(properties.getSampleRate())
            .maxQueueSize(properties.getMaxQueueSize())
            .scrubbingEnabled(properties.isScrubbing())
            .debug(properties.isDebug())
            .build());
  }

  @PreDestroy
  void shutdown() {
    Arguslog.close();
  }
}
