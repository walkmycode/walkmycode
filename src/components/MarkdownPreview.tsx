"use client";
/**
 * A Markdown file as it reads (README.md and every other .md in Explore's Code panel), like VS Code's
 * preview: GitHub's Markdown (headings, lists, task lists, tables, quotes and alerts, code blocks coloured
 * in their language, links and images). It is drawn from the same parser the editor colours the source
 * with (@lezer/markdown), as React elements (markdownBody.tsx): the file's text never becomes HTML, so a
 * README can't put markup or script on the page. Links to other files in the project open them here;
 * links out open a tab.
 */
import { MarkdownBody } from "./markdownBody";
import "./markdown-preview.css";

export default MarkdownBody;
