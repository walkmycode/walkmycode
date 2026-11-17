using Microsoft.EntityFrameworkCore;
using Todos.Models;

namespace Todos.Data;

public class TodoContext : DbContext
{
    public DbSet<Todo> Todos { get; set; } = null!;
    public DbSet<TodoList> Lists => Set<TodoList>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<TodoList>().ToTable("todo_lists");
    }
}
