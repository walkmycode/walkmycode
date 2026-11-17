using Microsoft.EntityFrameworkCore;
using Todos.Data;
using Todos.Models;

namespace Todos.Services
{
    public class TodoService
    {
        private readonly TodoContext _db;
        private readonly HttpClient _http;
        private readonly IUsersApi _users;
        private readonly string _notify;
        private readonly string _usersUrl;

        public TodoService(TodoContext db, HttpClient http, IUsersApi users, IConfiguration config)
        {
            _db = db;
            _http = http;
            _users = users;
            _notify = config["Slack:Webhook"] ?? "https://hooks.slack.com/services";
            _usersUrl = config.GetValue<string>("Users:Url");
        }

        public async Task<List<Todo>> All() => await _db.Todos.ToListAsync();

        public async Task<Todo?> Find(int id) => await _db.Todos.FindAsync(id);

        public async Task<Todo> Add(Todo todo, int userId)
        {
            _db.Todos.Add(todo);
            await _db.SaveChangesAsync();
            var hook = Environment.GetEnvironmentVariable("SLACK_WEBHOOK_PATH");
            await _http.PostAsync($"{_notify}/{hook}", null);
            await _http.GetAsync($"{_usersUrl}/api/users/{userId}");
            await _users.Notify(userId);
            return todo;
        }

        public async Task Remove(int id)
        {
            var todo = await _db.Todos.FindAsync(id);
            if (todo is not null) _db.Todos.Remove(todo);
            await _db.SaveChangesAsync();
        }
    }
}
