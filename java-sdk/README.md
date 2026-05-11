# Arguslog Java SDK

[![Maven Central](https://img.shields.io/maven-central/v/org.arguslog/java-sdk.svg)](https://central.sonatype.com/artifact/org.arguslog/java-sdk)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)

Java SDK for [Arguslog](https://arguslog.org) — a multi-tenant error tracking platform.
Captures exceptions and messages from any JVM application and ships them asynchronously to
the Arguslog ingest endpoint.

Three integration paths, pick what matches your stack:

1. **Plain Java** — call the static `Arguslog` facade directly.
2. **Spring Boot** — drop in the JAR, add a property, autoconfig handles the rest.
3. **Logback** — register the appender once and every `log.error(…)` call ships its throwable.

Java 21 is the supported baseline. No required runtime dependencies; Spring Boot and Logback
integrations are activated only when those libraries are already on the classpath.

## Install

### Gradle (Kotlin DSL)

```kotlin
dependencies {
    implementation("org.arguslog:java-sdk:1.0.1")
}
```

### Gradle (Groovy DSL)

```groovy
dependencies {
    implementation 'org.arguslog:java-sdk:1.0.1'
}
```

### Maven

```xml
<dependency>
  <groupId>org.arguslog</groupId>
  <artifactId>java-sdk</artifactId>
  <version>1.0.1</version>
</dependency>
```

## Quick start

### Plain Java

```java
import org.arguslog.sdk.Arguslog;
import org.arguslog.sdk.ArguslogOptions;

Arguslog.init(
    ArguslogOptions.builder()
        .dsn("arguslog://<publicKey>@<host>/api/<projectId>")
        .environment("production")
        .release("1.4.0")
        .build());

try {
    riskyThing();
} catch (Exception e) {
    Arguslog.captureException(e);
}

// On shutdown — flushes the in-memory queue with a 2-second deadline by default.
Arguslog.close();
```

### Spring Boot

Add the dependency, set one property, done. The autoconfig wires the client at
`@PostConstruct` and flushes at `@PreDestroy`.

```yaml
arguslog:
  dsn: ${ARGUSLOG_DSN:} # empty value → SDK is a no-op (safe for local dev / tests)
  environment: ${SPRING_PROFILES_ACTIVE:dev}
  release: ${ARGUSLOG_RELEASE:0.0.1-SNAPSHOT}
  sample-rate: 1.0
  scrubbing: true # built-in PII scrubbing on messages + stacks
```

Capture from any bean:

```java
import org.arguslog.sdk.Arguslog;

@RestController
class CheckoutController {
    @PostMapping("/checkout")
    public ResponseEntity<?> checkout(@RequestBody CartDto cart) {
        try {
            return ResponseEntity.ok(service.process(cart));
        } catch (PaymentException e) {
            Arguslog.captureException(e);
            throw e;
        }
    }
}
```

### Logback (no manual capture calls)

Add the appender to your `logback-spring.xml` and any `log.error(…, throwable)` call ships
the exception automatically. The appender is a no-op until `Arguslog.init` runs (typically
via the Spring autoconfig above), so it's safe to declare in shared base configs.

```xml
<configuration>
    <include resource="org/springframework/boot/logging/logback/defaults.xml"/>
    <include resource="org/springframework/boot/logging/logback/console-appender.xml"/>

    <appender name="ARGUSLOG" class="org.arguslog.sdk.logback.ArguslogLogbackAppender">
        <minLevel>ERROR</minLevel>     <!-- or WARN to widen the funnel -->
    </appender>

    <root level="INFO">
        <appender-ref ref="CONSOLE"/>
        <appender-ref ref="ARGUSLOG"/>
    </root>
</configuration>
```

The appender uses `UnsynchronizedAppenderBase` — it doesn't take Logback's per-event lock,
so high-volume loggers won't serialize on it. The SDK's own bounded queue is the back-pressure
boundary; once full, new events are dropped instead of blocking the application thread.

## DSN format

```
arguslog://<publicKey>@<host>/api/<projectId>
```

The custom `arguslog://` scheme keeps the DSN string visually distinct from the actual
transport URL — the SDK parses it, picks `http` for loopback hosts and `https` everywhere
else, and POSTs events to `<scheme>://<host>/api/<projectId>/events`. Get the full DSN
from your Arguslog project's "Copy DSN" modal; the public key is project-scoped and safe
to embed in env vars (it grants ingest only, no read access).

## API reference

### `Arguslog.init(ArguslogOptions)`

| Builder field                       | Type     | Default | Notes                                                           |
| ----------------------------------- | -------- | ------- | --------------------------------------------------------------- |
| `dsn(String)`                       | required | _none_  | See "DSN format".                                               |
| `environment(String)`               | optional | _none_  | E.g. `production`, `staging`.                                   |
| `release(String)`                   | optional | _none_  | Free-form version tag.                                          |
| `sampleRate(double)`                | 0.0–1.0  | `1.0`   | Fraction of events kept.                                        |
| `maxQueueSize(int)`                 |          | `256`   | Bounded queue size; dropped on overflow.                        |
| `flushTimeout(Duration)`            |          | `2s`    | Max wait on `close()` / `flush()`.                              |
| `scrubbingEnabled(boolean)`         |          | `true`  | Built-in regex scrubbing on messages + stack frames.            |
| `extraScrubPatterns(List<Pattern>)` |          | _empty_ | Additional regexes applied alongside the built-ins.             |
| `debug(boolean)`                    |          | `false` | Logs send attempts to `System.err`. Never enable in production. |

### `Arguslog.captureException(Throwable)`

Captures a thrown exception and returns the generated event id. Returns `null` if the SDK
isn't initialized — call sites can stay unconditional.

### `Arguslog.captureException(Throwable, ArguslogContext)`

Same as above, with extra context: tags, structured `extra` data, user id, and event level.

```java
Arguslog.captureException(e, ArguslogContext.empty()
    .withLevel(Level.ERROR)
    .withTag("feature", "checkout")
    .withTag("region", "eu-west-1"));
```

### `Arguslog.captureMessage(String, Level)`

Sends a message-only event (no stack trace).

### `Arguslog.close()`

Flushes the queue and stops the worker thread. Spring Boot's autoconfig calls this at
`@PreDestroy`; in plain Java apps, register a JVM shutdown hook or call from your own
lifecycle.

## Threading model

Captures are non-blocking — `captureException` enqueues the event and returns immediately.
A single daemon worker thread (`arguslog-sender-N`) drains the queue and POSTs events one at
a time. Drops on full queue keep the application thread predictable; the threshold is
`maxQueueSize` (default 256).

## Privacy / scrubbing

Built-in regex patterns redact common PII (emails, IPs, JWT-ish tokens) from message strings
and stack frame text before send. Supply additional patterns via `extraScrubPatterns(...)`
on the builder. Disable entirely with `scrubbingEnabled(false)` when you control the input.

## License

Apache-2.0 — see [LICENSE](https://github.com/petarnenov/arguslog/blob/main/LICENSE) and
[NOTICE](https://github.com/petarnenov/arguslog/blob/main/NOTICE) for attribution. Apache-2.0
was chosen specifically for the Java SDK to provide an explicit patent grant; the JS SDKs
ship under MIT.
