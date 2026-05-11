@file:Suppress("UnstableApiUsage")

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "arguslog-sdks"

// Mirror's Gradle scope is just the Java SDK. Backend services (:services:api, :services:ingest,
// :services:worker) and the internal :lib:crypto-aes-gcm stay in the private monorepo.
include(":java-sdk")
