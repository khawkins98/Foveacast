// Extension: foveacast-expert
//
// Injects Foveacast architecture context on every session start and
// exposes two diagnostic tools:
//   - check_layer_discipline: grep test for ort/heatmap.js layer leakage
//   - get_model_pipeline_info: structured summary of the inference pipeline
//
// These tools surface project-specific knowledge that would otherwise
// require the agent to re-read multiple source files on every session.

import { joinSession } from "@github/copilot-sdk/extension";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

// Compact architecture cheat-sheet injected on every session start.
// Keeps critical rules in scope without requiring the agent to re-derive
// them from source files each time.
const ARCHITECTURE_CONTEXT = `
# Foveacast architecture quick-reference

## Layer discipline (violations are bugs)
  model/    ← ONLY layer that touches ort / onnxruntime-web
  pipeline/ ← Pure JS. NO DOM, no canvas, no library imports.
  render/   ← ONLY layer that draws to canvas. No ort imports.
  ui/       ← DOM manipulation, events, user input.

## V3 inference pipeline
  Input:  CanvasImageSource → imageSourceToInputData → Float32 tensor [1, 3, 240, 320]
  ORT:    session.run({ input }) → outputs.output ([1, 1, 240, 320], values in [0,1])
  Post:   upsampleBilinear → gaussianBlur(σ=5) → normaliseToUnit → Float32Array
  origDims convention: [H, W] throughout (height-first, matches NumPy/ONNX)

## Key facts
  - V3 model outputs [0,1] directly (min-max normalised inside ONNX graph)
  - logProbsToProbabilities is GONE — do not re-introduce it
  - docs/models/v3/model.onnx is gitignored; run scripts/fetch-v3-model.sh before E2E
  - Buildless: no bundler step, docs/ is the shipped artefact
  - ORT single-threaded on GitHub Pages (no COEP/crossOriginIsolated)
  - ort.env.wasm.wasmPaths must be set in loader.js before InferenceSession.create
  - macOS Vite: webServer.url must use localhost not 127.0.0.1 (IPv6-only bind)

## Test tiers
  Unit (vitest+jsdom): tests/*.test.js  — run: pnpm test
  E2E (Playwright):    tests/e2e/       — run: pnpm test:e2e (needs model + dev server)
  Liveness:            scripts/smoke-test.sh
`;

// Run a shell command and return stdout.
// grep exits 1 when it finds no matches — that's a valid "no violations" result,
// not an error. We only treat it as an error if there's content on stderr.
function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, shell: false }, (err, stdout, stderr) => {
      if (!stdout && stderr && stderr.trim()) {
        // Actual shell/command error (not just grep returning 1 on no matches)
        resolve(`(shell error: ${stderr.trim()})`);
      } else {
        resolve(stdout.trim() || "(no matches)");
      }
    });
  });
}

const session = await joinSession({
  hooks: {
    onSessionStart: async () => ({
      additionalContext: ARCHITECTURE_CONTEXT,
    }),
  },

  tools: [
    {
      name: "check_layer_discipline",
      description:
        "Run the Foveacast layer-discipline grep tests. Checks that ort/onnxruntime-web" +
        " is not imported outside docs/src/model/, and that heatmap.js/h337 is not" +
        " imported outside docs/src/render/. Returns PASS if both checks are clean," +
        " or lists the violating lines.",
      parameters: { type: "object", properties: {} },
      skipPermission: true,
      handler: async (_args, invocation) => {
        const cwd = invocation?.cwd ?? process.cwd();
        const root = resolve(cwd);

        // grep exits 1 when there are no matches — that is actually a PASS here.
        // We pipe through grep -v to strip comment-only lines (// comments and * jsdoc)
        // since those are documentation references, not actual imports or uses.
        const [ortLeaks, heatmapLeaks] = await Promise.all([
          run(
            "bash",
            [
              "-c",
              String.raw`grep -rn "\bort\b\|onnxruntime-web" docs/src/ | grep -v "docs/src/model/" | grep -vE ":[0-9]+:\s*//" | grep -vE ":[0-9]+:\s*\*"`,
            ],
            root,
          ),
          run(
            "bash",
            [
              "-c",
              String.raw`grep -rn "\bh337\b\|heatmap\.js" docs/src/ | grep -v "docs/src/render/" | grep -vE ":[0-9]+:\s*//" | grep -vE ":[0-9]+:\s*\*"`,
            ],
            root,
          ),
        ]);

        const ortClean = ortLeaks === "(no matches)";
        const heatmapClean = heatmapLeaks === "(no matches)";

        if (ortClean && heatmapClean) {
          return "PASS — no layer-discipline violations found.";
        }

        const lines = [];
        if (!ortClean) {
          lines.push(`FAIL — ort/onnxruntime-web leaking outside model/:\n${ortLeaks}`);
        }
        if (!heatmapClean) {
          lines.push(`FAIL — heatmap.js/h337 leaking outside render/:\n${heatmapLeaks}`);
        }
        return lines.join("\n");
      },
    },

    {
      name: "get_model_pipeline_info",
      description:
        "Return a structured summary of the Foveacast inference pipeline: model input" +
        " shape, ORT tensor names, postprocess steps, and key numeric constants." +
        " Useful when reasoning about adding new pipeline stages or debugging model output.",
      parameters: { type: "object", properties: {} },
      skipPermission: true,
      handler: async (_args, invocation) => {
        const cwd = invocation?.cwd ?? process.cwd();
        const root = resolve(cwd);

        // Read the two key files and extract the key facts as a summary rather
        // than dumping the full source — keeps the context window tight.
        let inferenceSnippet = "";
        let postprocessSnippet = "";

        try {
          const inferenceSource = await readFile(
            join(root, "docs/src/model/inference.js"),
            "utf8",
          );
          // Pull just the JSDoc typedef blocks and the run call line.
          const lines = inferenceSource.split("\n");
          inferenceSnippet = lines
            .filter(
              (l) =>
                l.includes("@typedef") ||
                l.includes("@property") ||
                l.includes("[1, 3") ||
                l.includes("inputDims") ||
                l.includes("sourceDims") ||
                l.includes("session.run") ||
                l.includes("V3"),
            )
            .join("\n");
        } catch {
          inferenceSnippet = "(could not read docs/src/model/inference.js)";
        }

        try {
          const postprocessSource = await readFile(
            join(root, "docs/src/pipeline/postprocess.js"),
            "utf8",
          );
          // Pull the postprocess function signature and its doc comment.
          const lines = postprocessSource.split("\n");
          const start = lines.findIndex((l) => l.includes("export function postprocess"));
          postprocessSnippet =
            start >= 0 ? lines.slice(Math.max(0, start - 20), start + 10).join("\n") : "";
        } catch {
          postprocessSnippet = "(could not read docs/src/pipeline/postprocess.js)";
        }

        return `## Foveacast V3 inference pipeline

### Model (docs/src/model/inference.js)
${inferenceSnippet}

### Postprocess (docs/src/pipeline/postprocess.js)
${postprocessSnippet}

### Pipeline summary
1. imageSourceToInputData(source, [240,320]) → { data: Float32Array, sourceWidth, sourceHeight }
2. new ort.Tensor('float32', data, [1, 3, 240, 320])
3. session.run({ input }) → outputs.output (Float32Array, shape [1,1,240,320], values in [0,1])
4. postprocess(raw, [240,320], [origH,origW], sigma=5)
   = upsampleBilinear → gaussianBlur(σ=5) → normaliseToUnit
5. Float32Array [origH * origW], values in [0,1], ready for render/saliency-canvas.js

### Key numeric constants
- Model input: H=240, W=320
- Gaussian sigma: 5px (target-space; V2 used 28 because of log-prob peakiness)
- No log-probability step in V3`;
      },
    },
  ],
});
