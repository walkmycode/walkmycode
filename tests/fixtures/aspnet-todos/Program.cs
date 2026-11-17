using Microsoft.EntityFrameworkCore;
using Todos.Data;
using Todos.Models;
using Todos.Services;

var builder = WebApplication.CreateBuilder(args);
var connection = builder.Configuration.GetConnectionString("Default");
builder.Services.AddControllers();
builder.Services.AddDbContext<TodoContext>();
builder.Services.AddScoped<TodoService>();

var app = builder.Build();
app.MapControllers();
app.MapGet("/health", () => "ok");

var lists = app.MapGroup("/api/lists");
lists.MapGet("/", async (TodoContext db) => await db.Lists.ToListAsync());
lists.MapPost("/", async (TodoList list, TodoContext db) =>
{
    db.Lists.Add(list);
    await db.SaveChangesAsync();
    return Results.Created($"/api/lists/{list.Id}", list);
});
lists.MapDelete("/{id:int}", ListHandlers.Remove);

app.Run();

public static class ListHandlers
{
    public static async Task<IResult> Remove(int id, TodoContext db)
    {
        await db.Lists.Where(l => l.Id == id).ExecuteDeleteAsync();
        return Results.NoContent();
    }
}
