package org.arguslog.sdk;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class JsonEncoderTest {

  @Test
  void encodesPrimitives() {
    assertThat(JsonEncoder.encode("hello")).isEqualTo("\"hello\"");
    assertThat(JsonEncoder.encode(42)).isEqualTo("42");
    assertThat(JsonEncoder.encode(true)).isEqualTo("true");
    assertThat(JsonEncoder.encode(null)).isEqualTo("null");
  }

  @Test
  void encodesNestedStructure() {
    String json =
        JsonEncoder.encode(Map.of("a", 1, "b", List.of("x", "y"), "c", Map.of("nested", true)));
    assertThat(json)
        .contains("\"a\":1")
        .contains("\"b\":[\"x\",\"y\"]")
        .contains("\"nested\":true");
  }

  @Test
  void escapesControlCharacters() {
    String json = JsonEncoder.encode("line1\nline2\t\"q\"\\b");
    assertThat(json).isEqualTo("\"line1\\nline2\\t\\\"q\\\"\\\\b\"");
  }
}
