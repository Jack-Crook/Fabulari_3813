import { Service, signal } from '@angular/core';   // Service = injectable decorator, same as Auth and GroupService
import { io, Socket } from 'socket.io-client';

// one message as the server broadcasts it, matching a document in the messages collection.
// imageUrl is always empty for now: image messages are the next step, and having the field here
// already means the shape doesn't change when they land.
export interface ChatMessage {
  _id: string;
  channelId: string;
  sender: string;         // an email, because that's the identifier everywhere in this app
  body: string;
  imageUrl: string;
  at: string;             // ISO, so sorting the strings and sorting the dates agree
}

// what the server sends back to the joiner alone, through the ack callback rather than a
// broadcast, so nobody else in the room receives someone else's history
interface JoinResult {
  history?: ChatMessage[];
  present?: string[];
  error?: string;
}

@Service()
export class ChatService {
  private socket?: Socket;

  // the room this tab is in right now, kept so it can be rejoined after a reconnect. the server's
  // record of which room a socket joined dies with that connection, so without this a dropped
  // connection comes back as a fresh socket in no room and every send answers "Join a room first".
  private currentRoom?: { channelId: string; email: string };

  private apiUrl = 'http://localhost:3000';   // the same origin as the rest api, sockets share the http server

  // Signals, not plain arrays. Every one of these is written from a socket callback, which fires
  // outside anything Angular knows about, and this app is zoneless. A plain property would hold
  // the right value and the screen would never redraw. This is the same rule as the subscribe
  // callbacks in the other components, and it's the bug that cost the most time in Phase 1.
  messages = signal<ChatMessage[]>([]);
  present = signal<string[]>([]);      // who is in the room right now, from the server's presence event
  notice = signal('');                 // "someone joined" / "someone left", shown briefly
  error = signal('');

  // The connection is opened once and reused for every room. Connecting per room would tear down
  // and reopen a websocket on every click, and would lose the server side `joined` state that
  // identifies this socket's user.
  private connect(): Socket {
    if (this.socket) {
      return this.socket;
    }

    const socket = io(this.apiUrl);
    this.socket = socket;

    socket.on('newMessage', (message: ChatMessage) => {
      // a new array rather than push(), because a signal only notifies when the reference changes
      this.messages.update(list => [...list, message]);
    });

    socket.on('presence', (people: string[]) => this.present.set(people));

    // The spec asks for both of these, separately: a live list of who else is in the room, and
    // a notification when someone arrives or leaves while you're in it. `presence` above is the
    // list; these two are the notification.
    socket.on('userJoined', ({ email }: { email: string }) => this.flash(`${email} joined`));
    socket.on('userLeft', ({ email }: { email: string }) => this.flash(`${email} left`));

    socket.on('connect_error', () => this.error.set('Lost connection to the chat server.'));

    // socket.io reconnects by itself, but the server treats it as a brand new socket in no room.
    // 'reconnect' is on the manager (socket.io), not the socket, and unlike 'connect' it doesn't
    // fire on the very first connection, so this can't double up with the join joinRoom already
    // sent. rejoining also refetches history, which picks up anything said while we were gone.
    socket.io.on('reconnect', () => {
      this.error.set('');
      if (this.currentRoom) {
        this.joinRoom(this.currentRoom.channelId, this.currentRoom.email);
      }
    });

    return socket;
  }

  // shows a notice for a few seconds then clears it. the equality check means a newer notice
  // isn't wiped early by the timer belonging to an older one.
  private flash(text: string) {
    this.notice.set(text);
    setTimeout(() => this.notice.update(current => (current === text ? '' : current)), 4000);
  }

  // Joining hands the server a channel and an email. The server checks that email is really in
  // the group before letting the socket in, then remembers it for the life of the connection,
  // which is why sendMessage below doesn't take one.
  joinRoom(channelId: string, email: string) {
    const socket = this.connect();
    this.currentRoom = { channelId, email };

    this.messages.set([]);     // clear the previous room before the new history arrives, so the
    this.present.set([]);       // old transcript never flashes up under the new room's heading
    this.notice.set('');
    this.error.set('');

    socket.emit('joinRoom', { channelId, email }, (res: JoinResult) => {
      if (res?.error) {
        this.error.set(res.error);
        return;
      }
      this.messages.set(res.history ?? []);   // oldest first, the server already ordered it
      this.present.set(res.present ?? []);
    });
  }

  // No email in the payload, deliberately. The server takes the sender from the socket's own
  // validated join, so a client that sends someone else's address can't post as them. That's the
  // one place this app doesn't have the self-asserted-identity weakness the REST routes have.
  send(body: string) {
    if (!this.socket) {
      this.error.set('Not connected to the chat server.');
      return;
    }
    this.socket.emit('sendMessage', { body }, (res: { ok?: boolean; error?: string }) => {
      if (res?.error) {
        this.error.set(res.error);
      }
    });
  }

  // called when leaving the chat page. the server also treats a disconnect as a leave, so closing
  // the tab is covered too, but navigating away inside the app doesn't disconnect the socket.
  leaveRoom() {
    this.socket?.emit('leaveRoom');
    this.currentRoom = undefined;     // left on purpose, so a later reconnect shouldn't put us back in
    this.messages.set([]);
    this.present.set([]);
    this.notice.set('');
  }
}
