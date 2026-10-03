import type { Finding, Report, Severity } from "./types.js";

const ESC = "\u001b[";
const codes = { bold: "1", dim: "2", red: "31", green: "32", yellow: "33", cyan: "36", gray: "90" };

export interface TextOptions {
  color: boolean;
  verbose: boolean;
}

function paint(on: boolean, style: keyof typeof codes, s: string): string {
  return on ? `${ESC}${codes[style]}m${s}${ESC}0m` : s;
}

const TITLES: Record<Severity, string> = {
  breaking: "BREAKING",
  minor: "FEATURES",
  note: "NOTES",
};

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function label(f: Finding): string {
  if (f.symbol === "") return f.entry === "." ? "package" : f.entry;
  return f.entry === "." ? f.symbol : `${f.entry} › ${f.symbol}`;
}

function verdict(r: Report): { glyph: string; style: "green" | "red" | "yellow"; text: string } {
  const from = r.baseline.version ?? "?";
  const to = r.next.version ?? "?";
  if (r.ok === false) {
    return {
      glyph: "✖",
      style: "red",
      text: `${from} → ${to} is only a ${r.declared} bump, but these changes need a ${r.required}.`,
    };
  }
  if (r.required === "none") {
    return {
      glyph: "✓",
      style: "green",
      text: `No public API changes found (${r.symbolsCompared} exports compared).`,
    };
  }
  if (r.ok === true) {
    return {
      glyph: "✓",
      style: "green",
      text: `${from} → ${to} is a ${r.declared} bump, which covers these changes (needs: ${r.required}).`,
    };
  }
  return {
    glyph: "ℹ",
    style: "yellow",
    text: `Version not bumped yet. The next release needs at least a ${r.required} bump.`,
  };
}

export function formatText(r: Report, opts: TextOptions): string {
  const c = (style: keyof typeof codes, s: string) => paint(opts.color, style, s);
  const out: string[] = [];
  out.push(
    `${c("bold", "semvet")}  ${r.packageName}  ${c("dim", `${r.baseline.version ?? "?"} → ${r.next.version ?? "?"}  (${r.baseline.label} vs working tree)`)}`,
  );
  out.push("");

  const groups: Severity[] = ["breaking", "minor", "note"];
  const transitive = r.findings.filter((f) => f.transitive);
  for (const sev of groups) {
    const items = r.findings.filter((f) => f.severity === sev && !f.transitive);
    if (items.length === 0) continue;
    const style = sev === "breaking" ? "red" : sev === "minor" ? "green" : "gray";
    const glyph = sev === "breaking" ? "✖" : sev === "minor" ? "+" : "·";
    out.push(c(style, c("bold", `${TITLES[sev]} (${items.length})`)));
    const width = Math.min(34, Math.max(...items.map((f) => label(f).length)));
    for (const f of items) {
      out.push(`  ${c(style, glyph)} ${label(f).padEnd(width)}  ${f.message}`);
      if (f.detail && (opts.verbose || f.severity === "breaking")) {
        const lines = f.detail.split("\n");
        const shown = opts.verbose ? lines : lines.slice(0, 2);
        for (const l of shown) out.push(`      ${c("dim", clip(l, opts.verbose ? 400 : 92))}`);
        if (shown.length < lines.length) out.push(`      ${c("dim", "…")}`);
      }
    }
    if (sev === "breaking" && transitive.length > 0) {
      const names = transitive.map(label);
      const shown = names.slice(0, 6).join(", ");
      const more = names.length > 6 ? ` and ${names.length - 6} more` : "";
      out.push(
        `  ${c("gray", "·")} ${c("dim", `also affected through the types above: ${shown}${more}`)}`,
      );
    }
    out.push("");
  }

  for (const w of r.warnings) out.push(c("yellow", `warning: ${w}`));
  if (r.warnings.length > 0) out.push("");

  const v = verdict(r);
  out.push(c(v.style, c("bold", `${v.glyph} ${v.text}`)));
  return out.join("\n");
}

export function formatJson(r: Report): string {
  return JSON.stringify(r, null, 2);
}

function esc(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function formatMarkdown(r: Report): string {
  const v = verdict(r);
  const lines: string[] = [];
  lines.push(
    `### semvet: \`${r.packageName}\` ${r.baseline.version ?? "?"} → ${r.next.version ?? "?"}`,
  );
  lines.push("");
  lines.push(`**${v.glyph} ${v.text}**`);
  lines.push("");
  if (r.findings.length > 0) {
    lines.push("| | Export | Change |");
    lines.push("|---|---|---|");
    for (const f of r.findings) {
      const icon = f.severity === "breaking" ? "🔴" : f.severity === "minor" ? "🟢" : "⚪";
      lines.push(`| ${icon} | \`${esc(label(f))}\` | ${esc(f.message)} |`);
    }
    const withDetail = r.findings.filter((f) => f.detail);
    if (withDetail.length > 0) {
      lines.push("");
      lines.push("<details><summary>Compiler explanations</summary>");
      lines.push("");
      for (const f of withDetail) {
        lines.push(`**\`${label(f)}\`**`);
        lines.push("```text");
        lines.push(f.detail ?? "");
        lines.push("```");
      }
      lines.push("</details>");
    }
  }
  lines.push("");
  lines.push(
    `<sub>Baseline: ${r.baseline.label} · ${r.symbolsCompared} exports compared · [semvet](https://github.com/Nithinfgs/semvet)</sub>`,
  );
  return lines.join("\n");
}

function annotationEscape(s: string): string {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/** GitHub Actions workflow commands, one per finding, plus the plain text report. */
export function formatGithub(r: Report, opts: TextOptions): string {
  const cmds: string[] = [];
  for (const f of r.findings) {
    const level =
      f.severity === "breaking" ? "error" : f.severity === "minor" ? "notice" : "notice";
    cmds.push(
      `::${level} title=${annotationEscape(`semvet: ${label(f)}`)}::${annotationEscape(f.message)}`,
    );
  }
  for (const w of r.warnings) cmds.push(`::warning title=semvet::${annotationEscape(w)}`);
  return `${cmds.join("\n")}${cmds.length ? "\n" : ""}${formatText(r, opts)}`;
}
