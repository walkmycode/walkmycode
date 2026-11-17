package com.acme.notes.data

import org.springframework.data.jpa.repository.JpaRepository

interface NoteRepository : JpaRepository<Note, Long> {
    fun findByTitle(title: String): List<Note>
}
