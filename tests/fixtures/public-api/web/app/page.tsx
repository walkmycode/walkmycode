"use client";
import { apiFetch } from "../lib/api";

export default function Page({ id }: { id: string }) {
  async function load() {
    await apiFetch("/items");
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/items/${id}`);
  }
  async function order() {
    await apiFetch("/orders", { method: "POST" });
  }
  async function report() {
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/reports/weekly`);
  }
  return (
    <main>
      <button onClick={load}>Load</button>
      <button onClick={order}>Order</button>
      <button onClick={report}>Report</button>
    </main>
  );
}
