package com.acme.notes.core

/** A title as it is stored: no space around it. */
fun cleanTitle(raw: String): String = raw.trim()

object Slugs {
    fun of(title: String): String = title.lowercase().replace(' ', '-')
}
