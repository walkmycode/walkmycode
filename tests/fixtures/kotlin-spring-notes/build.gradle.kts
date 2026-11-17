plugins {
    kotlin("jvm") version "2.2.0"
    id("org.springframework.boot") version "3.5.0"
}

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
}
