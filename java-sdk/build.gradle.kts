import com.vanniktech.maven.publish.JavaLibrary
import com.vanniktech.maven.publish.JavadocJar
import com.vanniktech.maven.publish.SonatypeHost

plugins {
    `java-library`
    alias(libs.plugins.mavenPublish)
    id("io.spring.dependency-management")
}

// group + version inherited from root build.gradle.kts. The root respects -Pversion=<x.y.z>
// passed by the release workflow, so this script doesn't need to override either.

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

dependencyManagement {
    imports {
        mavenBom("org.springframework.boot:spring-boot-dependencies:3.4.1")
    }
}

dependencies {
    // Optional Spring Boot integration — consumers can use the SDK without Spring.
    compileOnly("org.springframework.boot:spring-boot-autoconfigure")
    compileOnly("org.springframework.boot:spring-boot-starter-aop")
    compileOnly("org.springframework:spring-web")
    annotationProcessor("org.springframework.boot:spring-boot-configuration-processor")

    // Optional Logback bridge — emits ERROR-level events with throwables. Logback is shipped
    // by every Spring Boot starter, so consumers that already use Spring get this for free.
    compileOnly("ch.qos.logback:logback-classic")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.boot:spring-boot-starter-aop")
    testImplementation("org.springframework:spring-web")
    testImplementation("ch.qos.logback:logback-classic")
    testImplementation("org.assertj:assertj-core")
    testImplementation("org.mockito:mockito-junit-jupiter")
    testImplementation("org.wiremock:wiremock-standalone:3.10.0")
    // Used by DsnFixturesTest to read scripts/dsn-test-fixtures.json. Declared explicitly so
    // we don't rely on starter-test's transitive Jackson — the SDK is otherwise dependency-free.
    testImplementation("com.fasterxml.jackson.core:jackson-databind")

    // Pact JVM consumer: lets the SDK's test suite record the SDK ↔ ingest wire contract
    // into /pacts so services/ingest's existing IngestProviderPactTest replays it on every CI
    // run. Same library version as the provider side, pinned in libs.versions.toml.
    testImplementation(libs.pact.junit5)
}

tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
    options.compilerArgs.addAll(listOf("-parameters"))
}

tasks.withType<Test> {
    useJUnitPlatform()
    // Pact JVM defaults to build/pacts; redirect to the repo-level /pacts so the produced
    // contract sits next to arguslog-sdk-browser/arguslog-sdk-node and is auto-picked up
    // by services/ingest's @PactFolder("../../pacts").
    systemProperty("pact.rootDir", file("../pacts").absolutePath)
}

// Stamp the runtime SDK identity from project.version so the value the SDK puts on every
// event payload (sdk.version) and the GAV published to Maven Central can never drift.
// The release workflow passes -Pversion=<x.y.z>; local builds default to the SNAPSHOT
// configured in the root build.gradle.kts.
val sdkVersionResourcesDir = layout.buildDirectory.dir("generated/resources/sdk-version")

val generateSdkVersion =
    tasks.register("generateSdkVersion") {
        val versionProvider = providers.provider { project.version.toString() }
        val outputDir = sdkVersionResourcesDir
        inputs.property("version", versionProvider)
        outputs.dir(outputDir)
        doLast {
            val file =
                outputDir
                    .get()
                    .file("org/arguslog/sdk/sdk-version.properties")
                    .asFile
            file.parentFile.mkdirs()
            file.writeText("version=${versionProvider.get()}\n")
        }
    }

sourceSets.named("main") {
    resources.srcDir(sdkVersionResourcesDir)
}

tasks.named("processResources") {
    dependsOn(generateSdkVersion)
}

// sourcesJar (created by the maven-publish plugin) packages main/resources, so it must
// run after the generator. Declared here once so adding more downstream consumers in the
// future doesn't reintroduce the implicit-dependency warning.
tasks.withType<Jar>().configureEach {
    dependsOn(generateSdkVersion)
}

mavenPublishing {
    // CENTRAL_PORTAL is the new Maven Central path; new namespaces (like org.arguslog) cannot
    // use the legacy OSSRH staging repository.
    publishToMavenCentral(SonatypeHost.CENTRAL_PORTAL, automaticRelease = true)

    // Sources + Javadoc jars are required by Maven Central. Plugin generates both from the
    // already-configured Java toolchain.
    configure(JavaLibrary(javadocJar = JavadocJar.Javadoc(), sourcesJar = true))

    coordinates("org.arguslog", "java-sdk", project.version.toString())

    // Signing is required by Central. The release workflow injects an in-memory ASCII-armored
    // GPG key via env vars; locally `./gradlew publish` will prompt for or fail loudly without
    // ORG_GRADLE_PROJECT_signingInMemoryKey configured.
    signAllPublications()

    pom {
        name.set("Arguslog Java SDK")
        description.set(
            """
            Java SDK for Arguslog (https://arguslog.org), a multi-tenant error tracking platform.

            Three integration paths in one artifact:
              1. Plain Java — Arguslog.init(...) + captureException / captureMessage facade.
              2. Spring Boot — autoconfig wires the client at @PostConstruct, flushes at @PreDestroy.
                 Configure via the standard arguslog.* properties (dsn, environment, release,
                 sample-rate, scrubbing, debug). No-op when arguslog.dsn is empty.
              3. Logback — drop org.arguslog.sdk.logback.ArguslogLogbackAppender into logback-spring.xml
                 and every log.error(...) call ships its throwable. UnsynchronizedAppenderBase, so
                 high-volume loggers don't serialize on it; the SDK's bounded queue is the
                 back-pressure boundary.

            Java 21 baseline. Logback and Spring Boot are compileOnly — only pulled in when the
            consumer already has them. Non-blocking captures (single daemon worker thread,
            bounded queue, drop-on-overflow). Built-in PII scrubbing (emails, IPs, JWT-ish
            tokens) on messages and stack traces; extra patterns supplied via builder.

            Apache-2.0 — explicit patent grant chosen for the JVM ecosystem; the JS SDKs
            (@arguslog/sdk-browser, @arguslog/sdk-react) ship under MIT.

            See README at https://github.com/petarnenov/arguslog/tree/main/java-sdk for full
            quick-start, options table, and threading model.
            """.trimIndent(),
        )
        url.set("https://github.com/petarnenov/arguslog/tree/main/java-sdk")
        inceptionYear.set("2026")
        licenses {
            license {
                name.set("Apache-2.0")
                url.set("https://www.apache.org/licenses/LICENSE-2.0")
                distribution.set("repo")
            }
        }
        developers {
            developer {
                id.set("arguslog")
                name.set("Arguslog team")
                url.set("https://arguslog.org")
            }
        }
        scm {
            url.set("https://github.com/petarnenov/arguslog")
            connection.set("scm:git:git://github.com/petarnenov/arguslog.git")
            developerConnection.set("scm:git:ssh://git@github.com/petarnenov/arguslog.git")
        }
    }
}
