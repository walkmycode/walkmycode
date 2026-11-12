// Images attached to a question: the page's request keeps only well-formed ones,
// and next_request hands them to Claude as images, never as base64 in the text.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_IMAGES, parsePageRequest } from "../src/lib/bridge/protocol";
import { requestContent } from "../mcp/src/tools";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("images with a question", () => {
  it("keeps well-formed images and drops the rest", () => {
    const r = parsePageRequest({
      kind: "question",
      payload: { text: "what is this error?", images: [{ mediaType: "image/png", data: PNG }, { mediaType: "image/svg+xml", data: PNG }, { mediaType: "image/png", data: "not base64!" }, "junk"] },
    });
    assert.ok(r.ok);
    assert.deepEqual(r.ok && r.value.kind === "question" && r.value.payload.images, [{ mediaType: "image/png", data: PNG }]);
  });

  it("takes at most MAX_IMAGES, and none is no images field at all", () => {
    const many = Array.from({ length: MAX_IMAGES + 3 }, () => ({ mediaType: "image/png", data: PNG }));
    const r = parsePageRequest({ kind: "question", payload: { text: "q", images: many } });
    assert.equal(r.ok && r.value.kind === "question" && r.value.payload.images?.length, MAX_IMAGES);
    const plain = parsePageRequest({ kind: "question", payload: { text: "q", images: [] } });
    assert.deepEqual(plain.ok && plain.value.payload, { text: "q" });
  });

  it("next_request shows Claude the images as images, with the base64 kept out of the text", () => {
    const out = requestContent({ id: "r1", kind: "question", payload: { text: "what is this?", images: [{ mediaType: "image/png", data: PNG }] }, at: 0 } as never);
    const [first, second] = out.content as { type: string; text?: string; data?: string; mimeType?: string }[];
    assert.equal(first.type, "text");
    assert.ok(!first.text!.includes(PNG));
    assert.match(first.text!, /1 attached, shown below/);
    assert.deepEqual(second, { type: "image", data: PNG, mimeType: "image/png" });
  });
});
