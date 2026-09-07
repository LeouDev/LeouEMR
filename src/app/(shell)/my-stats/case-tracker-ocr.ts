/**
 * Reading a schedule screenshot in the browser.
 *
 * Tesseract is fetched only when an agent actually drops an image in, and
 * from a pinned version with a subresource integrity hash: the page it runs
 * on holds PA case numbers, so a script that can execute there should not be
 * whatever the CDN happens to serve that day. Nothing about the image itself
 * leaves the browser — recognition runs locally, which is also why the engine
 * has to be downloaded at all.
 */

const TESSERACT_VERSION = "5.1.1";
const TESSERACT_SRC = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
const TESSERACT_SRI = "sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F";

interface TesseractLine {
  text: string;
  confidence: number;
}

interface TesseractGlobal {
  recognize(
    image: string,
    lang: string,
  ): Promise<{ data: { lines?: TesseractLine[]; text?: string } }>;
}

declare global {
  interface Window {
    Tesseract?: TesseractGlobal;
  }
}

let loading: Promise<TesseractGlobal> | null = null;

/** Loads the engine once per page, reusing the same promise for concurrent calls. */
function loadTesseract(): Promise<TesseractGlobal> {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (loading) return loading;

  loading = new Promise<TesseractGlobal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TESSERACT_SRC;
    script.integrity = TESSERACT_SRI;
    script.crossOrigin = "anonymous";
    script.async = true;
    script.onload = () => {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error("The text recognition engine loaded but did not start."));
    };
    script.onerror = () =>
      reject(new Error("Could not download the text recognition engine. Check your connection."));
    document.head.appendChild(script);
  }).catch((error) => {
    // A failed load must not poison every later attempt.
    loading = null;
    throw error;
  });

  return loading;
}

/**
 * Upscales, greys and lifts the contrast before recognition.
 *
 * Schedule screenshots are small, and Tesseract confuses digits far less
 * often on larger, higher-contrast text — which matters here because the
 * digits are the start and end times the whole calculation rests on.
 */
function preprocess(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode that image."));
      img.onload = () => {
        const scale = Math.max(2, 1600 / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("This browser cannot process the image."));
          return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        try {
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const pixels = data.data;
          for (let i = 0; i < pixels.length; i += 4) {
            const grey = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            const lifted = Math.max(0, Math.min(255, (grey - 128) * 1.25 + 128));
            pixels[i] = pixels[i + 1] = pixels[i + 2] = lifted;
          }
          ctx.putImageData(data, 0, 0);
        } catch {
          // Tainted or unsupported canvas — the plain upscale still reads.
        }
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/** Recognised lines, each with the engine's own confidence where it reported one. */
export async function readScheduleImage(
  file: File,
): Promise<Array<{ text: string; confidence: number | null }>> {
  const [engine, dataUrl] = await Promise.all([loadTesseract(), preprocess(file)]);
  const { data } = await engine.recognize(dataUrl, "eng");

  if (data.lines?.length) {
    return data.lines.map((line) => ({ text: line.text, confidence: line.confidence }));
  }
  // Line segmentation keeps a table row intact, so it is strongly preferred;
  // splitting the flat text is only a fallback when it produced nothing.
  return (data.text ?? "").split("\n").map((text) => ({ text, confidence: null }));
}
