package com.acme.notes.data

import jakarta.persistence.Entity
import jakarta.persistence.Id

@Entity
class Author {
    @Id
    var id: Long = 0

    var fullName: String = ""
}
