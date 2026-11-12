// Reads the Rust command signatures (src-tauri/src/commands/**, lib.rs handler list) and writes
// contract.json: for every registered command, the argument names Tauri expects (camelCase),
// whether each is required, and a coarse type. The mock backend uses it to reject calls the real
// backend would reject (unknown command, missing required argument, wrong primitive type).
import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const rustSrc = join(root, "src-tauri", "src");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".rs")) out.push(p);
  }
  return out;
}

const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** Split a parameter list on top-level commas. */
function splitParams(src) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of src) {
    if (ch === "<" || ch === "(" || ch === "[") depth++;
    if (ch === ">" || ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

const INJECTED = /^(tauri::)?(State|AppHandle|Window|WebviewWindow|Webview|ipc::Channel|Channel)\b/;
function kindOf(type) {
  let t = type.replace(/\s+/g, "");
  let optional = false;
  const m = /^Option<(.*)>$/.exec(t);
  if (m) {
    optional = true;
    t = m[1];
  }
  let kind = "any";
  if (/^(String|&str|PathBuf)$/.test(t)) kind = "string";
  else if (/^(i8|i16|i32|i64|u8|u16|u32|u64|usize|isize)$/.test(t)) kind = "int";
  else if (/^(f32|f64)$/.test(t)) kind = "number";
  else if (t === "bool") kind = "bool";
  else if (/^Vec</.test(t)) kind = "array";
  else if (/^(Value|serde_json::Value)$/.test(t)) kind = "any";
  else kind = "object-or-enum";
  return { optional, kind, rust: type.replace(/\s+/g, " ") };
}

const commands = {};
for (const file of walk(rustSrc)) {
  const text = readFileSync(file, "utf8");
  const re = /#\[tauri::command(?:\([^)]*\))?\]\s*(?:#\[[^\]]*\]\s*)*pub\s+(?:async\s+)?fn\s+([a-z0-9_]+)\s*(?:<[^>]*>)?\s*\(([\s\S]*?)\)\s*(?:->\s*([^{]+))?\{/g;
  let m;
  while ((m = re.exec(text))) {
    const [, name, params, ret] = m;
    const args = {};
    for (const p of splitParams(params.replace(/\/\/[^\n]*/g, ""))) {
      const idx = p.indexOf(":");
      if (idx < 0) continue;
      const pname = p.slice(0, idx).replace(/^mut\s+/, "").trim().replace(/^_+/, "");
      const ptype = p.slice(idx + 1).trim();
      if (INJECTED.test(ptype)) continue;
      args[camel(pname)] = kindOf(ptype);
    }
    commands[name] = { file: file.slice(root.length + 1), args, returns: (ret || "()").trim().replace(/\s+/g, " ") };
  }
}

// Only commands in generate_handler! are reachable.
const lib = readFileSync(join(rustSrc, "lib.rs"), "utf8");
const handler = /generate_handler!\[([\s\S]*?)\]\)/.exec(lib);
const registered = new Set();
if (handler) for (const line of handler[1].split(",")) {
  const name = line.replace(/\/\/[^\n]*/g, "").trim().split("::").pop();
  if (name) registered.add(name);
}
const out = {};
for (const name of [...registered].sort()) {
  if (!commands[name]) {
    console.warn(`[gen-contract] registered command without a parsed signature: ${name}`);
    out[name] = { file: "?", args: {}, returns: "?", unparsed: true };
  } else out[name] = commands[name];
}
writeFileSync(join(here, "contract.json"), JSON.stringify(out, null, 1));
console.log(`[gen-contract] ${Object.keys(out).length} registered commands written to tools/harness/contract.json`);
