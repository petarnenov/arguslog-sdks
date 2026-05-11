package org.arguslog.sdk;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class ScrubberTest {

  @Test
  void redactsEmailsAndJwts() {
    Scrubber s = new Scrubber(true, List.of());
    assertThat(s.scrub("contact pesho@example.com")).isEqualTo("contact [Filtered]");
    String jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc";
    assertThat(s.scrub("token=" + jwt)).isEqualTo("token=[Filtered]");
  }

  @Test
  void leavesContentWhenDisabled() {
    Scrubber s = new Scrubber(false, List.of());
    assertThat(s.scrub("a@b.com")).isEqualTo("a@b.com");
  }

  @Test
  void appliesExtraPatterns() {
    Scrubber s = new Scrubber(true, List.of(Pattern.compile("SECRET-\\w+")));
    assertThat(s.scrub("hello SECRET-XYZ world")).isEqualTo("hello [Filtered] world");
  }
}
