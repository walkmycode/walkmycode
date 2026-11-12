// Images attached to a question in the Guide (pasted, dropped or picked): each
// is read in the browser, scaled down so its longest side is at most 1568 px
// (what vision models look at anyway) and sent as base64 with its type. Nothing
// is uploaded anywhere but with the question itself.
import { MAX_IMAGE_CHARS, type AskImage } from "@/lib/bridge/protocol";

const LONGEST = 1568;

function load(file: Blob): Promise<HTMLImageElement> {
  return new Promise((done, fail) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      done(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      fail(new Error("That file isn't an image this browser can read."));
    };
    img.src = url;
  });
}

/** One image, ready to send: PNG kept for screenshots that fit, else JPEG; refused when still too big. */
export async function attachImage(file: Blob): Promise<AskImage> {
  if (!file.type.startsWith("image/")) throw new Error("Only images can be attached.");
  const img = await load(file);
  const scale = Math.min(1, LONGEST / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't prepare the image.");
  ctx.drawImage(img, 0, 0, w, h);
  // Screenshots are sharper as PNG; photos (or a PNG that came out large) go as JPEG.
  let url = canvas.toDataURL("image/png");
  let mediaType: AskImage["mediaType"] = "image/png";
  if (file.type === "image/jpeg" || url.length > 1_500_000) {
    url = canvas.toDataURL("image/jpeg", 0.86);
    mediaType = "image/jpeg";
  }
  const data = url.slice(url.indexOf(",") + 1);
  if (data.length > MAX_IMAGE_CHARS) throw new Error("That image is too large, even scaled down.");
  return { mediaType, data };
}

/** The data: URL to show an attached image. */
export const imageSrc = (i: AskImage): string => `data:${i.mediaType};base64,${i.data}`;
