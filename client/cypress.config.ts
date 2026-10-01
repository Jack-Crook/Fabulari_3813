import { defineConfig } from 'cypress';
import { io, Socket } from 'socket.io-client';

// cypress drives one browser, so a chat test can only be one person. the second person in the
// room is played from here instead: setupNodeEvents runs in node, not the browser, and a task
// registered below can be called from a spec with cy.task(). each one opens a real socket.io
// connection to the server, the same library the angular ChatService uses, so to the server it
// is just another user in the room.
//
// keyed by email so a spec can have more than one extra person if it ever needs to
const sockets = new Map<string, { socket: Socket; received: string[] }>();

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4200',

    setupNodeEvents(on) {
      on('task', {
        // connects and joins a room. resolves with the server's ack, which is the room history
        // and who is present, or { error } if the server refused the join.
        socketJoin({ channelId, email }: { channelId: string; email: string }) {
          const socket = io('http://localhost:3000', { transports: ['websocket'] });
          const entry = { socket, received: [] as string[] };
          sockets.set(email, entry);
          // every message this person sees, so a spec can check the browser user's message
          // really was broadcast to someone else and not just drawn on their own screen
          socket.on('newMessage', (message: { body: string }) => entry.received.push(message.body));
          return new Promise(resolve => socket.emit('joinRoom', { channelId, email }, resolve));
        },

        // resolves with the ack: { ok: true } or { error }
        socketSend({ email, body }: { email: string; body: string }) {
          const entry = sockets.get(email);
          if (!entry) {
            return { error: 'socketJoin was never called for ' + email };
          }
          return new Promise(resolve => entry.socket.emit('sendMessage', { body }, resolve));
        },

        socketReceived({ email }: { email: string }) {
          return sockets.get(email)?.received ?? [];
        },

        // a disconnect is how closing the tab looks to the server, which treats it as a leave.
        // a task has to return something other than undefined, hence the null.
        socketLeave({ email }: { email: string }) {
          sockets.get(email)?.socket.disconnect();
          sockets.delete(email);
          return null;
        },
      });
    },
  },

  component: {
    devServer: {
      framework: 'angular',
      bundler: 'webpack',
    },
    specPattern: '**/*.cy.ts',
  },
});
