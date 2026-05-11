package org.arguslog.sdk;

import java.util.Map;

public record ArguslogContext(
    Level level, Map<String, String> tags, Map<String, Object> extra, String userId) {

  public static ArguslogContext empty() {
    return new ArguslogContext(Level.ERROR, Map.of(), Map.of(), null);
  }

  public ArguslogContext withLevel(Level level) {
    return new ArguslogContext(level, tags, extra, userId);
  }

  public ArguslogContext withTag(String key, String value) {
    java.util.HashMap<String, String> next = new java.util.HashMap<>(tags);
    next.put(key, value);
    return new ArguslogContext(level, Map.copyOf(next), extra, userId);
  }
}
