// Raw stdin -> logical key events. Zero dependencies. Turns a raw terminal
// data chunk into a stream of { name, char } events. Arrow-key and other escape
// sequences are recognised so they don't get mistaken for typed characters.

const ARROWS = { A: 'up', B: 'down', C: 'right', D: 'left' };

function* parse(data) {
  let i = 0;
  while (i < data.length) {
    const ch = data[i];

    if (ch === '\x1b') {
      const rest = data.slice(i);
      const m = rest.match(/^\x1b\[([ABCD])/);
      if (m) { yield { name: ARROWS[m[1]] }; i += 3; continue; }
      if (rest.length === 1) { yield { name: 'escape' }; i += 1; continue; }
      // Unknown escape sequence — swallow the remainder of this chunk.
      yield { name: 'escape' };
      return;
    }
    if (ch === '\x03') { yield { name: 'ctrl-c' }; i += 1; continue; }
    if (ch === '\r' || ch === '\n') { yield { name: 'enter' }; i += 1; continue; }
    if (ch === '\t') { yield { name: 'tab' }; i += 1; continue; }
    if (ch === '\x7f' || ch === '\b') { yield { name: 'backspace' }; i += 1; continue; }

    const code = ch.charCodeAt(0);
    if (code < 32) { i += 1; continue; } // other control chars: ignore
    yield { name: 'char', char: ch };
    i += 1;
  }
}

export function startKeys(onKey) {
  const stdin = process.stdin;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  const handler = (data) => {
    for (const key of parse(data)) onKey(key);
  };
  stdin.on('data', handler);
  return () => {
    stdin.off('data', handler);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  };
}
