using System.ComponentModel.DataAnnotations.Schema;

namespace Todos.Models;

[Table("todo_items")]
public class Todo
{
    public int Id { get; set; }
    public string Title { get; set; } = "";

    [Column("is_done")]
    public bool Done { get; set; }

    [NotMapped]
    public string Label => Done ? "done" : "open";

    public TodoList? List { get; set; }
}

public class TodoList
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public List<Todo> Todos { get; set; } = new();
}
