// utils/socket.js
import { w3cwebsocket as W3CWebSocket } from "websocket";

let socket = null;
let receiverIdGlobal = null;
let senderIdGlobal = null;
let messageCallback = null;

export const connectWebSocket = (
  onMessageReceived,
  userId,
  backendUrl,
  onConnected,
  onDisconnected,
  receiverId
) => {
  receiverIdGlobal = receiverId;

  senderIdGlobal = userId;
  messageCallback = onMessageReceived;

  console.log("🚀 Connecting WebSocket for user:", userId);
  console.log("🌐 Connecting STOMP WebSocket to:", backendUrl);

  socket = new W3CWebSocket(backendUrl);
  socket.binaryType = "arraybuffer";

  socket.onopen = () => {
    console.log("  WebSocket opened — sending STOMP CONNECT...");

    const connectFrame =
      "CONNECT\naccept-version:1.2\nhost:" +
      backendUrl +
      "\nlogin:" +
      senderIdGlobal +
      "\nheart-beat:10000,10000\n\n\0";

    const encoder = new TextEncoder();
    socket.send(encoder.encode(connectFrame));
    console.log("📨 STOMP CONNECT frame sent (encoded)!");
  };



socket.onmessage = (msg) => {
  let data;
  if (msg.data instanceof ArrayBuffer) {
    data = new TextDecoder("utf-8").decode(msg.data);
  } else {
    data = msg.data;
  }

  console.log("📩 Raw Message:", data);

  if (data.startsWith("CONNECTED")) {
    console.log("🎉 STOMP CONNECTED — subscribing to /queue/" + senderIdGlobal);

    // 🟢 Subscribe to personal queue
    const subscribeFrame =
      "SUBSCRIBE\nid:sub-0\ndestination:/queue/" +
      senderIdGlobal +
      "\nack:auto\n\n\0";
    socket.send(new TextEncoder().encode(subscribeFrame));

    // 🛑 Subscribe to error queue (/user/queue/error)
    const errorSubscribeFrame =
      "SUBSCRIBE\nid:sub-err\ndestination:/user/queue/error\nack:auto\n\n\0";
    socket.send(new TextEncoder().encode(errorSubscribeFrame));

    console.log("🟢 Subscribed to /queue/" + senderIdGlobal);
    console.log("🚨 Subscribed to /user/queue/error");

    onConnected && onConnected();
  }

  else if (data.startsWith("MESSAGE")) {
    console.log("💌 STOMP MESSAGE received:", data);
    const bodyStart = data.indexOf("\n\n") + 2;
    let body = data.substring(bodyStart).replace(/\u0000/g, "").trim();

    try {
      const parsed = JSON.parse(body);

      // ⚠ Error Message Handling
      if (parsed.type === "USER_NOT_FOUND" || parsed.type === "ERROR") {
        console.error(
          `🚨 WebSocket Error: ${parsed.message} at ${parsed.timestamp}`
        );
        alert(parsed.message); // or showToast(parsed.message)
        return;
      }

      //   Chat message validation
      if (
        parsed.senderPhoneNumber &&
        parsed.receiverPhoneNumber &&
        (
          (parsed.senderId === senderIdGlobal &&
            parsed.receiverPhoneNumber === receiverIdGlobal) ||
          (parsed.receiverId === senderIdGlobal &&
            parsed.senderPhoneNumber === receiverIdGlobal)
        )
      ) {
        messageCallback && messageCallback(parsed);
      } else {
        console.log("⚠ Message ignored — belongs to another chat");
      }
    } catch (err) {
      console.error("   Error parsing STOMP message:", err);
    }
  }

  else if (data.startsWith("ERROR")) {
    console.error("🚨 STOMP ERROR:", data);
  }
};

  socket.onerror = (err) => {
    console.error("     WebSocket error:", err.message || err);
  };

  socket.onclose = (e) => {
    console.warn("🔴 WebSocket closed:", e.code, e.reason);
    onDisconnected && onDisconnected();
  };
};

//   Send message
export const sendMessageWS = (messageObj) => {
  if (!socket || socket.readyState !== 1) {
    console.warn("⚠️ Cannot send message — socket not open");
    return;
  }

  const frame =
    "SEND\ndestination:/app/chat/sendMessage\ncontent-type:application/json\n\n" +
    JSON.stringify(messageObj) +
    "\0";

  socket.send(new TextEncoder().encode(frame));
  console.log("💬 Sent STOMP message:", messageObj);
};


//   Disconnect cleanly
export const disconnectWebSocket = () => {
  if (socket && socket.readyState === 1) {
    console.log("🔌 Disconnecting WebSocket...");
    socket.close();
  }
  socket = null;
};
