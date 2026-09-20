/* Reference scanning needs the code with comments and quoted strings removed, but
   with template-literal INTERPOLATIONS kept. A regex cannot do this: every view
   renders HTML through a template literal whose attributes are double-quoted, so
   `style="background:${QUAD[i.quadrant].c}"` looks like a double-quoted string and
   a naive stripper deletes the reference along with it.

   So: walk the source, skip comments and ordinary strings, and inside a template
   keep only what is between ${ and its matching }. */
function strip(src){
  let out = '', i = 0, prev = '';    // prev: last significant char, for regex-vs-divide
  const tpl = [];                    // brace depth per open template literal
  const REGEX_OK = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '~', '^', '%', '<', '>', 'return', 'typeof', 'case', 'in', 'of']);
  while (i < src.length){
    const c = src[i], d = src[i+1];
    if (c === '/' && d === '/'){ while (i < src.length && src[i] !== '\n') i++; out += ' '; continue; }
    if (c === '/' && d === '*'){ i += 2; while (i < src.length && !(src[i] === '*' && src[i+1] === '/')) i++; i += 2; out += ' '; continue; }
    if (c === "'" || c === '"'){
      const q = c; i++;
      while (i < src.length && src[i] !== q){ if (src[i] === '\\') i++; i++; }
      i++; out += ' '; prev = 'x'; continue;
    }
    /* A regex literal can contain quotes and braces — esc()'s /[&<>"']/g would
       otherwise open a string that swallows the rest of the file. Whether a slash
       starts one depends on what came before it. */
    if (c === '/' && REGEX_OK.has(prev)){
      i++; let cls = false;
      while (i < src.length){
        const ch = src[i];
        if (ch === '\\'){ i += 2; continue; }
        if (ch === '[') cls = true;
        else if (ch === ']') cls = false;
        else if (ch === '/' && !cls) break;
        else if (ch === '\n') break;
        i++;
      }
      i++;
      while (i < src.length && /[a-z]/.test(src[i])) i++;   // flags
      out += ' '; prev = 'x'; continue;
    }
    if (c === '`'){
      i++; tpl.push(0);
      while (i < src.length && tpl.length){
        if (src[i] === '\\'){ i += 2; continue; }
        if (src[i] === '`'){ tpl.pop(); i++; continue; }
        if (src[i] === '$' && src[i+1] === '{'){
          i += 2; let depth = 1; let expr = '';
          while (i < src.length && depth){
            if (src[i] === '{') depth++;
            else if (src[i] === '}'){ depth--; if (!depth){ i++; break; } }
            expr += src[i]; i++;
          }
          out += ' ' + strip(expr) + ' ';       // recurse: templates nest
          continue;
        }
        i++;                                     // literal text: dropped
      }
      out += ' '; continue;
    }
    out += c; i++;
    if (!/\s/.test(c)) prev = /[\w$]/.test(c) ? lastWord(out) : c;
  }
  return out;
}
/* the trailing identifier, so `return /re/` is read as a regex and `a / b` is not */
function lastWord(s){ const m = /[A-Za-z_$][\w$]*$/.exec(s); return m ? m[0] : 'x'; }

export { strip };
