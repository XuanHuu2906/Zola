/** Field mapping observed in Zalo 26.11.10's voicecall HTTP methods.
 * Keep account/session material inside zca-js's custom API closure.
 */
import type { API } from 'zca-js';
export interface CallSignal { command: number; data: Record<string, unknown> }
export function callRequest(command: number, d: Record<string, unknown>, imei: string) {
  const pick = (...keys: string[]) => Object.fromEntries(keys.map(k => [k, d[k]]));
  let endpoint: string;
  let params: Record<string, unknown>;
  switch (command) {
    case 401: endpoint = 'requestcall'; params = { ...pick('calleeId', 'callId'), codec: d.codec ?? '[]', typeRequest: d.type, imei }; break;
    case 416: endpoint = 'request'; params = { ...pick('calleeId', 'rtcpAddress', 'rtpAddress', 'codec', 'session', 'callId'), imei }; break;
    case 407: endpoint = 'ringring'; params = { ...pick('callerId', 'callId'), status: 0, imei }; break;
    case 408: endpoint = 'answerack'; params = { ...pick('calleeId', 'callId'), status: 0, imei }; break;
    case 402: endpoint = 'answer'; params = { ...pick('callerId', 'callId', 'status', 'rtcpAddress', 'rtpAddress'), codec: d.codec || '', session_id: d.session }; break;
    case 405: endpoint = 'cancel'; params = { callerId: d.toId, ...pick('callId', 'callType'), status: 0, imei }; break;
    case 409: endpoint = 'endcall'; params = { uidTo: d.toId, callId: d.callId, status: 3, imei }; break;
    case 406: endpoint = 'logendcall'; params = { call_id: d.callId, partner_id: d.partnerId, logdata: d.data, ...pick('status', 'duration', 'role'), imei }; break;
    case 12006: endpoint = 'conf'; params = pick('calleeId', 'callId', 'isOnCam', 'isOnMic', 'data'); break;
    default: throw new Error('Unsupported call signal');
  }
  if ((command === 416 || command === 402) && d.extendData) {
    params.extendData = d.extendData; params.subCommand = 3;
  }
  return { endpoint, params };
}

export function registerCallSignaling(api: API): (signal: CallSignal) => Promise<unknown> {
  const name = '__zolaCallSignal';
  if (!Object.hasOwn(api, name)) {
    api.custom<unknown, CallSignal>(name, async ({ ctx, utils, props }) => {
      const base = api.zpwServiceMap?.voice_call?.[0];
      if (!base) throw new Error('Call service unavailable');
      const { endpoint, params } = callRequest(props.command, props.data, ctx.imei);
      const encrypted = utils.encodeAES(JSON.stringify(params));
      if (!encrypted) throw new Error('Call encryption failed');
      const response = await utils.request(utils.makeURL(`${base.replace(/\/$/, '')}/api/voicecall/${endpoint}`, { params: encrypted }), {
        method: 'GET', signal: AbortSignal.timeout(15000),
      });
      return utils.resolve(response);
    });
  }
  return (api as unknown as { __zolaCallSignal(signal: CallSignal): Promise<unknown> }).__zolaCallSignal.bind(api);
}
