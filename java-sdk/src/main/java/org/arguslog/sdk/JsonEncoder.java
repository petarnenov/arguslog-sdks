package org.arguslog.sdk;

import java.util.List;
import java.util.Map;

/**
 * Minimal dependency-free JSON encoder for the SDK transport. We avoid pulling Jackson into the SDK
 * to keep its footprint tiny and to play nicely with classpath-conflict-prone host apps.
 */
final class JsonEncoder {

  private JsonEncoder() {}

  static String encode(Object value) {
    StringBuilder sb = new StringBuilder();
    write(sb, value);
    return sb.toString();
  }

  private static void write(StringBuilder sb, Object value) {
    if (value == null) {
      sb.append("null");
      return;
    }
    if (value instanceof CharSequence cs) {
      writeString(sb, cs.toString());
      return;
    }
    if (value instanceof Number || value instanceof Boolean) {
      sb.append(value);
      return;
    }
    if (value instanceof Map<?, ?> map) {
      sb.append('{');
      boolean first = true;
      for (Map.Entry<?, ?> entry : map.entrySet()) {
        if (!first) sb.append(',');
        first = false;
        writeString(sb, String.valueOf(entry.getKey()));
        sb.append(':');
        write(sb, entry.getValue());
      }
      sb.append('}');
      return;
    }
    if (value instanceof Iterable<?> iterable) {
      sb.append('[');
      boolean first = true;
      for (Object item : iterable) {
        if (!first) sb.append(',');
        first = false;
        write(sb, item);
      }
      sb.append(']');
      return;
    }
    if (value instanceof List<?> list) {
      sb.append('[');
      for (int i = 0; i < list.size(); i++) {
        if (i > 0) sb.append(',');
        write(sb, list.get(i));
      }
      sb.append(']');
      return;
    }
    writeString(sb, value.toString());
  }

  private static void writeString(StringBuilder sb, String value) {
    sb.append('"');
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      switch (c) {
        case '"' -> sb.append("\\\"");
        case '\\' -> sb.append("\\\\");
        case '\n' -> sb.append("\\n");
        case '\r' -> sb.append("\\r");
        case '\t' -> sb.append("\\t");
        case '\b' -> sb.append("\\b");
        case '\f' -> sb.append("\\f");
        default -> {
          if (c < 0x20) {
            sb.append(String.format("\\u%04x", (int) c));
          } else {
            sb.append(c);
          }
        }
      }
    }
    sb.append('"');
  }
}
