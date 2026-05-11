package org.arguslog.sdk;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

public final class Scrubber {

  private static final String REDACTED = "[Filtered]";

  private static final List<Pattern> DEFAULT =
      List.of(
          Pattern.compile("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"),
          Pattern.compile("\\b(?:\\d[ -]*?){13,19}\\b"),
          Pattern.compile("\\beyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_./+=-]*\\b"),
          Pattern.compile("\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b"),
          Pattern.compile("(?i)\\bBearer\\s+[A-Za-z0-9._~+/=-]+"));

  private final List<Pattern> patterns;
  private final boolean enabled;

  public Scrubber(boolean enabled, List<Pattern> extraPatterns) {
    this.enabled = enabled;
    List<Pattern> all = new ArrayList<>(DEFAULT);
    all.addAll(extraPatterns);
    this.patterns = List.copyOf(all);
  }

  public String scrub(String input) {
    if (!enabled || input == null) return input;
    String out = input;
    for (Pattern p : patterns) {
      out = p.matcher(out).replaceAll(REDACTED);
    }
    return out;
  }
}
