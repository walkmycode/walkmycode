using Refit;

namespace Todos.Services;

/** The users service, as Refit calls it. */
public interface IUsersApi
{
    [Get("/api/users/{id}")]
    Task<string> One(int id);

    [Post("/api/users/{id}/notify")]
    Task Notify(int id);
}
