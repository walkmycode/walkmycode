package com.acme.notes.client

import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import org.springframework.web.client.RestTemplate

@Component
class TagClient(@Value("\${tags.url}") private val tagsUrl: String) {
    private val rest = RestTemplate()

    fun suggest(title: String): String? {
        val key = System.getenv("TAGS_API_KEY")
        return rest.getForObject("$tagsUrl/api/tags?for=$title&key=$key", String::class.java)
    }
}
