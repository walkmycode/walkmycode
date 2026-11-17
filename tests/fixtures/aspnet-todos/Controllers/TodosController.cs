using Microsoft.AspNetCore.Mvc;
using Todos.Models;
using Todos.Services;

namespace Todos.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TodosController : ControllerBase
{
    private readonly TodoService _todos;

    public TodosController(TodoService todos)
    {
        _todos = todos;
    }

    [HttpGet]
    public async Task<List<Todo>> List() => await _todos.All();

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Todo>> One(int id)
    {
        var todo = await _todos.Find(id);
        return todo is null ? NotFound() : todo;
    }

    [HttpPost]
    public async Task<Todo> Create(Todo todo) => await _todos.Add(todo, 1);

    [HttpDelete("{id}")]
    public async Task<IActionResult> Remove(int id)
    {
        await _todos.Remove(id);
        return NoContent();
    }

    [HttpGet("/api/ping")]
    public string Ping() => "pong";
}
