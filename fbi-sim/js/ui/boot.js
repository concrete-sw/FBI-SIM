// Boot sequence shown before login.

const LINES = [
  ['FIS-OS 7.4.1 secure workstation firmware', 0],
  ['Verifying trusted boot chain .......... OK', 1],
  ['Mounting encrypted volume /case ....... OK', 1],
  ['Loading evidence locker driver ........ OK', 1],
  ['Loading interview room audio stack .... OK', 1],
  ['Starting Dispatch secure channel ...... OK', 1],
  ['Synchronising laboratory queue ........ OK', 1],
  ['Checking AI Game Master link .......... DEFERRED (key required)', 2],
  ['', 0],
  ['NOTICE: This system is a work of fiction for simulation and entertainment.', 0],
  ['Unauthorised use of a real federal system is a crime. This is not one.', 0],
  ['', 0],
  ['Press any key or wait for login prompt...', 0]
];

export function runBoot(el, { reduceMotion = false } = {}) {
  return new Promise(resolve => {
    let i = 0;
    let finished = false;
    const finish = () => { if (finished) return; finished = true; document.removeEventListener('keydown', finish); document.removeEventListener('pointerdown', finish); resolve(); };
    document.addEventListener('keydown', finish);
    document.addEventListener('pointerdown', finish);
    const step = () => {
      if (finished) return;
      if (i >= LINES.length) { setTimeout(finish, reduceMotion ? 0 : 500); return; }
      const [text, kind] = LINES[i++];
      const line = text.replace(/OK$/, '');
      const span = document.createElement('span');
      span.textContent = line;
      if (/OK$/.test(text)) { const ok = document.createElement('span'); ok.className = 'ok'; ok.textContent = 'OK'; span.append(ok); }
      if (kind === 2) span.className = 'warn';
      el.append(span, '\n');
      setTimeout(step, reduceMotion ? 0 : 90 + Math.random() * 160);
    };
    step();
  });
}
