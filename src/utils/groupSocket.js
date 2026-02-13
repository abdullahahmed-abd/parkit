import { w3cwebsocket as W3CWebSocket } from "websocket";

let socket = null;
let potIdGlobal = null;
let myUserIdGlobal = null;
let messageCallback = null;

export const connectGroupWebSocket = (
  onMessageReceived,
  myUserId,
  backendUrl,
  onConnected,
  onDisconnected,
  globalPotId
) => {
  potIdGlobal = globalPotId;
  myUserIdGlobal = myUserId;
  messageCallback = onMessageReceived;

  socket = new W3CWebSocket(backendUrl);
  socket.binaryType = "arraybuffer";

  socket.onopen = () => {
    const connectFrame =
      `CONNECT\naccept-version:1.2\nheart-beat:10000,10000\n\n\0`;
    socket.send(new TextEncoder().encode(connectFrame));
  };

  socket.onmessage = (msg) => {
    const data =
      msg.data instanceof ArrayBuffer
        ? new TextDecoder("utf-8").decode(msg.data)
        : msg.data;

  console.log("WS raw messageeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee:", data);

    if (data.startsWith("CONNECTED")) {
      const subscribeFrame =
        `SUBSCRIBE\nid:sub-group-${potIdGlobal}\n` +
        `destination:/topic/group/${potIdGlobal}\nack:auto\n\n\0`;

      socket.send(new TextEncoder().encode(subscribeFrame));
      onConnected && onConnected();
      return;
    }

    if (!data.startsWith("MESSAGE")) return;

    const body = data
      .substring(data.indexOf("\n\n") + 2)
      .replace(/\u0000/g, "")
      .trim();

try {
  const parsed = JSON.parse(body);
  const { dataType, data } = parsed;

  if (dataType === "CHAT_MESSAGE") {
    if (data?.globalPotId !== potIdGlobal) return;
    messageCallback && messageCallback(parsed);
    return;
  }

  if (dataType === "TRANSACTION_MESSAGE") {
    if (data?.toGlobalPotId !== potIdGlobal) return;
    messageCallback && messageCallback(parsed);
    return;
  }
} catch (e) {
  console.error("Group WS parse error:", e);
}
  };

  socket.onerror = (e) => console.error("Group WS error:", e);
  socket.onclose = () => onDisconnected && onDisconnected();
};

export const sendGroupMessageWS = (payload) => {
  if (!socket || socket.readyState !== 1) return;

  const frame =
    `SEND\ndestination:/app/group-chat/sendMessage\n` +
    `content-type:application/json\n\n` +
    JSON.stringify(payload) +
    `\0`;

  socket.send(new TextEncoder().encode(frame));
};

export const disconnectGroupWebSocket = () => {
  if (socket) socket.close();
  socket = null;
};
