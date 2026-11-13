const [{ default: WebSocket }] = await Promise.all([import('ws')]);
const target = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).find(t => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const send = (method, params={}) => new Promise(r => { const n = ++id; const on = m => { const x = JSON.parse(m); if (x.id===n) { ws.off('message', on); r(x); } }; ws.on('message', on); ws.send(JSON.stringify({id:n,method,params})); });
await new Promise(r => ws.on('open', r));
const expr = process.argv[2];
console.log(JSON.stringify(await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }), null, 1).slice(0, 2000));
ws.close();
