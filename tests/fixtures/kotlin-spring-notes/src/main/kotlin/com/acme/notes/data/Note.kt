package com.acme.notes.data

import jakarta.persistence.*

@Entity
@Table(name = "notes")
data class Note(
    @Id @GeneratedValue val id: Long = 0,
    val title: String,
    @Column(name = "body_text") val body: String,
    @ManyToOne val author: Author? = null,
)
