// Emails go out through Resend, an outside service. Without a key, nothing is sent.
export async function sendAssignedEmail(to: string, taskTitle: string) {
  if (!process.env.RESEND_API_KEY) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: "Team Tasks <tasks@example.com>",
      to,
      subject: `New task for you: ${taskTitle}`,
      text: `You have been given a task: ${taskTitle}`,
    }),
  });
}
