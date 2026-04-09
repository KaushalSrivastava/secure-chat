import { Server } from "socket.io";
import type { Server as HTTPServer } from "http";

export function setupSocket(server: HTTPServer) {
  const io = new Server(server, {
    cors: {
      origin: "*",
    },
  });

  // Room ID -> { createdAt: number, messages: any[], users: Record<string, any> }
  const sessions = new Map<
    string,
    { createdAt: number; messages: any[]; users: Record<string, any> }
  >();

  // Cleanup loop: every minute check and delete 24-hr old sessions
  setInterval(() => {
    const now = Date.now();
    for (const [roomId, session] of Array.from(sessions.entries())) {
      if (now - session.createdAt > 24 * 60 * 60 * 1000) {
        sessions.delete(roomId);
        io.to(roomId).emit("session_expired");
        io.in(roomId).socketsLeave(roomId);
      }
    }
  }, 60 * 1000);

  io.on("connection", (socket) => {
    socket.on("join_room", ({ roomId, user }) => {
      socket.join(roomId);

      if (!sessions.has(roomId)) {
        sessions.set(roomId, {
          createdAt: Date.now(),
          messages: [],
          users: {},
        });
      }

      const session = sessions.get(roomId)!;
      session.users[socket.id] = user;

      // Immediately send historical messages back to the connecting client
      socket.emit("room_history", session.messages);

      // Broadcast join to others
      socket.to(roomId).emit("user_joined", user);
    });

    socket.on("send_message", ({ roomId, message }) => {
      if (sessions.has(roomId)) {
        const session = sessions.get(roomId)!;
        session.messages.push(message);
        // We broadcast back to the room. The client will handle it.
        socket.to(roomId).emit("new_message", message);
      }
    });

    socket.on("typing", ({ roomId, user, isTyping }) => {
      socket.to(roomId).emit("user_typing", { user, isTyping });
    });

    socket.on("clear_history", ({ roomId }) => {
      if (sessions.has(roomId)) {
        sessions.get(roomId)!.messages = [];
        // Tell everyone to clear their local UI
        io.to(roomId).emit("history_cleared");
      }
    });

    socket.on("disconnect", () => {
      // Find which room they were in and emit user_left
      for (const [roomId, session] of Array.from(sessions.entries())) {
        if (session.users[socket.id]) {
          const user = session.users[socket.id];
          delete session.users[socket.id];
          io.to(roomId).emit("user_left", user);
        }
      }
    });
  });

  return io;
}
