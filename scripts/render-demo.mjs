// Renders the CLI output for the bundled example as a terminal-style SVG (docs/assets/demo.svg).
// Usage: npm run build && node scripts/render-demo.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = ["examples/acme-http/current", "-b", "dir:examples/acme-http/v1.4.0"];
const run = spawnSync(process.execPath, ["dist/src/cli.js", ...args, "--color"], {
  cwd: root,
  encoding: "utf8",
});

const PALETTE = {
  default: "#d4d7de",
  red: "#ff6b6b",
  green: "#7ee787",
  yellow: "#e3b341",
  gray: "#7d8590",
};

function parseAnsi(line) {
  const spans = [];
  let style = { color: "default", bold: false, dim: false };
  const re = /\u001b\[(\d+)m/g;
  let last = 0;
  let m = re.exec(line);
  const push = (text) => {
    if (text) spans.push({ text, ...style });
  };
  while (m) {
    push(line.slice(last, m.index));
    last = m.index + m[0].length;
    const code = Number(m[1]);
    if (code === 0) style = { color: "default", bold: false, dim: false };
    else if (code === 1) style = { ...style, bold: true };
    else if (code === 2) style = { ...style, dim: true };
    else if (code === 31) style = { ...style, color: "red" };
    else if (code === 32) style = { ...style, color: "green" };
    else if (code === 33) style = { ...style, color: "yellow" };
    else if (code === 90) style = { ...style, color: "gray" };
    m = re.exec(line);
  }
  push(line.slice(last));
  return spans;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const prompt = `$ npx semvet ${args.join(" ")}`;
const lines = [
  [
    { text: "$ ", color: "green", bold: true },
    { text: prompt.slice(2), color: "default" },
  ],
  ...run.stdout.replace(/\n$/, "").split("\n").map(parseAnsi),
  [{ text: "$ echo $?", color: "default" }],
  [{ text: String(run.status), color: "red", bold: true }],
];

const fontSize = 13;
const charW = 7.85;
const lineH = 19;
const padX = 22;
const top = 52;
const cols = Math.max(...lines.map((l) => l.reduce((n, s) => n + [...s.text].length, 0)));
const width = Math.ceil(cols * charW + padX * 2 + 24);
const height = top + lines.length * lineH + 24;

let body = "";
lines.forEach((spans, i) => {
  const y = top + i * lineH;
  const tspans = spans
    .map((s) => {
      const fill = PALETTE[s.color];
      const opacity = s.dim ? ' fill-opacity="0.65"' : "";
      const weight = s.bold ? ' font-weight="700"' : "";
      return `<tspan fill="${fill}"${opacity}${weight}>${esc(s.text)}</tspan>`;
    })
    .join("");
  body += `<text x="${padX}" y="${y}" xml:space="preserve">${tspans}</text>\n`;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="semvet output for the acme-http example: six breaking changes in a minor release">
<rect width="${width}" height="${height}" rx="10" fill="#0d1117"/>
<rect width="${width}" height="34" rx="10" fill="#161b22"/>
<rect y="24" width="${width}" height="10" fill="#161b22"/>
<circle cx="20" cy="17" r="6" fill="#ff5f56"/><circle cx="40" cy="17" r="6" fill="#ffbd2e"/><circle cx="60" cy="17" r="6" fill="#27c93f"/>
<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" font-size="${fontSize}">
${body}</g>
</svg>
`;

mkdirSync(path.join(root, "docs/assets"), { recursive: true });
writeFileSync(path.join(root, "docs/assets/demo.svg"), svg);
console.log(
  `wrote docs/assets/demo.svg (${width}x${height}, ${(svg.length / 1024).toFixed(1)} KB)`,
);
