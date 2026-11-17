package com.acme.notes.api

import com.acme.notes.core.NoteService
import com.acme.notes.data.Note
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/notes")
class NoteController(private val notes: NoteService) {
    @GetMapping
    fun list(): List<Note> = notes.all()

    @GetMapping("/{id}")
    fun one(@PathVariable id: Long): Note = notes.find(id)

    @PostMapping
    fun create(@RequestBody note: Note): Note {
        return notes.add(note)
    }

    @DeleteMapping("/{id}")
    fun remove(@PathVariable id: Long) {
        notes.remove(id)
    }
}
