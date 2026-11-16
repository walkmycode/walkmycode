"use client";
/** The professor's answer, drawn from its blocks (src/learn/lib/md.ts): paragraphs
 *  in the chalk markup, 💡 analogies as callouts, and code with colours, a Copy
 *  button and a way to open it in the lesson's editor. */
import { memo, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { highlight } from "@/learn/lib/highlight";
import { Chalk } from "@/learn/lib/markup";
import { emphasis, parseMd } from "@/learn/lib/md";
import { readPictureBlock } from "@/lib/scene/diagram";
import { readAnySceneBlock } from "@/lib/scene/any";

// An analogy to watch inside an answer (a ```scene block): it and its drawings load only when one appears.
const SceneBlock = dynamic(() => import("@/components/scene/AnyScene"), { ssr: false, loading: () => <p className="note">Setting the scene…</p> });

type Props = {
  text: string;
  /** "Open in editor" on a code block, when the lesson has an editor to open it in. */
  onOpenCode?: (code: string, lang: string) => void;
};

const Code = memo(function Code({ code, lang, open, onOpen }: { code: string; lang: string; open: boolean; onOpen?: (code: string, lang: string) => void }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => highlight(code, lang), [code, lang]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the clipboard is blocked: the code can still be selected */
    }
  };
  return (
    <figure className="md-code">
      <figcaption>
        <span>{lang || "code"}</span>
        {!open && (
          <span className="acts">
            {onOpen && <button type="button" onClick={() => onOpen(code, lang)} title="Put this code in the lesson's editor, to run and change">Open in editor</button>}
            <button type="button" onClick={copy} aria-live="polite">{copied ? "Copied" : "Copy"}</button>
          </span>
        )}
      </figcaption>
      <pre tabIndex={0}>
        <code>
          {lines.map((spans, i) => (
            <span key={i} className="ln">
              {spans.map((s, k) => (s.cls ? <span key={k} className={s.cls}>{s.text}</span> : s.text))}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
});

// A diagram with its analogy drawn in (a ```picture block).
const PictureDiagram = dynamic(() => import("@/components/scene/PictureDiagram"), { ssr: false, loading: () => <p className="note">Drawing the diagram…</p> });

/** A ```picture block: the diagram once it has all arrived and is one the page can draw; otherwise it is shown as it was written. */
const Picture = memo(function Picture({ code, open, onOpen }: { code: string; open: boolean; onOpen?: (code: string, lang: string) => void }) {
  const picture = useMemo(() => (open ? null : readPictureBlock(code)), [code, open]);
  if (open) return <p className="note">Drawing the diagram…</p>;
  return picture ? <PictureDiagram picture={picture} /> : <Code code={code} lang="json" open={false} onOpen={onOpen} />;
});

/** A ```scene block: the scene once it has all arrived and is one the page can draw; otherwise it is shown as it was written. */
const Scene = memo(function Scene({ code, open, onOpen }: { code: string; open: boolean; onOpen?: (code: string, lang: string) => void }) {
  const scene = useMemo(() => (open ? null : readAnySceneBlock(code)), [code, open]);
  if (open) return <p className="note">Drawing the picture…</p>;
  return scene ? <SceneBlock scene={scene} /> : <Code code={code} lang="json" open={false} onOpen={onOpen} />;
});

/** A line of an answer: the chalk markup, with *emphasis* drawn too. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {emphasis(text).map((p, i) => (p.em ? <em key={i}><Chalk text={p.text} /></em> : <Chalk key={i} text={p.text} />))}
    </>
  );
}

function Markdown({ text, onOpenCode }: Props) {
  const blocks = useMemo(() => parseMd(text), [text]);
  return (
    <div className="md">
      {blocks.map((b, i) =>
        b.t === "code" && b.lang === "scene" ? (
          <Scene key={i} code={b.code} open={b.open} onOpen={onOpenCode} />
        ) : b.t === "code" && b.lang === "picture" ? (
          <Picture key={i} code={b.code} open={b.open} onOpen={onOpenCode} />
        ) : b.t === "code" ? (
          <Code key={i} code={b.code} lang={b.lang} open={b.open} onOpen={onOpenCode} />
        ) : b.t === "list" ? (
          b.ordered ? (
            <ol key={i}>{b.items.map((it, k) => <li key={k}><Inline text={it} /></li>)}</ol>
          ) : (
            <ul key={i}>{b.items.map((it, k) => <li key={k}><Inline text={it} /></li>)}</ul>
          )
        ) : b.t === "callout" ? (
          <p key={i} className="md-analogy"><span aria-hidden="true">💡</span><span><Inline text={b.text} /></span></p>
        ) : b.t === "quote" ? (
          <blockquote key={i}><Inline text={b.text} /></blockquote>
        ) : (
          <p key={i}><Inline text={b.text} /></p>
        ),
      )}
    </div>
  );
}

export default memo(Markdown);
