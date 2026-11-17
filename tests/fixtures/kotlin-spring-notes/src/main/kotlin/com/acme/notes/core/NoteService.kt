package com.acme.notes.core

import com.acme.notes.client.TagClient
import com.acme.notes.data.Note
import com.acme.notes.data.NoteRepository
import com.acme.notes.legacy.Audit
import org.springframework.stereotype.Service

@Service
class NoteService(private val repo: NoteRepository, private val tags: TagClient) {
    fun all(): List<Note> = repo.findAll()

    fun find(id: Long): Note = repo.findById(id).orElseThrow()

    fun add(note: Note): Note {
        tags.suggest(note.title)
        Audit.log(Slugs.of(note.title))
        return repo.save(note.copy(title = cleanTitle(note.title)))
    }

    fun remove(id: Long) {
        repo.deleteById(id)
    }
}
