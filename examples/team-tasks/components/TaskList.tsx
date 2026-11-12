// The tasks of a project, open ones first.
import TaskCard from "./TaskCard";
import type { TaskRow } from "@/lib/types";

export default function TaskList({ tasks, onChange }: { tasks: TaskRow[]; onChange: () => void }) {
  if (!tasks.length) return <p>No tasks yet. Add the first one above.</p>;
  return (
    <ul style={{ listStyle: "none", padding: 0 }}>
      {tasks.map((t) => (
        <li key={t.id}>
          <TaskCard task={t} onChange={onChange} />
        </li>
      ))}
    </ul>
  );
}
