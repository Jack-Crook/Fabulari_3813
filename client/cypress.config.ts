import { defineConfig } from 'cypress';
import { io, Socket } from 'socket.io-client';

// cypress drives one browser, so a second chat user is played from node with socket.io-client,
// called from specs with cy.task(). keyed by email.
const sockets = new Map<string, { socket: Socket; received: string[] }>();

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:4200',

    setupNodeEvents(on) {
      on('task', {
        // joins a room. resolves with the ack: history and presence, or { error }
        socketJoin({ channelId, email }: { channelId: string; email: string }) {
          const socket = io('http://localhost:3000', { transports: ['websocket'] });
          const entry = { socket, received: [] as string[] };
          sockets.set(email, entry);
          // messages this user received, to check the browser's message was broadcast
          socket.on('newMessage', (message: { body: string }) => entry.received.push(message.body));
          return new Promise(resolve => socket.emit('joinRoom', { channelId, email }, resolve));
        },

        // resolves with the ack
        socketSend({ email, body }: { email: string; body: string }) {
          const entry = sockets.get(email);
          if (!entry) {
            return { error: 'socketJoin was never called for ' + email };
          }
          return new Promise(resolve => entry.socket.emit('sendMessage', { body }, resolve));
        },

        // this user starts typing, so the browser should show "x is typing"
        socketTyping({ email }: { email: string }) {
          sockets.get(email)?.socket.emit('typing');
          return null;
        },

        socketReceived({ email }: { email: string }) {
          return sockets.get(email)?.received ?? [];
        },

        // a disconnect counts as leaving. a task can't return undefined.
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
